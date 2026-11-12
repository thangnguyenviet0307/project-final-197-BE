import { LONG_TEXT_MAX_LENGTH } from '../../config/text-limits.js';
import { z } from 'zod';
import { hasReadableContent } from './information.validation.js';

export const policyKeys = [
  'warranty',
  'privacy',
  'shipping',
  'returns',
] as const;
export const documentKeys = [
  ...policyKeys,
  'gioi-thieu',
  'dieu-khoan-su-dung',
  'cau-hoi-thuong-gap',
] as const;
export const documentParams = z.object({ key: z.enum(documentKeys) }).strict();
export const documentVersion = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export const documentInput = documentVersion
  .extend({
    content: z.string().trim().max(LONG_TEXT_MAX_LENGTH),
    publish: z.boolean(),
  })
  .strict()
  .refine((input) => !input.publish || hasReadableContent(input.content), {
    message: 'Vui lòng nhập nội dung trước khi công bố.',
    path: ['content'],
  });
export type DocumentKey = (typeof documentKeys)[number];
