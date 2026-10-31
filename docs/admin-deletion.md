# Administrative deletion audit

DELETE routes require their existing administrative permissions. Frontend mutations invalidate lists only on successful responses; rejected requests keep the error visible.

| Module | Database operation | Conditions / related data |
| --- | --- | --- |
| Product | findByIdAndDelete | Reject if any order references it. Delete its reviews in the transaction and enqueue managed Cloudinary images for cleanup. |
| Category | findByIdAndDelete | Reject when referenced by products; move direct child categories to root. Hero slides retain their content and become hidden publicly; their editor supports missing categories. |
| Brand | findByIdAndDelete | Previously set isDeleted=true. Now physically removes an unreferenced brand, including a legacy soft-deleted target addressed by ID. |
| Customer | findByIdAndDelete | Reject if referenced by orders. Never delete a User with a matching email. |
| User | findOneAndDelete | Administrative accounts only; protect the last admin and order references. Never delete a Customer with a matching email. |
| Order | findOneAndDelete | Only rejected orders; stock restoration belongs to rejection, not deletion. |
| Hero | deleteOne | Require original expectedVersion; reject stale requests. |
| Review | deleteOne | Scoped to its product; metrics are computed from remaining reviews. |

Successful physical deletion removes the target document from MongoDB. Historical order snapshots are not catalog documents and are deliberately retained. External image cleanup may finish asynchronously. Gallery unlink now saves a durable image-cleanup job in the same transaction; a Cloudinary outage does not lose the retry task. Seed/import scripts are not invoked by deletion.

Previously soft-deleted brands are not purged by deployment. On 2026-10-28, the user explicitly authorized cleanup: 37 archived brands with isDeleted=true and zero product references were physically deleted in a majority-committed transaction from project-final-197. The 37 planned IDs were then confirmed absent; 17 brands remained. The archive is in ignored .local-backups/soft-deleted-brands-1793163650317.ejson. All 10 collections were scanned for isDeleted/is_deleted/deleted and dated deletedAt markers; only those 37 brands matched before cleanup. If Atlas still shows documents after a successful delete, compare the document `_id`, collection, database and deployed API environment; confirm the backend build actually contains the updated route. A reference conflict must return 409 rather than success.

## Read-only production index check

Run `pnpm.cmd build`, then `pnpm.cmd exec node scripts/audit-database.mjs` from the backend with the intended `MONGODB_URI`. It prints only database/collection names, counts and declared unique-index confirmation, never account records or credentials. It disables automatic index/collection creation. A timeout or failed connection does not confirm indexes. It never calls syncIndexes or removes records.

Missing unique indexes require a separate duplicate audit and reviewed migration. Do not blindly run syncIndexes on production.


## Confirmed Atlas verification, 2026-10-28
- After the user separately approved the index repair, variants.sku_1 (unique, non-sparse) was replaced by variants_sku_unique_sparse (unique, sparse). The replacement was created and confirmed before dropping the obsolete index. Index metadata is archived in ignored .local-backups/product-indexes-1793164198407.json. No product documents were changed.
- audit-database.mjs subsequently confirmed every schema-declared unique index, including its sparse/partial options. There were 17 brands, 20 categories, 100 products, 8 customers, 4 users, 2 hero slides, and no remaining isDeleted=true records in the audited collections.
- check-catalog-readonly.mjs compared ascending/descending discounted-price ordering, discounted price ranges and brand/category-name search against the 100 stored products. All checks passed without database writes.
- Catalog create/update validation is strict: clients cannot introduce isDeleted/deletedAt/slug/_id fields. Legacy soft-delete filters are defensive reads only; no running API sets deletion markers.
