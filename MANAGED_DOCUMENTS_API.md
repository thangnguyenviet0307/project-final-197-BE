# Policies and store information

All paths below start with `/api/v1/support`. Admin endpoints require authenticated Admin/Super Admin.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/admin/documents` | Fixed catalog with drafts, public content and publication metadata |
| GET | `/admin/documents/:key` | Draft, published content, metadata and `__v` |
| PUT | `/admin/documents/:key` | Save draft or publish only this document |
| DELETE | `/admin/documents/:key` | Clear draft, publication and statistics; retain version tombstone |
| GET | `/documents/:key` | Published content and metadata only; null if unavailable |
| POST | `/documents/:key/views` | Increment public views atomically; return `{ views }` |

Keys: `warranty`, `privacy`, `shipping`, `returns`, `gioi-thieu`,
`dieu-khoan-su-dung`, `cau-hoi-thuong-gap`. These are fixed website sections; adding a new
article means filling an empty section, not creating arbitrary route names.

Payment/support are no longer independent managed documents: their editor/public routes
and per-document API access are removed. The legacy main policy snapshot and stored data
remain intact. Checkout, order cancellation, contact and warranty handling are unaffected.

PUT body: `{ "content": "<p>Content</p>", "publish": true, "expectedVersion": 3 }`.
DELETE body: `{ "expectedVersion": 3 }`. Responses use the existing `{ data }` envelope.
Unknown keys/fields, empty publication and invalid versions are rejected. Policy sections are
limited to 30,000 characters; information pages to 30,000 characters, including HTML.

Policies remain in `store_policies`, with publication metadata per section under `publications`.
Information remains in `store_information`, with metadata under `publication`.
Each metadata object contains `publishedAt`, `updatedAt`, `views`. No historical data migration
is run. Existing published content falls back to its stored legacy publication date and zero views.

First publication sets the date. Publishing changed content preserves that date and sets updatedAt.
An unchanged publication does not alter updatedAt. Draft saves never change public metadata.
Deletion clears the publication and counters; republishing starts a new date and zero views.
The version remains after deletion, preventing stale drafts from overwriting a recreated article.
Policies still share their existing document version, so concurrent section edits can conflict.
Every write requires the original version and returns 409 VERSION_CONFLICT when stale.

Views count successful public article openings, not unique people. GET/refetch does not increment.
Frontend records once per mounted navigation, including React StrictMode protection; view failures
do not prevent reading and are not automatically retried. Counters do not modify the draft version
or timestamps. A per-process 120 requests/minute/IP limiter bounds the view endpoint.

`/auth/policies` is the management list. Individual editor paths remain `/auth/policies/:key`.
Public dates and counts appear below the article body, with updatedAt on a separate line.
The existing legacy snapshot and information endpoints remain available for compatibility;
the new management UI uses these per-document endpoints.
