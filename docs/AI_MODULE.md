# AI module

## Set up automatic synchronization and semantic search

1. In AI administration, import the environment connection if necessary, then explicitly test a Gemini/OpenAI connection. Keep the assistant enabled. A tested chat connection does not guarantee embedding quota; actual build failures are shown separately.
2. Create an embedding version. Choose ordinary MongoDB cosine for a small store (maximum 5,000 chunks), or Atlas Vector Search if supported with search-index permissions. Ordinary MongoDB still needs the replica-set/transaction support used throughout this project.
3. Leave "Bật đồng bộ tự động sau khi tạo" selected to persist indexing enabled together with the new version. No `AI_VECTOR_INDEX` environment value is needed for ordinary MongoDB. The worker picks up work within a minute.
4. Wait for ready status, then explicitly activate the version. Activation enables semantic retrieval. Published knowledge and eligible products feed the existing chat/search flows; keyword/catalog fallback remains available.
5. The worker refreshes every 15 minutes using successor snapshots, reuses unchanged vectors, and switches only after verification. Changes during a build are reconciled on a later scan. Disabling indexing prevents new tasks; running tasks keep their captured configuration.

Indexing uses at most one quarter of the configured daily call limit (minimum total limit: four). Application quota pauses resume after midnight UTC; provider rate limits/timeouts retry after five minutes. Persisted chunks survive restarts. Authentication, billing and incompatible infrastructure failures require operator attention. The admin shows real progress and retry time.

At 20 saved versions, automatic ordinary-MongoDB refresh can retire the oldest inactive automatically generated ready snapshot after the five-minute deactivation guard. Manual versions remain. If all versions are protected, remove an unused version manually. Atlas search indexes are never dropped automatically; their lifecycle and service quotas still require infrastructure management.

Exact cosine search streams the complete active generation in bounded batches and retains only the top 40 matches. Capacity overflow fails explicitly; move to Atlas for a larger catalog. Existing versions retain their original backend and provider/model/dimension isolation. No live provider calls or production configuration mutations are performed by tests.

The AI module lives in the existing Express API and React storefront. It does not create another website. No production database or provider calls were used to implement it.

## Conversation lifecycle and retention

AI HTTP tasks distinguish server-observed client disconnects from upstream cancellation and deadlines. Disconnects abort pending work with an internal marker and do not log an unhandled 500 or attempt a response on a closed connection. The 70-second HTTP deadline aborts upstream work with the same HTTP 504 reason returned to the error middleware. Unexpected AbortErrors remain observable; sent headers delegate live errors to Express, and closed/finished responses are never written again. Request, response and signal listeners plus deadline timers are removed when the task settles; late work rejections remain observed.

- Closing/minimizing the widget does not end the conversation. **Kết thúc** explicitly ends it. A new chat creates a different conversation.
- An active conversation automatically ends after **one hour without a submitted message**. Reading history, socket pings, minimizing and reconnecting do not extend activity. The server enforces the deadline, including when its worker was offline.
- Guest conversation and message expiry is **effective completion time +24 hours**. Automatic completion time is last activity +one hour, not the later time a cleanup worker happens to run. All guest turns share the conversation's expiry.
- Authenticated Customer messages expire independently **30 elapsed days from submission**, using a rolling cutoff; completion does not extend that deadline. Conversation metadata expires 30 days after its last submitted message.
- Database transactions serialize sending, completion, leases and guest expiry updates. Identical requestId/content is replayed; changing content conflicts. Only one turn per conversation can generate at once. A lease abandoned by a crashed worker becomes failed rather than generating a second paid response automatically.
- All history reads exclude expired records immediately. MongoDB TTL and a minute-based worker remove records physically in the background; deletion is eventual, not guaranteed at the exact millisecond. Retention does not cover independently managed infrastructure backups.
- Guest identity is a signed HttpOnly cookie, with only a digest stored as owner ID. Customer access uses the existing active/account-enabled/tokenVersion checks. Guest chats are never silently merged into a Customer account.
- Clients explicitly initialize private chat access with POST /session. The frontend serializes initialization (Web Locks across tabs where supported; shared promise within a tab), before creating/listing chats or requesting tickets. Only /session can issue/renew the cookie; renewal preserves its value. Private requests without a valid guest cookie return 428, with no Set-Cookie. Public AI search requests do not identify guests or change cookies. This prevents background request responses from overwriting the chat owner. Browser-cookie expiry is renewed separately from chat retention.

