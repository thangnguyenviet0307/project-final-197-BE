# AI module

## Set up automatic synchronization and semantic search

1. Configure the provider keys/models in the backend environment (see .env.example), restart the backend, then enable the assistant in AI administration. Embeddings require GEMINI_API_KEY; actual build failures are shown separately.
2. Create an embedding version. Choose ordinary MongoDB cosine for a small store (maximum 5,000 chunks), or Atlas Vector Search if supported with search-index permissions. Ordinary MongoDB still needs the replica-set/transaction support used throughout this project.
3. Leave "Bật đồng bộ tự động sau khi tạo" selected to persist indexing enabled together with the new version. No `AI_VECTOR_INDEX` environment value is needed for ordinary MongoDB. The worker picks up work within a minute.
4. Wait for ready status, then explicitly activate the version. Activation enables semantic retrieval. Published knowledge and eligible products feed the existing chat/search flows; keyword/catalog fallback remains available.
5. The worker refreshes every 15 minutes using successor snapshots, reuses unchanged vectors, and switches only after verification. Changes during a build are reconciled on a later scan. Disabling indexing prevents new tasks; running tasks keep their captured configuration.

Website daily budgets and indexing budget shares are removed. Provider rate limits/timeouts still pause and retry indexing after five minutes. Persisted chunks survive restarts. Authentication, billing and incompatible infrastructure failures require operator attention. The admin shows real progress and retry time.

At 20 saved versions, automatic ordinary-MongoDB refresh can retire the oldest inactive automatically generated ready snapshot after the five-minute deactivation guard. Manual versions remain. If all versions are protected, remove an unused version manually. Atlas search indexes are never dropped automatically; their lifecycle and service quotas still require infrastructure management.

Exact cosine search streams the complete active generation in bounded batches and retains only the top 40 matches. Capacity overflow fails explicitly; move to Atlas for a larger catalog. Existing versions retain their original backend and provider/model/dimension isolation. No live provider calls or production configuration mutations are performed by tests.

The AI module lives in the existing Express API and React storefront. It does not create another website. No production database or provider calls were used to implement it.

## Conversation lifecycle and retention

Semantic search activation is separate from chat enablement. Saving semanticEnabled requires a ready, active Gemini embedding version (or the supported environment index). The admin keeps semantic enablement disabled until that prerequisite is ready, while still permitting an invalid legacy selection to be switched off. A pending generation paused with the removed application's AI_USAGE_LIMIT resumes on the worker's next eligible tick without waiting for its obsolete daily reset; unexpired leases and upstream quota retries remain enforced. The first ready generation still requires explicit activation.

AI HTTP tasks distinguish server-observed client disconnects from upstream cancellation and deadlines. Disconnects abort pending work with an internal marker and do not log an unhandled 500 or attempt a response on a closed connection. The 70-second HTTP deadline aborts upstream work with the same HTTP 504 reason returned to the error middleware. Unexpected AbortErrors remain observable; sent headers delegate live errors to Express, and closed/finished responses are never written again. Request, response and signal listeners plus deadline timers are removed when the task settles; late work rejections remain observed.

