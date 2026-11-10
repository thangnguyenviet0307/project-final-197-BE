import { LONG_TEXT_MAX_LENGTH } from '../../config/text-limits.js';
import { z } from 'zod';

export const informationParams = z
  .object({
    slug: z.enum(['gioi-thieu', 'dieu-khoan-su-dung', 'cau-hoi-thuong-gap']),
  })
  .strict();
export const hasReadableContent = (value: string) =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160|#xA0);/gi, ' ')
    .trim().length > 0;
export const saveInformationSchema = z
  .object({
    content: z.string().trim().max(LONG_TEXT_MAX_LENGTH),
    expectedVersion: z.number().int().nonnegative(),
    publish: z.boolean(),
  })
  .strict()
  .refine((value) => !value.publish || hasReadableContent(value.content), {
    message: 'Vui lòng nhập nội dung trước khi công bố.',
    path: ['content'],
  });