## Configuration

### Dynamic administration (2026-11-12)

`/auth/ai` now supports persisted Gemini connection CRUD, model selection, write-only credential replacement, explicit JSON/stream connection tests, activation, feature toggles and an audit history. Admins with `AiManage` can import the existing environment connection without sending its key to the browser. The dashboard reads actual backend counters and refreshes every 15 seconds while visible. Connection tests consume up to two provider attempts and require a separate confirmation; no paid calls run automatically on save or activation.

Configuration is stored atomically in the explicitly named `ai_settings` collection. Credentials use AES-256-GCM with randomized nonces and connection-ID authenticated data. API DTOs whitelist metadata and the final four key characters; encrypted values are excluded from ordinary model queries. Frontend credential writes bypass mutation caches. Never log request bodies or provider payloads.

Set `AI_CONFIG_ENCRYPTION_KEY` to a persistent 32-byte hexadecimal key (64 characters) in backend deployment secrets before enabling web writes. A local development key was provisioned in the ignored `.env`; restarting the backend loads it. Preserve the same key across instances, deployments and backups. Losing/changing it prevents decrypting stored credentials. Do not commit or expose it. `AI_FORCE_DISABLED=true` is an environment-only emergency stop overriding database enablement. These secrets and vector infrastructure remain server configuration; the web does not modify `.env` files.

Before the first managed configuration exists, existing environment settings remain the bootstrap fallback. After initialization, database settings take precedence even when all connections are deactivated/deleted; the server never silently resumes an environment API key. Enabling a new/re-enabled connection requires a successful test. Editing/deleting a selected connection requires first selecting another connection or saving disabled AI with no selected connection. Changing a model/key invalidates its test result. Writes carry a revision and conflict with HTTP 409 when stale; an audit records only actor ID, action, connection ID and time (last 100 entries).

Every chat, HTTP AI task and index run resolves a fresh database configuration into AsyncLocalStorage. In-flight operations retain their model, credential and limits; new operations on every instance read the newly committed configuration. No process-global credential cache or Redis is needed. Database failure does not silently replace an established database configuration with environment credentials. Risk observation also resolves dynamic flags. Indexing and semantic retrieval have separate switches; enabling either requires a server-provisioned vector index. The worker reads settings each tick, and manual synchronization enforces enablement on the backend.

Phase 2 adds Google Gemini, OpenAI GPT and xAI Grok as working provider choices. Phase 3 adds versioned embeddings and index cutover. Changing chat models does not change the embedding space. The original Gemini-only bootstrap remains compatible with existing deployments.

### Multi-provider chat — phase 2

The provider registry dispatches to separate Gemini/OpenAI/xAI adapters over a shared JSON/stream protocol implementation. Hosts are fixed to Google, `api.openai.com` and `api.x.ai`; arbitrary API URLs are not accepted. Provider/model prefixes and non-chat modalities are validated. Each saved connection must successfully exercise structured extraction and streamed output before activation. A model's appearance in suggestions is not a guarantee of account access, quota or pricing; custom compatible model IDs still require the same test. No provider/model fallback or SDK retry is enabled.

OpenAI requests use `max_completion_tokens` and `store:false`, with reasoning effort only for the supported reasoning-model family. Gemini uses its compatibility parameters; xAI omits incompatible reasoning options. All adapters validate refusal, truncation and terminal status before marking a turn completed. Replacing a provider requires entering a new credential, and the browser clears its credential draft when the provider changes. Credentials cannot be edited/deleted while referenced by a saved embedding version. Renaming an inactive connection remains possible.

### Versioned embeddings — phase 3

Admin creates a candidate using a tested Gemini/OpenAI connection, a supported embedding model and 768/1536/3072 dimensions (OpenAI small is capped at 1536). xAI chat can use an independent Gemini/OpenAI embedding connection. Existing Gemini embedding credentials are pinned separately from the selected chat connection, including when upgrading older database configurations.