- Closing/minimizing the widget does not end the conversation. **Kết thúc** explicitly ends it. A new chat creates a different conversation.
- An active conversation automatically ends after **one hour without a submitted message**. Reading history, socket pings, minimizing and reconnecting do not extend activity. The server enforces the deadline, including when its worker was offline.
- Guest conversation and message expiry is **effective completion time +24 hours**. Automatic completion time is last activity +one hour, not the later time a cleanup worker happens to run. All guest turns share the conversation's expiry.
- Authenticated Customer messages expire independently **30 elapsed days from submission**, using a rolling cutoff; completion does not extend that deadline. Conversation metadata expires 30 days after its last submitted message.
- Database transactions serialize sending, completion, leases and guest expiry updates. Identical requestId/content is replayed; changing content conflicts. Only one turn per conversation can generate at once. A lease abandoned by a crashed worker becomes failed rather than generating a second paid response automatically.
- All history reads exclude expired records immediately. MongoDB TTL and a minute-based worker remove records physically in the background; deletion is eventual, not guaranteed at the exact millisecond. Retention does not cover independently managed infrastructure backups.
- Guest identity is a signed HttpOnly cookie, with only a digest stored as owner ID. Customer access uses the existing active/account-enabled/tokenVersion checks. Guest chats are never silently merged into a Customer account.
- Clients explicitly initialize private chat access with POST /session. The frontend serializes initialization (Web Locks across tabs where supported; shared promise within a tab), before creating/listing chats or requesting tickets. Only /session can issue/renew the cookie; renewal preserves its value. Private requests without a valid guest cookie return 428, with no Set-Cookie. Public AI search requests do not identify guests or change cookies. This prevents background request responses from overwriting the chat owner. Browser-cookie expiry is renewed separately from chat retention.

## Configuration and automatic routing (2026-11-14)

This section replaces the earlier database-credential and Gemini/OpenAI/xAI configuration. Chat providers are now Gemini, Groq, OpenRouter and Cloudflare Workers AI. OpenAI and xAI adapters and web connection CRUD/test/selection APIs have been removed. The `openai` SDK remains a transport for the vendors' compatible endpoints; there are no OpenAI or xAI service calls.

Keys and chat model lists are read exclusively from the backend environment. Start with `.env.example`; never place secrets in VITE variables or send them in chat. Configure GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID only for the providers you use. Missing keys skip that provider. Models have backend defaults; *_CHAT_MODELS and legacy AI_CHAT_MODEL are optional overrides. Set *_CHAT_MODELS to comma-separated model IDs and AI_PROVIDER_ORDER to the provider priority. OpenRouter accepts only openrouter/free or :free models. Other providers still require a Free Tier account/eligible model; code cannot override their billing plans. Restart all backend instances after environment changes. No live calls run on save/deployment.

The router applies independently to intent extraction and streamed answers. It tries each configured candidate at most once when upstream quota/429 is returned. It retains the question, store context, history and requestId. Shared ai_provider_states records contain only hashed quota scopes, reset times and safe reasons, never API keys/prompts. Minute throttling honors Retry-After, otherwise waits 60 seconds. Recognized daily limits use Retry-After when supplied, otherwise next Pacific midnight for Gemini or next UTC day for the other providers. Unknown 429 is treated as temporary, not assumed daily. Known daily quota conservatively blocks the account's entire pool. Stable *_QUOTA_GROUP labels coordinate accounts/projects across key rotation and replicas. Identical configuration is required on every instance.

Once any answer text has been emitted, a failure preserves that partial answer as incomplete instead of concatenating output from another model. Future turns can use the next available provider. Cancellation, per-user/IP anti-spam limits, authorization errors, malformed output and policy refusals do not trigger quota fallback. Existing socket/HTTP deadlines still cover all attempts; switching does not reset them. No transcript is rewritten or regenerated automatically. All exhausted candidates return safe failure feedback; normal catalog search remains available.

Provider attempts are counted for monitoring without enforcing any website daily cap, including failures and indexing. Old AI_DAILY_CALL_LIMIT, *_DAILY_CALL_LIMIT and database dailyCalls values are ignored. Per-user/IP anti-spam, input/output sizes, execution deadlines and provider quota cooldowns remain. Embedding indexing no longer has a 25% daily allowance. One chat turn may consume several provider requests.

The admin page displays the environment routing order and cooldowns without key/model editing, deleting or manual activation. Operational enablement, semantic/index/risk switches, audit and embedding version management remain in MongoDB with revision conflict checks. Saving settings never imports or stores keys; the runtime never decrypts or uses legacy database credentials. Existing encrypted legacy records are left untouched, not deleted automatically. Put required keys in deployment secrets/.env before upgrading. No encryption key is required for new operations.

