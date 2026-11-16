import type { ClientSession } from 'mongoose';
import { editorImageIds } from './editor-image-cleanup.service.js';
import { enqueueImageCleanup } from '../products/image-cleanup.service.js';

export async function queueRemovedEditorImages(
  before: (string | null | undefined)[],
  after: (string | null | undefined)[],
  session: ClientSession
) {
  const retained = after.filter((value): value is string => typeof value === 'string').join('\n');
  const removed = [...new Set(before.flatMap((value) => editorImageIds(value ?? '')))]
    .filter((publicId) => !retained.includes(publicId));
  await enqueueImageCleanup(removed, session, 'upload', true);
}
