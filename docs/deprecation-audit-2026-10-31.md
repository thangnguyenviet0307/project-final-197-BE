# Deprecation audit — 2026-10-31

Scope: application TypeScript/TSX, configured frontend test/build files, and repository-owned JavaScript scripts/tests in both sibling repositories. Replaced deprecated API usage supported by the installed dependency versions. No package upgrades, lockfile edits, production access or deployment were performed.

## Changes

| Area | Replaced | Current usage / preserved behavior |
| --- | --- | --- |
| Zod email/URL | String `.email()` / `.url()` format methods | `.check(z.email(...))` / `.check(z.url())`, retaining trimming, maximum lengths, HTTP(S) restrictions, normalization and Vietnamese errors |
| Zod dates | `z.string().datetime(...)` | `z.iso.datetime(...)`, retaining offset requirements |
| Zod numbers | `.finite()` and redundant `.safe()` after `.int()` | Zod 4 `z.number()` already rejects infinity/NaN; `.int()` already enforces safe integers. Existing bounds remain |
| Zod refine options | `{ message: ... }` refinement options | `{ error: ... }`. Issue objects from `ctx.addIssue` still use `message`, as required by that API |
| React form event types | `FormEvent` | React `SubmitEvent` for the affected submit handlers; no runtime form changes |
| TanStack Query | `queryClient.fetchQuery(...)` in auth initialization | `queryClient.query(...)` available in installed query-core 5.104.3; same query key, function, staleTime and session guards |
| Browser unload | Deprecated `BeforeUnloadEvent.returnValue` assignments | Keep the existing `event.preventDefault()` and dirty/saved guards; target current browsers, not pre-Chrome-119 legacy fallback behavior |
| Fast Refresh | Utility and component exports mixed in route-fallback.tsx | Move `isStorefrontRoute` to `router/route-area.ts`; update all internal imports and existing route tests |

The Mongoose deprecated `new` update option was already replaced in the preceding task. This audit confirms repository application code has no remaining `new: true/false` update options or legacy remove/ensureIndex/connection options identified by the targeted search.

## How the scan works

`scripts/audit-deprecations.mjs` uses TypeScript symbol and resolved-call-signature metadata from the installed declarations, including contextually typed option properties. It does not import application modules, load `.env`, emit application code or connect to a database. Findings cause a nonzero exit status.

For overloaded DOM APIs, a deprecated overload for an obsolete HTML tag does not make normal `createElement("meta")` or `querySelector(...)` calls deprecated. The scanner checks the resolved signature rather than blindly replacing those legitimate calls.

Backend's installed native TypeScript 7 distribution does not expose the legacy JavaScript compiler API. For analysis only, the script reuses the sibling frontend's installed TypeScript 6.0.3 compiler API. Actual Backend typecheck/build/tests still use its own configured compiler. No new package was installed.

Run from Backend:

```powershell
pnpm.cmd exec node scripts/audit-deprecations.mjs . tsconfig.json
```

Run from Frontend:

```powershell
pnpm.cmd exec node ../project-final-197-BE/scripts/audit-deprecations.mjs . tsconfig.app.json tsconfig.node.json tsconfig.test.json
```

Raw final inventories: [Backend](reviews/deprecation-backend.json), [Frontend](reviews/deprecation-frontend.json).

## Verification

Final static audit: **206 Backend files + 446 Frontend files = 652 repository-owned files; zero findings**. Regression tests specifically retain email normalization, optional empty personal email, URL trimming/HTTP rejection, date offsets, non-finite money rejection and unsafe quantity rejection. Existing session initialization, navigation/unload, cart, checkout and editorial suites exercise the updated call sites.

| Check executed | Result |
| --- | --- |
| BE `pnpm.cmd typecheck` | Passed |
| BE `pnpm.cmd test` | 307/307 passed, no skipped tests |
| BE `pnpm.cmd test:integration:local`, with installed MONGOD_BINARY and NODE_OPTIONS=--trace-deprecation | 28/28 passed on a fresh loopback replica set; no deprecation warning observed; database stopped afterward |
| FE `pnpm.cmd typecheck` | Passed |
| FE `pnpm.cmd test` | 546/546 passed across 73 files |
| FE `pnpm.cmd lint` | Passed with zero errors and zero warnings |
| FE `pnpm.cmd test:contracts` | 33 requests validated without HTTP/database access |
| FE `pnpm.cmd build` | Passed |
| Both `git diff --check` | Passed |

## Sources and limits

- [Zod 4 migration guide](https://zod.dev/v4/changelog): current string format functions, number behavior and error option migration.
- [WHATWG BeforeUnloadEvent](https://html.spec.whatwg.org/dev/nav-history-apis.html#the-beforeunloadevent-interface): use preventDefault rather than legacy returnValue.
- Installed `@types/react` declarations explicitly deprecate FormEvent in favor of the event matching the handler; these submit handlers use SubmitEvent.
- Installed query-core 5.104.3 `src/queryClient.ts` documents query() as the replacement for fetchQuery(); its implementation and declarations were inspected before changing auth initialization.

Zero findings means no deprecated usages were found through the available installed type metadata and targeted source searches in this scope. It does not prove there are no deprecations inside third-party packages, dynamic/untyped calls or future releases. Generated dist/node_modules, archived HTML review assets and production/browser behavior are not certified by the static scan. No dependency latest-version audit or mass upgrade was performed.
