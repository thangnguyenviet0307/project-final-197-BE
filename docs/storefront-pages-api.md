# Storefront content pages API

These public, read-only endpoints provide the content rendered by the
DemoStore introduction and FAQ pages. They use the standard API response
envelope and do not require authentication or a database connection.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/storefront/pages/about` | Introduction page content |
| GET | `/api/v1/storefront/pages/faq` | FAQ heading, categories and questions |

Both endpoints return `200` with:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {}
}
```

The `about` data object contains `eyebrow`, `title`, `highlight`, `intro`,
`story`, `offerings`, `principles`, `steps` and `notice`. Each card or step
contains a `title` and `description`; `story.paragraphs` is an array of text.

The `faq` data object contains `eyebrow`, `title`, `intro` and `categories`.
Each category has an `id`, display `label`, `title` and `questions` array.
Each question has a stable `id`, `question` and plain-text `answer`. The
frontend filters these questions locally by topic and search text.

Content is maintained in `src/services/storefront-content.service.ts`.
The endpoints intentionally do not provide write operations or imply
administrator-managed CMS functionality.

## Verification

Run `pnpm.cmd typecheck` and `pnpm.cmd test` in Backend. The related calls are
also available in `REST_CLIENT/storefront-pages.http`.
