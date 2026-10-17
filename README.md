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
