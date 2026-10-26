# Sales API backend

Node.js, Express 5, TypeScript and Mongoose. Follow `AGENTS.md` when changing source.

## Development

Use a Node.js version compatible with the installed dependencies (this change was checked with Node 24.16.0), pnpm 11.9.0, and MongoDB **replica set or sharded cluster**. A standalone MongoDB server cannot execute the transactions used by bootstrap, order creation/cancellation, and product deletion. A local single-node replica set is sufficient; Atlas also supports transactions.

1. Run `pnpm install` (`pnpm.cmd install` if PowerShell blocks the `.ps1` shim).
2. Copy `.env.example` to `.env` if it does not exist. Set `MONGODB_URI`, distinct random `JWT_SECRET` and `JWT_REFRESH_SECRET`, and `PORT` (default 5000). Use strong random secrets, at least 32 bytes each.
3. Set a separate random `BOOTSTRAP_SECRET` only when initializing the first administrator.
4. Run `pnpm dev`. The server connects to MongoDB before listening.

Initialize with `POST /api/v1/auth/bootstrap`, a flat JSON body containing `email`, `password`, `firstName`, `lastName`, and header `x-bootstrap-secret` matching `BOOTSTRAP_SECRET`. Without a configured/matching secret, bootstrap returns 403. A persisted singleton lock prevents concurrent bootstrap or reinitialization after accounts are deleted. Remove `BOOTSTRAP_SECRET` from the environment after initialization. No migration or bootstrap is run automatically.

## API changes and compatibility

- JSON responses share `success`, `statusCode`, `message`, `data`; errors can include `errors`, lists can include `pagination`. The existing user `meta` field remains as a compatibility alias.
- The accounts/users list supports case- and diacritic-insensitive search via `GET /api/v1/users?search=<term>&page=1&limit=10`. Search email, first or last name, or multiple terms from a full name; results remain paginated.
- Product lists now honor `page` and `limit` (default 1 and 10); clients needing all products must paginate.
- Auth/user request bodies are flat JSON objects. Unknown fields are stripped. Password whitespace is preserved.
- Order items accept `{ productId, variantId?, quantity }`. A product with variants **requires** `variantId`; a simple product still accepts just `productId`. Price/SKU are read from the selected variant and snapshotted; client-supplied prices are ignored.
- Variant updates replace the supplied array. Send existing variant `_id` values to preserve their identity. Product stock is derived from variant stocks. Open orders prevent removal of their variants or conversion of a simple product to variants. Deleting a product referenced by an order returns 409.
- Changes to product stock use optimistic concurrency; stale edits return 409 and must be reloaded before retrying.
- Creation and rejection of orders update inventory in the same MongoDB transaction. Rejection failures leave the order and stock unchanged. Retry a 409 only after reloading current state.
- Legacy orders lacking `variantId` cannot be automatically reconciled against a product that now has variants; cancellation returns 409 for manual reconciliation instead of guessing a variant. No existing data is migrated.
- Refresh tokens are stored as SHA-256 hashes and rotated atomically. User responses omit password, refresh token, and session version. Logout, password changes, and disabling an account revoke existing access sessions through a version counter. Existing tokens issued before this change require signing in again. The design retains one refresh session per account.
- Legacy bcrypt passwords are verified using bcrypt and upgraded to Argon2id only after a correct login. Accounts missing `active` are treated as legacy enabled accounts and explicitly saved with `active: true` on successful login. Explicit `active: false` or `null` remains blocked. Hash upgrade, active backfill and refresh-session storage share one conditional update matching the previous hash and session version; concurrent password changes or account disabling prevent the login. Failed logins never migrate account data. New accounts and password changes continue to use Argon2.

## Verification

