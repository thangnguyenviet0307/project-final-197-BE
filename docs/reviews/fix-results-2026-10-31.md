# Follow-up to review-report-2026-10-31.html

The original report is retained as review evidence. This file records implementation status, not a production release certification. Existing unrelated work in both repositories is retained.

| Finding | Result | Main files |
| --- | --- | --- |
| F-001 | Article admin/public and product lists replace an out-of-range page after a settled successful current response, retaining filters. Placeholder/error responses cannot correct the URL. Product filter drafts survive page-only correction. | FE `src/hooks/use-valid-list-page.ts`, three list pages |
| F-002 | Category editors share the article editor session guard; close/navigation/unload protect dirty drafts and preserve original versions. Each session gets a fresh guard. | FE `features/articles/components/{article-editor-dialog,category-form}.tsx`, post-categories page |
| F-003 | Search inputs remount on applied search changes (and public article type changes), including history navigation; refetch retains local drafts. | FE admin/public article list pages |
| F-004 | Successful article navigation records one raw visit, including cached navigation. Rerender/refetch/StrictMode replay do not duplicate; failures do not block reading or retry. | FE `use-record-article-view.ts`, article service/detail |
| F-005 | Production remains unverified. Existing explicit index dry-run/apply tooling is tested on a fresh isolated local replica set, including repeatability and conflict refusal. No production access or migration performed. | BE `scripts/ensure-core-indexes.mjs`, integration tests |
| F-006 | Session/receipt/legacy replay pass finishes before fetching locality. New orders recheck session/receipt and reserve/create atomically in a second transaction. Provider waits never hold the relations lock; replay does not require locality. | BE `checkout.service.ts`, checkout regression tests |
| F-007 | Optional explicit `TRUST_PROXY_CIDRS` accepts IP addresses/non-global CIDRs. Default trusts no proxy; blanket trust/hop counts/invalid CIDRs are rejected. Actual hosting proxy topology and multi-instance enforcement still require staging acceptance. | BE `trusted-proxy.ts`, app and proxy tests |
| F-008 | Admin order sorting uses descending orderDate then descending unique _id. Equal-timestamp fixture checks adjacent pages on real local MongoDB. Offset pagination can still shift with concurrent insertions. | BE orders service and tests |
| F-009 | Storefront VND displays now retain up to two fraction digits, matching detail/checkout. Monetary arithmetic is unchanged. | FE `format-price.ts` |
| F-010 | Detail applies SEO title/description/canonical with safe fallbacks, updating per article and restoring previous head state on exit. No SSR/crawler rendering guarantee. | FE `use-article-head.ts`, detail and tests |
| F-011 | Opt-in summary projection omits long content for storefront lists. Default API/list and detail remain compatible. Synthetic 100,000-character fixture verifies >99% fewer JSON bytes, not a production latency claim. | BE article query/service; FE service/types |
| F-012 | Replaced accumulated contradictory frontend architecture history with a current description of checkout, cart, routes, editorial, state and verification. | FE `docs/frontend-structure.md` |

## Deployment acceptance still required

- F-005: authorized operator runs `pnpm.cmd build`, then `pnpm.cmd exec node scripts/ensure-core-indexes.mjs --database <database>` with MONGODB_URI explicitly supplied outside source control. Review missing/conflicting indexes first. Apply is a separate approved production change requiring `--apply --confirm-database <database>`. Do not drop indexes or rewrite duplicates automatically.
- F-007: determine actual trusted proxy peer addresses/networks; configure comma-separated `TRUST_PROXY_CIDRS` only for those peers. Do not copy a sample range without checking hosting topology. Restrict direct ingress, verify how the proxy sanitizes forwarded headers, and test two distinct client IPs plus spoofed headers at staging. Confirm 429/Retry-After. Limits remain per process; multi-instance deployment needs a gateway enforcing the intended shared policy.
- Browser/hosting: perform desktop/mobile navigation, back/forward search, modal/Escape/discard, slow-network/error handling and real head/network inspection. Automated DOM tests do not replace visual acceptance.

## Verification

Final results (2026-10-31):

| Repository | Command | Result |
| --- | --- | --- |
| Backend | `pnpm.cmd typecheck` | Passed |
| Backend | `pnpm.cmd test` | 304/304 passed, zero skipped |
| Backend | `$env:MONGOD_BINARY = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'; pnpm.cmd test:integration:local` | 20/20 passed on a fresh loopback-only replica set; server stopped afterward; production was not used |
| Frontend | `pnpm.cmd typecheck` | Passed |
| Frontend | `pnpm.cmd lint` | Zero errors; one existing react-refresh/only-export-components warning in `src/router/route-fallback.tsx:6` |
| Frontend | `pnpm.cmd test` | 524/524 passed across 70 files |
| Frontend | `pnpm.cmd test:contracts` | 31 service requests validated without HTTP/database connections |
| Frontend | `pnpm.cmd build` | Passed, including application/test TypeScript compilation |
| Both | `git diff --check` | Passed |

Initial regression runs exposed the extra checkout preparation pass being counted as a failed transaction by an existing test, and page correction remounting product filters mid-edit. Preparation now completes as a short replay-check pass and filters use a key derived from applied filter values. Final suites above include those corrections. No packages were installed and no commit/push/deployment or production data mutation was performed.
