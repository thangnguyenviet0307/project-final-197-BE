import type { z } from 'zod';
import { StoreInformation } from '../models/information.model.js';
import type { saveInformationSchema } from '../validations/information.validation.js';
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
  const current = input.publish
    ? await StoreInformation.findById(slug).lean()
    : null;
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
        returnDocument: 'after',
        upsert: input.expectedVersion === 0,
        runValidators: true,
        setDefaultsOnInsert: false,
      }
    );
    if (!document) throw versionConflict();
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
