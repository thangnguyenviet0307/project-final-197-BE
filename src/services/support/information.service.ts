import type { ClientSession } from 'mongoose';
import { withRelationsTransaction } from '../../utils/shared/relations-transaction.js';
import { queueRemovedEditorImages } from '../editor/editor-image-lifecycle.service.js';
import type { z } from 'zod';
import { StoreInformation } from '../../models/support/information.model.js';
import type { saveInformationSchema } from '../../validations/support/information.validation.js';
import { versionConflict } from './support.service.js';
import { publicationChanges } from './publication-metadata.js';

export async function getInformation(slug: string, admin = false) {
  const document = await StoreInformation.findById(slug).lean();
  if (admin)
    return {
      content: document?.content ?? '',
      publishedAt: document?.publishedAt ?? null,
      __v: document?.__v ?? 0,
    };
  return document?.publishedContent == null
    ? null
    : { content: document.publishedContent, publishedAt: document.publishedAt };
}
export async function saveInformation(
  slug: string,
  input: z.infer<typeof saveInformationSchema>
) {
  return withRelationsTransaction((session) => saveInformationInSession(slug, input, session));
}
async function saveInformationInSession(
  slug: string,
  input: z.infer<typeof saveInformationSchema>,
  session: ClientSession
) {
  const current = await StoreInformation.findById(slug, null, { session }).lean();
  const now = new Date();
  try {
    const document = await StoreInformation.findOneAndUpdate(
      { _id: slug, __v: input.expectedVersion },
      {
        $set: {
          content: input.content,
          ...(input.publish
            ? {
                publishedContent: input.content,
                publishedAt: current?.publishedAt ?? now,
                ...publicationChanges(
                  'publication',
                  current?.publishedContent,
                  input.content,
                  current?.publication,
                  current?.publishedAt,
                  now
                ),
              }
            : {}),
        },
        $inc: { __v: 1 },
      },
      {
        session,
        returnDocument: 'after',
        upsert: input.expectedVersion === 0,
        runValidators: true,
        setDefaultsOnInsert: false,
      }
    );
    if (!document) throw versionConflict();
    await queueRemovedEditorImages(
      [current?.content, current?.publishedContent],
      [document.content, document.publishedContent],
      session
    );
    return {
      content: document.content,
      publishedAt: document.publishedAt,
      __v: document.__v,
    };
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
