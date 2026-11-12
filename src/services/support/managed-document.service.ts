import {
  LONG_TEXT_MAX_LENGTH,
  POLICY_SECTION_MAX_LENGTH,
} from '../../config/text-limits.js';
import createHttpError from 'http-errors';
import { StorePolicy } from '../../models/support/support.model.js';
import { StoreInformation } from '../../models/support/information.model.js';
import {
  documentKeys,
  policyKeys,
  type DocumentKey,
} from '../../validations/support/managed-document.validation.js';
import { versionConflict } from './support.service.js';
import { publicationChanges } from './publication-metadata.js';

type Publication = {
  publishedAt?: Date | null;
  updatedAt?: Date | null;
  views?: number;
};
const isPolicy = (key: DocumentKey): key is (typeof policyKeys)[number] =>
  (policyKeys as readonly string[]).includes(key);
type StoredPolicy = {
  content?: Partial<Record<(typeof policyKeys)[number], string>>;
  publishedContent?: Partial<
    Record<(typeof policyKeys)[number], string>
  > | null;
  publications?: Partial<
    Record<(typeof policyKeys)[number], Publication | null>
  > | null;
  publishedAt?: Date | null;
  __v?: number;
};
type StoredInformation = {
  content?: string;
  publishedContent?: string | null;
  publication?: Publication | null;
  publishedAt?: Date | null;
  __v?: number;
};
function documentDto(
  key: DocumentKey,
  doc: StoredPolicy | StoredInformation | null,
  admin: boolean
) {
  const policy = doc as StoredPolicy | null;
  const information = doc as StoredInformation | null;
  const content = isPolicy(key)
    ? (policy?.content?.[key] ?? '')
    : (information?.content ?? '');
  const publishedContent =
    (isPolicy(key)
      ? policy?.publishedContent?.[key]
      : information?.publishedContent) || null;
  const publication = isPolicy(key)
    ? policy?.publications?.[key]
    : information?.publication;
  const metadata = {
    publishedAt: publishedContent
      ? (publication?.publishedAt ?? doc?.publishedAt ?? null)
      : null,
    updatedAt: publication?.updatedAt ?? null,
    views: publication?.views ?? 0,
  };
  if (!admin)
    return publishedContent ? { content: publishedContent, ...metadata } : null;
  return { key, content, publishedContent, ...metadata, __v: doc?.__v ?? 0 };
}
export async function readDocument(key: DocumentKey, admin = false) {
  if (isPolicy(key)) {
    const doc = await StorePolicy.findById('store-policy').lean();
    return documentDto(key, doc, admin);
  }
  return documentDto(key, await StoreInformation.findById(key).lean(), admin);
}
export async function listDocuments() {
  return Promise.all(documentKeys.map((key) => readDocument(key, true)));
}

export async function writeDocument(
  key: DocumentKey,
  input: { content: string; publish: boolean; expectedVersion: number },
  remove = false
) {
  const maxLength = isPolicy(key)
    ? POLICY_SECTION_MAX_LENGTH
    : LONG_TEXT_MAX_LENGTH;
  if (input.content.length > maxLength)
    throw createHttpError(
      400,
      `Nội dung tối đa ${maxLength} ký tự bao gồm định dạng.`
    );
  const current = await readDocument(key, true);
  if (!current || !('__v' in current) || current.__v !== input.expectedVersion)
    throw versionConflict();
  const now = new Date();
  const prefix = isPolicy(key) ? `publications.${key}` : 'publication';
  const contentPath = isPolicy(key) ? `content.${key}` : 'content';
  const publishedPath = isPolicy(key)
    ? `publishedContent.${key}`
    : 'publishedContent';
  const set: Record<string, unknown> = {
    [contentPath]: remove ? '' : input.content,
  };
  if (remove) {
    set[publishedPath] = isPolicy(key) ? '' : null;
    set[prefix] = { publishedAt: null, updatedAt: null, views: 0 };
    if (!isPolicy(key)) set['publishedAt'] = null;
  } else if (input.publish) {
    set[publishedPath] = input.content;
    Object.assign(
      set,
      publicationChanges(
        prefix,
        current.publishedContent,
        input.content,
        current,
        null,
        now
      )
    );
    if (!isPolicy(key)) set['publishedAt'] = current.publishedAt ?? now;
  }
  const filter = {
    _id: isPolicy(key) ? 'store-policy' : key,
    __v: input.expectedVersion,
  };
  // MongoDB cannot create a dotted child below a legacy null published snapshot.
  if (isPolicy(key) && (input.publish || remove)) {
    const snapshot = await StorePolicy.findById('store-policy').lean();
    if (!snapshot?.publishedContent) {
      delete set[publishedPath];
      set['publishedContent'] = { [key]: remove ? '' : input.content };
    }
  }
  const update = { $set: set, $inc: { __v: 1 } };
  try {
    const options = {
      returnDocument: 'after' as const,
      upsert: input.expectedVersion === 0,
      runValidators: true,
      setDefaultsOnInsert: false,
    };
    const result = isPolicy(key)
      ? await StorePolicy.findOneAndUpdate(filter, update, options)
      : await StoreInformation.findOneAndUpdate(filter, update, options);
    if (!result) throw versionConflict();
    return documentDto(key, result.toObject(), true);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    )
      throw versionConflict();
    throw error;
  }
}
export async function recordDocumentView(key: DocumentKey) {
  const publishedPath = isPolicy(key)
    ? `publishedContent.${key}`
    : 'publishedContent';
  const path = isPolicy(key)
    ? `publications.${key}.views`
    : 'publication.views';
  const update = [
    { $set: { [path]: { $add: [{ $ifNull: [`$${path}`, 0] }, 1] } } },
  ];
  const filter = {
    _id: isPolicy(key) ? 'store-policy' : key,
    [publishedPath]: { $type: 'string', $ne: '' },
  };
  const options = {
    timestamps: false,
    returnDocument: 'after' as const,
    updatePipeline: true,
  };
  if (isPolicy(key)) {
    const doc = await StorePolicy.findOneAndUpdate(filter, update, options);
    return { views: doc?.publications?.[key]?.views ?? 0 };
  }
  const doc = await StoreInformation.findOneAndUpdate(filter, update, options);
  return { views: doc?.publication?.views ?? 0 };
}