Embedding stays independent and pinned by generation/model/dimensions. New versions use Gemini from .env; existing Gemini versions retain their IDs and vectors even if their legacy connection UUID differs. Exact/Atlas builds, readiness verification, leases, cancellation, retries, activation, rollback and automatic successors remain. Retained OpenAI embedding versions are readable/deletable metadata but cannot run or activate; when one was active, semantic retrieval is disabled rather than mixing its vectors with Gemini. Build and activate a Gemini version explicitly. The migration never deletes old chunks or chat history.

Official protocol and quota references: [Gemini limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Groq compatibility](https://console.groq.com/docs/openai), [Groq limits](https://console.groq.com/docs/rate-limits), [OpenRouter API](https://openrouter.ai/docs/api_reference/overview), [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits), [Cloudflare compatibility](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [Cloudflare errors](https://developers.cloudflare.com/workers-ai/platform/errors/).

## Search infrastructure and indexing

Cheapest, most expensive and newest intents use database sorting across the complete eligible catalog, with the shared discounted variant-price calculation and public visibility rules. Their `scope` is `catalog`; ordinary semantic/keyword suggestions remain `ranked-candidates`. Chat preserves the full question up to 2000 characters, previous structured filters and stable product IDs; named comparisons read each exact name/SKU separately and missing ordinal references trigger clarification. Generic quick prompts ask for the missing requirements without a provider call.

Published policy retrieval scans overlapping passages across the entire live document and supplies a bounded relevant excerpt, including relevant content near the end. Stored vector text must still exist in the live published body. System instructions ground answers in current verified data and distinguish global sorting from candidate suggestions.

Provider failures use safe codes for unavailable service, credit exhaustion, rate limits, authorization, timeout, malformed responses and output limits. Failed turns retain sanitized error metadata for history/replay. Incomplete output never becomes completed. Logs contain only safe codes, stage and request ID; admin status exposes the latest 20 failure summaries without chat content. When saving a failure cannot be confirmed, the socket omits terminal status and asks the client to reload history.

MongoDB must support `$vectorSearch`; ordinary MongoDB transaction support alone is insufficient. Create a vector-search index on **ai_knowledge_chunks** through the deployment's supported administration tools, for example:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    { "type": "filter", "path": "embeddingModel" }
  ]
}
```

Index provisioning and initial production indexing are explicit deployment steps, not an automatic migration. Verify deployment capability, index readiness and the intended database before enabling AI_INDEX_ENABLED. Changing the embedding model requires reindexing; old-model vectors are excluded.

Indexing reads only current public catalog DTOs and published managed documents. It chunks text with overlap, hashes source/model content, skips unchanged embeddings and retries on failure. A database lease coordinates workers; successful sweeps are scheduled every 15 minutes. Admin can queue another sweep. Hidden/deleted sources are always revalidated against live visibility before use. Index propagation can lag; current prices/stock are read from existing storefront services.

Lease heartbeat failures abort provider work. Each chunk write/delete is fenced by a transaction that writes the current unexpired lease row before mutating chunks, so a worker replaced during an embedding call cannot commit stale results. A reindex request arriving during an active sweep is kept for another sweep.

Search combines keyword and semantic candidates using reciprocal ranks. Price/brand/category UI filters take precedence over extracted intent. AI search paginates a **bounded ranked candidate pool** (up to 100 catalog keyword products, 40 SKU/description matches and 40 vector chunks); `total` describes that pool, not the whole catalog. Ordinary catalog pagination remains unchanged. Missing vector infrastructure/provider failure falls back to catalog keyword search. Do not describe the fallback as semantic search.

Chatbot sources are data, not instructions. Model output cannot run arbitrary queries or mutate business data. HTML is converted to text before indexing; frontend renders answers as text and only server-supplied local source/product links are clickable. This limits impact of prompt injection but is not a claim that LLM answers are infallible.

Public product DTO mapping is shared with the existing storefront. AI cards load in batches without review/order aggregations. Successful intent and query-embedding intermediates have a bounded, process-local five-minute cache, allowing pagination to reuse provider work; prices, stock and visibility are never cached there. An explicitly requested unknown brand/category returns no matches rather than broadening to unrelated products. The product-detail AI recommendation section and its dedicated endpoint were removed on 2026-11-12; AI chat and smart search still provide product cards.

Cancellation flows through retrieval, intent extraction, embeddings and answer generation. Public HTTP tasks reject at the 70-second deadline even if underlying work ignores cancellation; MongoDB retrieval operations also receive cancellation and execution limits. Frontend timeout is 75 seconds. Chat completion refreshes only owner-scoped conversation queries. History stores immutable product IDs and loads current public cards in a batch, preserving identity across slug changes/reuse. Hidden/deleted products are omitted. Legacy slug-only turns retain their transcript without inferred product cards.

Concurrent identical intent/embedding requests share one in-flight computation. Each subscriber can cancel independently; the underlying computation aborts when its last subscriber leaves. Failed/cancelled work is never cached. Answer streams require an explicit completed terminal event; unexpected EOF, failed/incomplete/error events and empty answers cannot be persisted as successful completions. Index synchronization prunes hidden products and products with inactive brand/category references before embedding work and after the sweep; retrieval still checks live visibility.

## API and Socket.IO

All paths start with `/api/v1/ai`. Mutating browser requests require an allowed Origin. Reuse existing Customer Authorization headers; anonymous requests use the guest cookie.

| Method/path                            | Purpose                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| POST /session                          | Initialize/renew chat browser identity; body {}; serialized before private requests                                      |
| GET /conversations?page=1              | Owner-scoped list, ten per page                                                                                          |
| POST /conversations                    | Create; body {}                                                                                                          |
| GET /conversations/:id/messages?page=1 | Most recent twenty turns on page 1, displayed chronologically                                                            |
| POST /conversations/:id/end            | Idempotent completion; body {}                                                                                           |
| POST /conversations/:id/cancel         | Owner-scoped durable cancellation; body { requestId, content }; returns the matching terminal status, answer and sources |
| POST /socket-ticket                    | Single-use, 30-second socket ticket; body {}                                                                             |
| GET /search?q=...                      | Hybrid search; page/limit/category/brand/minPrice/maxPrice                                                               |
| GET /admin/status                      | ai:manage permission, no secrets or transcript contents                                                                  |
| POST /admin/reindex                    | ai:manage permission, queues index sweep                                                                                 |

Use `socket.io-client` with the API origin, `path: '/api/v1/ai/socket'`, `transports: ['websocket']` and `auth: { ticket, accessToken }`. The random ticket is consumed once in Socket.IO middleware and expires after 30 seconds. Ticket and access token are sent in the auth handshake, never query strings or browser storage. Customer identity is validated during handshake and again on every send/cancel. Wait for `chat:ready` before sending. Guest connects without an accessToken. Direct native WebSocket clients no longer speak the application protocol.

Emit the Socket.IO event `chat:send` with `{ conversationId, requestId, content }` (UUID requestId and 1–2000 characters), or `chat:cancel` with `{ requestId }`. Listen to named events chat:accepted, chat:status, chat:delta, chat:completed, chat:error; each carries the existing `{ type, requestId?, data? }` envelope. Stream errors are safe event payloads, not HTTP stack traces. Payload size, event frequency, backpressure, shared request limits, generation timeout and socket lifetime are bounded.

Each question uses a short-lived Socket.IO connection with autoConnect false, forceNew true and reconnection false. On disconnect, generation is cancelled and the UI refreshes persisted history. Reconnect requires a new ticket; the UI does not blindly resubmit and incur another charge. Exact request replay returns saved state; an in-progress replay is not a second generation. Explicitly sending a new question starts a new request. Cancelled/failed answers can retain partial text. No token-by-token stream replay is promised. Long-polling fallback and automatic connection-state recovery are not enabled.

Cancellation and completion compete through conditional updates from `processing` on the same message. A committed terminal status is immutable. Cancellation is serialized with send on the owned conversation; if it arrives first, a cancelled receipt prevents the delayed request from generating an answer. The cancellation response can legitimately report `completed` when completion won first. The browser shows cancellation pending until a matching validated response arrives; a failed request/disconnect is uncertain and requires history reconciliation. Other API instances observe cancellation through the durable message/conversation state, with a one-second cooperative abort monitor. In-flight provider usage cannot be undone.

Replay events follow persisted status: `processing` emits `chat:processing`, `completed` emits `chat:completed`, and `cancelled`/`failed` emit `chat:error` with that status. No replay starts another provider call. The frontend refreshes history after `chat:processing` without treating it as completion or automatically resubmitting. Socket `chat:cancel` remains supported for its running request and emits `chat:cancel-result` after durable cancellation; the browser uses the HTTP cancellation endpoint so confirmation can survive the streaming socket closing.

Direct dependencies are socket.io on the backend and socket.io-client in the frontend and backend integration tests. The application no longer imports ws or @types/ws. Socket.IO/Engine.IO may retain ws as an internal transitive dependency; do not remove it from the lockfile manually. Deploy the Socket.IO client and server together; the previous raw WebSocket protocol is incompatible.

## Administration and risk

Super Admin can clear configuration audit with DELETE /api/v1/ai/admin/settings/audit and { revision, confirm: true }. A conditional single-document update clears only audit and increments revision; stale confirmations return 409, preserving newer entries. No credentials, operating flags, conversations or embedding records are removed. The UI requires inline confirmation and resets audit pagination after success. This operation is tested only on the isolated integration database, not executed against the application's stored history during development.

Super Admin has an inline-confirmed Activate/Reconnect action at POST /api/v1/ai/admin/settings/activate with { revision, confirm: true }. It performs real structured-intent and streamed-answer probes using environment routing/cooldowns, then conditionally enables only the assistant flag and records settings.activated. It supports first initialization without importing credentials. Failed, aborted or stale probes do not enable a previously disabled assistant. The action never clears provider quota waits, overrides AI_FORCE_DISABLED, replaces credentials, resets conversations or activates an embedding generation. It is bounded by the HTTP deadline and two attempts per minute; probes consume provider quota. Automated tests mock providers and do not invoke this action against the application's database.

`/auth/ai` is Admin/Super Admin only. It shows nonsecret server configuration, retained conversation count, indexed chunks, indexing status, provider attempts and recent risk alerts. Keys/models use server environment variables; operating flags, audit and embedding lifecycle remain editable with existing authorization. Credentials never pass through the page.

Risk rules observe repeated failed login and checkout velocity using hashed actors and short-lived counters. These are explainable risk signals, not trained fraud classification. IPs/shared networks can produce false positives; administrators review the signals. No order mutation, payment decision, automatic lockout or access-control change is delegated to AI. Existing security remains authoritative.

Counters and alert recording are separate. One alert is upserted per actor/event/time bucket, with an occurrence count; repeated rejected requests do not create duplicate generic and domain alerts. A partial unique index on dedupeKey preserves legacy alerts without a migration.

## Verification

- Backend: `pnpm.cmd typecheck`, `pnpm.cmd test`.
- Isolated MongoDB lifecycle/socket integration: set MONGOD_BINARY to installed mongod, then `pnpm.cmd test:ai:integration:local`. This starts a fresh loopback replica set and random ai_test database; it never uses application MONGODB_URI.
- Frontend: typecheck, lint, test, test:contracts, build using pnpm.cmd.
- Production acceptance remains separate: actual provider response quality/cost, vector index/search, allowed origins, TLS WebSocket reverse proxy timeouts, and browser layout/accessibility.
- Evaluate Vietnamese queries for budgets, exact brand/SKU, paraphrases, missing facts, comparison, hidden products and malicious instructions. Record relevance, verified-data accuracy, time to first answer and calls/cost per conversation before tuning models.
