import 'dotenv/config';
import { configureCloudinary } from '../dist/config/cloudinary.js';
import { getCloudinaryFolder } from '../dist/config/cloudinary-folders.js';

const storage = configureCloudinary();
for (const kind of ['articles', 'hero']) {
  const folder = getCloudinaryFolder(kind);
  await storage.api.create_folder(folder);
  console.log(`Cloudinary folder ready: ${folder}`);
}
