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