For shared VS Code REST Client sessions across `.http` files, run the local backend and `pnpm rest-client`, then log in once through `auth.http`. See [REST_CLIENT/README.md](REST_CLIENT/README.md) for setup, refresh, staff sessions, and test data order.

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm start
```

`pnpm test` compiles source then runs the built-in Node test runner without adding dependencies. HTTP tests start Express on ephemeral loopback ports; model calls are mocked and no database is contacted. Order service tests verify session propagation, errors, stock calculations, status transitions, and token rotation, but **do not prove MongoDB rollback/isolation**. A startup test launches the compiled server against an intentionally unavailable local test database and checks clean failure.

Real replica-set integration tests are provided separately: set `MONGODB_TEST_URI` to a dedicated test MongoDB deployment, then run `pnpm test:integration`. These tests use a generated `codex_test_*` database and clean up only their generated fixture documents. They do not read the application's `.env` connection string.

## Business integrity rules

- Reference changes, product inventory edits, order creation/status/assignment, and protected user changes share a transactional database lock. This prevents concurrent requests from bypassing reference checks, creating category cycles, or removing the last active administrator. It serializes these writes across API instances; higher throughput will require narrower locks while retaining the same invariants. Direct database writes and maintenance scripts must obey these rules too.
- The last active administrator cannot be disabled, demoted, or deleted. Reassign open orders before disabling a user. Users/customers/products referenced by orders cannot be deleted. Brands/categories referenced by products cannot be deleted; deactivate them instead. Inactive or deleted catalog entries cannot be selected for a new product or order.
- Category parents must exist and cannot introduce a cycle. Deleting an unused category detaches its children atomically.
- Existing variant IDs must belong to the product and be unique. An omitted variant stock/image/attribute field keeps its current value; sending `variants` still replaces the array. Clearing variants accepts an explicit simple-product stock, otherwise retains the current aggregate stock. Stock must be a nonnegative safe integer and match the sum of variant stocks.
- `PATCH /api/v1/orders/:id/assignee` lets administrators reassign a Pending/Processing order without changing its status. Processing and completion require an active assignee. `requireDate` cannot precede order creation. `shippingDate` represents completion time and is accepted only for completion, between order creation and now.
- New orders snapshot customer name/email/phone as well as item prices. Existing orders remain unchanged. Totals round each discounted line half up to two decimal places with integer arithmetic; totals outside the safe monetary range are rejected.
- Bcrypt login inputs exceeding 72 UTF-8 bytes are rejected because bcrypt cannot verify their suffix. Such legacy users need an administrator-assisted password change. Inputs within that limit retain the existing bcrypt-to-Argon2 migration.
- Login/bootstrap/refresh share a limit of 30 attempts per IP per 15 minutes per process. A deployment with multiple public API instances should enforce a shared limit at its gateway. The local REST Client proxy shares its loopback IP; a 429 includes `Retry-After`.
- Startup rejects standalone MongoDB. Production startup disables automatic index creation; provision schema indexes explicitly during deployment. Shutdown closes HTTP connections and disconnects MongoDB. Build scripts stop on failures.

The GitHub Actions workflow runs typecheck, unit/HTTP tests, build, and real integration tests against an isolated local MongoDB replica set. The integration suite covers rollback, overselling, exactly-once stock restoration, concurrent admin changes, category cycles, and category-delete/product-create races. A workflow added to the repository has not necessarily run yet; inspect CI results after pushing.

## Customer registration

POST /api/v1/auth/register accepts email, password (6–1024 characters), firstName and lastName (1–50 trimmed characters). Extra fields, including role, are rejected. Email is trimmed and lowercased. Duplicate emails return 409; invalid input returns 400. Registration uses the existing authentication rate limiter.

The endpoint creates an active User with role customer and an Argon2-hashed password. It returns 201 with the public user and no session tokens. The client should then open customer sign-in and use POST /api/v1/auth/login. Customer accounts have no management permissions. No existing records are migrated. Registration now creates a linked Customer contact in the same MongoDB transaction (Customer.accountId references User). Phone/address default to empty until provided. Administrative contact creation still requires phone/address. Existing contacts are never claimed by matching email; conflicting registrations return 409. Earlier accounts are not backfilled automatically. MongoDB must support transactions (replica set or sharded cluster).

### Browser sessions

Frontend origins are configured through FRONTEND_ORIGINS (comma-separated exact origins); local defaults are http://localhost:5173 and http://127.0.0.1:5173. Production must configure this list explicitly. Credentialed CORS is enabled only for allowed origins.

Browser login/refresh send X-Auth-Transport: cookie and a trusted Origin. Refresh tokens use an HttpOnly, SameSite=Strict cookie scoped to /api/v1/auth (Secure in production), and are omitted from JSON. Refresh reads the cookie; logout/password changes expire it. Keep frontend and API on the same site. REST clients without the header retain the existing JSON token contract.

## Registered accounts in customer management

GET /api/v1/users lists only admin/staff accounts; role filtering applies to both rows and counts before pagination.
GET /api/v1/customers/accounts lists User records with role=customer, including existing registrations. CustomerView permission is required. Query: page, limit, search (name/email), isActive. Response data includes only _id, firstName, lastName, email, active and createdAt, plus pagination. Customer contact CRUD remains separate; this does not migrate records or link accounts by email.

The frontend no longer displays the separate registered-account section. Newly registered customers appear through the existing GET /customers list and contact statistics; /users continues to exclude customer accounts. Contact deletion does not delete the login account.