Each candidate has an immutable model/provider/dimension tuple and a generated search-index name in `ai_embedding_generations`. Chunks live in the separate `ai_embedding_chunks` collection, uniquely keyed by generation/source/part. Legacy `ai_knowledge_chunks` and its index are not migrated, overwritten or deleted. Vector queries filter the generation; embedding caches bind provider/model/dimensions, preventing mixed spaces even when vector lengths match.

The index worker handles queued candidates when AI and periodic indexing are enabled. It creates an additive Vector Search index on `ai_embedding_chunks`, checks its exact dimensions/cosine definition and generation/_id/hash filter fields, and waits for it to become queryable before spending embedding quota. This requires a MongoDB deployment supporting Vector Search/search-index management and a database account allowed to create/list those indexes. Ordinary standalone MongoDB transaction support is not enough. Unsupported infrastructure produces a visible safe index error; it never silently marks a version ready.

Builds reuse the shared current-public-catalog and published-document source iterator. Chunk hashes bind provider/model/dimensions/text; retry reuses completed vectors, and a successor can copy unchanged vectors from ready versions in the same space without another provider call. A fenced database lease and heartbeat protect every chunk/progress write. Cancel/replacement/crash recovery cannot let a stale worker publish data. Stale candidate source chunks are removed only inside that candidate, never from the active/legacy dataset. Index verification queries every chunk by generation, object ID and current content hash; persisted-but-not-indexed data remains in `verifying`, and verification retries do not generate embeddings again. Physical index identity is retained and checked before cutover.

Only a `ready` version can be activated. The pointer, audit and configuration revision change in a transaction; previous data remains available for rollback. In-flight chats retain the prior provider/key/dimensions/index snapshot. A returned older version is selected using the same ready/index validation. Index revalidation of an inactive ready version does not rebuild its data; syncing new content creates a new generation instead. An environment-only return deactivates the version and disables semantic/indexing flags, allowing keyword search without silently switching embedding keys.

Periodic refresh creates a successor approximately every 15 minutes and promotes it only after verification, provided the operator has not changed the embedding-selection epoch (including switching away and back). Manual sync queues/resumes a successor. At most 20 versions are retained; admin can cancel, retry or delete inactive versions. Recently deactivated versions are protected for five minutes, beyond bounded in-flight HTTP/socket turns. Deleting a version removes its metadata/chunks but deliberately retains its search index; infrastructure owners can remove unused generated indexes separately after checking use. Account-specific MongoDB index quotas can therefore require index cleanup. Failed/quota-limited candidates never replace the active pointer.

Routes under `/ai/admin/embeddings` expose actual state, chunk count, verified count, index definition, safe failure code and audit history. Create/test/sync operations may consume provider quota and infrastructure resources; UI confirmations and descriptions identify these operations. No live provider or Atlas requests were made during implementation tests: provider transports and index readiness/visibility were mocked, while MongoDB persistence, fencing, rollback and cancellation used the isolated integration replica set.

See `.env.example`. AI is disabled by default. Do not put keys in frontend variables or commit real `.env` files.

| Variable                    | Purpose                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| AI_ENABLED                  | Enables Gemini requests; requires GEMINI_API_KEY and an explicit daily call limit                                                   |
| GEMINI_API_KEY              | Backend-only Google AI Studio credential; OpenAI credentials are not used                                                           |
| AI_CHAT_MODEL               | Default gemini-3.1-flash-lite, with a Free Tier listed by Google                                                                    |
| AI_CHAT_MAX_OUTPUT_TOKENS   | Answer budget, default 2048; validated integer 256–16384                                                                            |
| AI_INTENT_MAX_OUTPUT_TOKENS | Structured intent budget, default 1536; validated integer 256–16384                                                                 |
| AI_REASONING_EFFORT         | low (default), medium or high mapped to Gemini thinking; reasoning uses the output budget                                           |
| AI_EMBEDDING_MODEL          | Default gemini-embedding-001; requests and validates 1536 dimensions and normalizes the vector                                      |
| AI_DAILY_CALL_LIMIT         | Shared database counter limiting all provider attempts per UTC day, including indexing, intent extraction, embeddings and responses |
| AI_VECTOR_INDEX             | Existing MongoDB vector-search index name                                                                                           |
| AI_INDEX_ENABLED            | Explicitly enables periodic knowledge indexing and its provider spend                                                               |
| AI_RISK_ENABLED             | Enables observational login/checkout risk signals; no automatic blocking of orders/accounts                                         |

