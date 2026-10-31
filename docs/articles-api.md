# News and blog API

The news and blog API is mounted at `/api/v1/articles`. Both content types use
the same article model; `type` is `news` or `blog`. Public reads are anonymous.
All management routes require a valid administrative login with the
`articles:manage` permission (currently Admin only). Staff and customer
accounts cannot create, edit, publish, or delete articles.

## Public endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/public` | Published list with pagination, search, filters, and sorting |
| GET | `/public/:slug` | Published article detail |
| POST | `/public/:slug/views` | Record one view for a visible article |
| GET | `/public/categories` | Categories currently used by visible articles |
| GET | `/public/tags` | Tags currently used by visible articles |

`GET /public` accepts `page` (default 1), `limit` (default 10, max 100),
`search` (up to 120 characters), `type`, `category`, `tag`, `isFeatured` and
`sort=newest|oldest|popular`. The response contains card-ready `title`, `slug`,
`category`, `excerpt`, `imageUrl`, `type`, `tags`, `authorName`,
`publishedAt`, `isFeatured` and `viewCount`, plus `pagination`. The detail
response also includes the article `content` and SEO metadata. Hidden admin
fields, author account IDs, and version fields are not returned publicly.

Scheduled articles become publicly visible at their `publishAt` time without
requiring a separate scheduler process. View counts change only through the
explicit view endpoint, not through a detail read. The view endpoint allows
up to 60 requests per IP per 15 minutes per API process; consumers should avoid
counting repeated page-load retries as separate views.
After a scheduled publish time passes, the article remains in the `scheduled`
management status until an Admin changes it to `published`; the public API
continues to expose it and normal content edits remain possible.

## Management endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Paginated article management list |
| GET | `/stats` | Total, counts by status, and aggregate views |
| GET | `/categories` | Categories in all managed articles |
| GET | `/tags` | Tags in all managed articles |
| POST | `/` | Create an article |
| GET | `/:id` | Read the full managed article |
| PATCH | `/:id` | Partially update an article |
| DELETE | `/:id` | Delete an article using its expected version |

The management list supports the public filters and `status=draft|scheduled|
published|archived`. Search and pagination limits match the public list.

### Create example

```json
{
  "type": "news",
  "title": "Cách chọn cáp sạc phù hợp",
  "slug": "cach-chon-cap-sac-phu-hop",
  "category": "Cẩm nang chọn mua",
  "excerpt": "Những yếu tố cần kiểm tra trước khi chọn cáp sạc.",
  "content": "Nội dung bài viết...",
  "imageUrl": "https://example.com/cap-sac.jpg",
  "tags": ["cáp sạc", "hướng dẫn"],
  "authorName": "Ban biên tập",
  "status": "draft",
  "publishAt": null,
  "isFeatured": false,
  "seo": {
    "title": "Cách chọn cáp sạc phù hợp",
    "description": "Hướng dẫn chọn cáp sạc cho thiết bị của bạn.",
    "keywords": ["cáp sạc", "phụ kiện"],
    "canonicalUrl": null
  }
}
```

`slug` is generated from `title` when omitted and must be unique. Categories
and tags are editorial labels, not references to the product catalog. Content
is stored as text/Markdown; clients must render it with a Markdown renderer
that escapes embedded HTML rather than inserting untrusted HTML directly.
Images and canonical URLs, when provided, must use HTTP or HTTPS.

Statuses are `draft`, `scheduled`, `published`, and `archived`. A scheduled
article must have a future `publishAt`; a published article cannot be scheduled
for a future time. Publishing sets `publishedAt`; scheduling uses its planned
date. Draft and archived content is never exposed by public endpoints.

### Concurrency and errors

Management reads include Mongoose `__v`. Every PATCH body must include
`expectedVersion` and at least one editable field; DELETE requires
`{ "expectedVersion": 0 }` (using the version actually read). Stale writes
return `409 Conflict`, as do duplicate slugs. Invalid/unknown request fields
are rejected. Standard API response fields are `success`, `statusCode`,
`message`, `data`, and, for lists, `pagination`.

The storefront currently displays static article cards. Its fields map to
`title`, `category`, `excerpt`, and `imageUrl`; replace the mock with
`GET /public?type=news` or `?type=blog` when wiring the UI. The API does not
add comments or reader accounts because those interactions are not present in
the current FE.


## Quản trị và danh mục (cập nhật)

Collection hoạt động: `posts`, `categories_post`. Giữ nguyên URL `/api/v1/articles`.

- `GET /articles/category-options`: danh sách danh mục cho Admin/Super Admin.
- `POST /articles/category-options`: `{name, slug, description, isActive}`.
- `PATCH /articles/category-options/:id`: các trường đổi và `expectedVersion`.
- `DELETE /articles/category-options/:id`: body `{expectedVersion}`; trả 409 nếu có bài đang dùng.
- `GET /articles/public/category-options`: danh mục đang bật, không cần đăng nhập.
- Bài viết nhận `categoryId` để tham chiếu danh mục. API tương thích `category` theo tên nhưng tên phải tồn tại trong danh mục đang bật. Server gán nhãn từ danh mục, không tin nhãn gửi lên.
- Bổ sung `sortOrder` (0-10000). Trang chủ dùng `GET /articles/public?type=news&isFeatured=true&sort=display&limit=3`. Thứ tự nhỏ trước, ngày xuất bản/ID giảm dần khi trùng thứ tự.
- `isFeatured` chỉ là lựa chọn trang chủ; trạng thái và thời gian xuất bản vẫn quyết định có công khai không. Tắt danh mục ẩn các bài thuộc danh mục. Đổi tên danh mục cập nhật nhãn và phiên bản bài trong transaction.
- Cập nhật/xóa bài và danh mục đều kiểm tra phiên bản; lỗi phiên bản trả 409 `VERSION_CONFLICT`. Giữ slug nếu không gửi slug. Nội dung là văn bản thuần, không phải HTML.
- API management bị chặn với Staff/Customer; không thay quyền của các module khác.

## Chuyển dữ liệu articles cũ

Không tự chạy migration khi khởi động. Sao lưu và dừng các writer sử dụng phiên bản cũ trước khi chuyển dữ liệu. Script giữ nguyên `articles` làm nguồn, copy sang `posts`, tạo danh mục theo tên, giữ `_id`/slug. Không ghi đè bài đã có và dừng khi có xung đột.

```powershell
# Chỉ đọc, xem database đích, số lượng và blockers (MONGODB_URI từ môi trường/.env)
pnpm.cmd exec node scripts/migrate-articles-to-posts.mjs
# Chỉ chạy sau khi đã duyệt dry-run và có quyền thay đổi database đó
pnpm.cmd exec node scripts/migrate-articles-to-posts.mjs --apply --confirm-database=TEN_DATABASE
```

Apply dùng MongoDB transaction, cần replica set. Không chạy seed/purge để chuyển bài. Script không xóa collection nguồn; trước khi migration, bài cũ trong `articles` chưa được API mới đọc từ `posts`. Việc tạo indexes được giới hạn ở các model editorial; không dùng syncIndexes diện rộng.
# Review follow-up (2026-10-31)

Public list requests may pass `summary=true` to omit `content`. The default list response and public detail remain compatible and include content. Storefront cards/catalog request summaries; full article text is fetched only by detail. This preserves existing clients while reducing long-body payloads. A synthetic 100,000-character fixture verifies over 99% fewer JSON bytes for its summary; this is not a production network benchmark.
