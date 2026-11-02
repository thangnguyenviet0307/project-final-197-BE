# Product badges and related news

Admin product flags define merchandising. On sale controls public display/ordering and has no badge; explicit false hides the product regardless of other flags. Catalog/related cards show only Best Seller/New/Hot badges. Each home carousel shows only its own Home/New/Hot/Best Seller badge, in Vietnamese. Discount price/percentage still comes from actual price data.

## Configure related news

Open **Products → product detail → Tin tức liên quan của sản phẩm** as Admin/Super Admin. Search news, select at most five, use Lên/Xuống to set display order, then Lưu tin liên quan. Remove all selections and save to clear. This is independent of inventory, gallery and other metadata editors. Existing products start with no selected news.

Draft/scheduled posts may be selected in advance, but the storefront displays only currently public news with available managed categories. Missing/archived/hidden posts disappear publicly; there is no automatic fallback. The editor retains missing IDs so the admin can explicitly remove/replace them. Conflict responses retain drafts and require the explicit reload action before saving again.

## API

- `GET /api/v1/products/:id/news`: authenticated ArticleManage roles; returns `{ articleIds, expectedVersion, articles }`. Article summaries include title/slug/excerpt/image/publication/status, not content.
- `PATCH /api/v1/products/:id/news`: requires ProductUpdate and ArticleManage. Strict JSON `{ articleIds: string[], expectedVersion: number }`; at most five distinct normalized ObjectIds. Empty array clears. Missing/non-news targets return 400; missing product returns 404; stale product version returns 409 `VERSION_CONFLICT`. Selection validation and save share the relations transaction.
- `GET /api/v1/products/public/:slug/news`: anonymous; verifies public product/catalog visibility and returns selected public news summaries in configured order. Excludes content/status/version/audit fields. No selections returns `[]`; hidden/missing product returns 404. Stopped products are hidden under the updated on_sale visibility policy.

Persistence adds an optional `relatedNewsIds` ObjectId array to Product with an empty default. No migration, seed, production data mutation or deployment is performed. Product optimistic concurrency protects the separate editor against inventory/gallery/metadata changes too.

## Verification

Tests cover multiple/disabled badges, no invented discount, article selection/order/limits, background refetch and conflict preservation, explicit reload using the returned version, sidebar loading/retry, strict input and role rejection. MongoDB integration covers persisted order, version conflicts, non-news/missing targets, publication/category filtering, deletion and stopped/hidden products.

- Backend `pnpm.cmd typecheck`: passed; `pnpm.cmd test`: 307/307 passed.
- Backend `pnpm.cmd test:integration:local` with the installed MONGOD_BINARY: 28/28 passed on a fresh loopback-only replica set; it was stopped afterward.
- Frontend `pnpm.cmd typecheck`: passed; `pnpm.cmd test`: 543/543 passed across 72 files. The suite includes contextual carousel badges, hidden stopped cards and the sidebar/related-products container boundary.
- Frontend `pnpm.cmd test:contracts`: 33 service requests validated without HTTP/database access.
- Frontend `pnpm.cmd lint`: zero errors, one existing react-refresh warning in `src/router/route-fallback.tsx:6`.
- Frontend `pnpm.cmd build` and both repositories' `git diff --check`: passed.

No visual browser/device acceptance was performed; sidebar responsiveness is implemented in CSS and the automated UI checks use DOM rendering.

## Follow-up: badge contexts and sticky boundary

The main information and sidebar share a two-column grid at xl widths. Related products are a following sibling outside this grid, so the sticky sidebar stops before that section. Below xl the sidebar uses normal document flow. Backend product view recording now uses returnDocument: after instead of the deprecated new option; real MongoDB verification checks counter return value and unchanged inventory version/timestamp.