The daily call cap is not a monetary budget: input/output length is bounded, but total currency cost depends on configured provider prices. Failed provider attempts still count. Indexing is additionally capped at floor(25% of the total daily cap), leaving at least 75% for interactive traffic. No automatic fallback to another paid model. An API credential and approved deployment configuration are required for live acceptance.

### Gemini Free Tier setup and migration

1. Create a server-side key at [Google AI Studio](https://aistudio.google.com/apikey), using a project on the Free Tier. Set `GEMINI_API_KEY` in local `.env` or the deployment's backend environment; never share the key in chat or frontend variables.
2. Set `AI_CHAT_MODEL=gemini-3.1-flash-lite`, `AI_EMBEDDING_MODEL=gemini-embedding-001`, `AI_DAILY_CALL_LIMIT=100` and `AI_ENABLED=true`, then restart the backend. Keep vector/index settings as previously configured. Chat works with keyword/catalog retrieval without a vector index.
3. If an existing vector index contains OpenAI embeddings, run the existing knowledge sync after configuring Gemini. Model filters exclude old embeddings while reindexing; keyword/catalog retrieval stays available. The 1536-dimension index definition remains valid. Do not mix embedding spaces even when dimensions match.

The provider sends requests only to `generativelanguage.googleapis.com`. Chat/intent use Google's documented OpenAI-compatible endpoint through the existing SDK; embeddings use native `embedContent` with an explicit output dimensionality. No ChatGPT/OpenAI API key or endpoint is used. Streaming, cancellation, quota accounting, persistence/replay, owner checks, retrieval and risk rules retain the existing application contracts. Free-tier exhaustion returns safe inline feedback; it never triggers an automatic retry or another provider/model.

There is no API request flag that forces a billing-enabled project onto the Free Tier. Keep the Google project on the Free Tier to avoid paid usage; the application does not enable billing. Availability and quota depend on Google/account/model. Google's free-tier data handling differs from paid service, so review [pricing and data usage](https://ai.google.dev/gemini-api/docs/pricing) and [API terms](https://ai.google.dev/gemini-api/terms) before sending production data.

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

`/auth/ai` is Admin/Super Admin only. It shows nonsecret server configuration, retained conversation count, indexed chunks, indexing status, provider attempts and recent risk alerts. Configuration changes use server environment variables in this version; credentials never pass through the page.

Risk rules observe repeated failed login and checkout velocity using hashed actors and short-lived counters. These are explainable risk signals, not trained fraud classification. IPs/shared networks can produce false positives; administrators review the signals. No order mutation, payment decision, automatic lockout or access-control change is delegated to AI. Existing security remains authoritative.

Counters and alert recording are separate. One alert is upserted per actor/event/time bucket, with an occurrence count; repeated rejected requests do not create duplicate generic and domain alerts. A partial unique index on dedupeKey preserves legacy alerts without a migration.

## Verification

- Backend: `pnpm.cmd typecheck`, `pnpm.cmd test`.
- Isolated MongoDB lifecycle/socket integration: set MONGOD_BINARY to installed mongod, then `pnpm.cmd test:ai:integration:local`. This starts a fresh loopback replica set and random ai_test database; it never uses application MONGODB_URI.
- Frontend: typecheck, lint, test, test:contracts, build using pnpm.cmd.
- Production acceptance remains separate: actual provider response quality/cost, vector index/search, allowed origins, TLS WebSocket reverse proxy timeouts, and browser layout/accessibility.
- Evaluate Vietnamese queries for budgets, exact brand/SKU, paraphrases, missing facts, comparison, hidden products and malicious instructions. Record relevance, verified-data accuracy, time to first answer and calls/cost per conversation before tuning models.
