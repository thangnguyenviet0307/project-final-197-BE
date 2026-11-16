import mongoose from 'mongoose';
import { getCloudinaryFolder } from '../../config/cloudinary-folders.js';

// Only URLs issued by our inline editor uploader are eligible for deletion.
export function editorImageIds(content: string): string[] {
  const cloud = process.env['CLOUDINARY_CLOUD_NAME'];
  if (!cloud) return [];
  const folder = getCloudinaryFolder('editor');
  const ids = new Set<string>();
  for (const match of content.matchAll(/<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(match[1]!);
      if (url.origin !== 'https://res.cloudinary.com' || url.username || url.password) continue;
      const prefix = `/${cloud}/image/upload/`;
      if (!url.pathname.startsWith(prefix)) continue;
      const path = url.pathname.slice(prefix.length).replace(/^v\d+\//, '');
      if (!path.startsWith(`${folder}/`)) continue;
      const file = path.slice(folder.length + 1);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|jpeg|webp)$/i.test(file)) continue;
      ids.add(`${folder}/${file.replace(/\.[^.]+$/, '')}`);
    } catch { /* External or malformed images are never deleted. */ }
  }
  return [...ids];
}

export async function isEditorImageReferenced(publicId: string): Promise<boolean> {
  const pattern = new RegExp(publicId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const references: [string, string[]][] = [
    ['posts', ['content', 'imageUrl']],
    ['products', ['description', 'thumbnail', 'images.secure_url', 'images.public_id', 'variants.image', 'variants.images']],
    ['store_information', ['content', 'publishedContent']],
    ['store_policies', ['content.privacy', 'content.warranty', 'content.returns', 'content.shipping', 'content.payment', 'content.support', 'publishedContent.privacy', 'publishedContent.warranty', 'publishedContent.returns', 'publishedContent.shipping', 'publishedContent.payment', 'publishedContent.support']],
    ['hero_slides', ['imageUrl']],
    ['brands', ['logoUrl']],
    ['categories', ['icon']],
  ];
  for (const [collection, fields] of references) {
    const found = await mongoose.connection.collection(collection).findOne(
      { $or: fields.map((field) => ({ [field]: pattern })) },
      { projection: { _id: 1 } }
    );
    if (found) return true;
  }
  return false;
}
