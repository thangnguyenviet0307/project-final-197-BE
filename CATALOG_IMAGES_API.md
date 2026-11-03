# Brand/category images and initial warranty attachments

Brand/category POST and PUT endpoints now accept `multipart/form-data` in addition
to their existing JSON contracts. Fields remain name, description, isActive and
parent (categories). The file field is `image`: one JPG/PNG/WebP, at most 5 MB.
Multer validates transport limits, existing product-image signature validation
checks bytes, and the server uploads through the configured Cloudinary account.
Multipart booleans are `true`/`false`; an empty or `null` parent means no parent.
Unknown fields are rejected. File-only PUT requests are supported.

Authentication/BrandCreate/BrandUpdate or CategoryCreate/CategoryUpdate checks run
before parsing an upload. Staff cannot upload catalog images. Cloud uploads occur
outside MongoDB transactions; saving the URL and managed asset ID uses existing
catalog persistence/transaction rules. Failed saves remove the new upload. After a
successful replacement, only the old managed asset is cleaned up. Legacy external
URLs are never destroyed. Failed deletions use the existing cleanup queue/worker.
Deleting an unreferenced catalog record also schedules cleanup of its managed image.

Brand responses retain `logoUrl`; category responses retain `icon`, so storefront
rendering continues to work. `imagePublicId` tracks ownership for cleanup and is
never accepted from client input. Existing JSON URL payloads remain compatible.
No existing images are migrated and no production data change is run automatically.

Frontend catalog forms use file selection, local previews and submit-time upload;
they retain the selected File if saving fails. Brand/category creation is not
followed by a second image mutation, avoiding an extra partially completed save.

Warranty creation now offers optional selection of up to five JPG/PNG/WebP images,
5 MB each, before submission. Creation keeps its existing JSON requestId/replay
contract. After creation confirms the request ID, the form calls the existing
multipart `/support/customer/requests/:id/images` endpoint sequentially. It retains
the confirmed request ID, Files and successful uploads for explicit retries. A
failed later upload never creates a new request or resends confirmed uploads.
Uncertain image uploads retry the same bytes and use Backend digest deduplication.
The form reports partial success and offers opening the created request with a
draft-discard confirmation. Initial and subsequent uploads share the same five-image
limit, ownership, submitted-only checks, authenticated assets and signed URLs.

All images use the existing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and
CLOUDINARY_API_SECRET configuration. Real browser/Cloudinary/MongoDB acceptance
remains separate from mocked verification. Local selections cannot survive closing
or force-reloading the browser tab.

Upload folders are configured independently with CLOUDINARY_PRODUCT_FOLDER,
CLOUDINARY_BRAND_FOLDER, CLOUDINARY_CATEGORY_FOLDER and CLOUDINARY_WARRANTY_FOLDER.
Product and warranty uploads append the product/request ID to their base folder;
brand/category uploads use unique Cloudinary public IDs inside their configured folder.
These values are folder paths, not URLs. Existing assets remain at their stored
public IDs; a configuration change affects only subsequent uploads. Defaults retain
the former project-final/products, brands, categories and warranty paths when unset.
