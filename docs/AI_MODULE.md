# AI module

The AI module lives in the existing Express API and React storefront. It does not create another website. No production database or provider calls were used to implement it.

## Conversation lifecycle and retention

- Closing/minimizing the widget does not end the conversation. **Kết thúc** explicitly ends it. A new chat creates a different conversation.
- An active conversation automatically ends after **one hour without a submitted message**. Reading history, socket pings, minimizing and reconnecting do not extend activity. The server enforces the deadline, including when its worker was offline.
- Guest conversation and message expiry is **effective completion time +24 hours**. Automatic completion time is last activity +one hour, not the later time a cleanup worker happens to run. All guest turns share the conversation's expiry.
- Authenticated Customer messages expire independently **30 elapsed days from submission**, using a rolling cutoff; completion does not extend that deadline. Conversation metadata expires 30 days after its last submitted message.
- Database transactions serialize sending, completion, leases and guest expiry updates. Identical requestId/content is replayed; changing content conflicts. Only one turn per conversation can generate at once. A lease abandoned by a crashed worker becomes failed rather than generating a second paid response automatically.
- All history reads exclude expired records immediately. MongoDB TTL and a minute-based worker remove records physically in the background; deletion is eventual, not guaranteed at the exact millisecond. Retention does not cover independently managed infrastructure backups.
- Guest identity is a signed HttpOnly cookie, with only a digest stored as owner ID. Customer access uses the existing active/account-enabled/tokenVersion checks. Guest chats are never silently merged into a Customer account.
- Clients explicitly initialize private chat access with POST /session. The frontend serializes initialization (Web Locks across tabs where supported; shared promise within a tab), before creating/listing chats or requesting tickets. Only /session can issue/renew the cookie; renewal preserves its value. Private requests without a valid guest cookie return 428, with no Set-Cookie. Public search/recommendation requests do not identify guests or change cookies. This prevents background request responses from overwriting the chat owner. Browser-cookie expiry is renewed separately from chat retention.

## Configuration

See `.env.example`. AI is disabled by default. Do not put keys in frontend variables or commit real `.env` files.

| Variable | Purpose |
| --- | --- |
| AI_ENABLED | Enables paid AI requests; requires API key and an explicit daily call limit |
| OPENAI_API_KEY | Backend-only provider credential |
| AI_CHAT_MODEL | Default gpt-5.4-mini, configurable provider model |
| AI_EMBEDDING_MODEL | Default text-embedding-3-small; embedding requests use 1536 dimensions |
| AI_DAILY_CALL_LIMIT | Shared database counter limiting all provider attempts per UTC day, including indexing, intent extraction, embeddings and responses |
| AI_VECTOR_INDEX | Existing MongoDB vector-search index name |
| AI_INDEX_ENABLED | Explicitly enables periodic knowledge indexing and its provider spend |
| AI_RISK_ENABLED | Enables observational login/checkout risk signals; no automatic blocking of orders/accounts |

The daily call cap is not a monetary budget: input/output length is bounded, but total currency cost depends on configured provider prices. Failed provider attempts still count. Indexing is additionally capped at floor(25% of the total daily cap), leaving at least 75% for interactive traffic. No automatic fallback to another paid model. An API credential and approved deployment configuration are required for live acceptance.

## Search infrastructure and indexing

MongoDB must support `$vectorSearch`; ordinary MongoDB transaction support alone is insufficient. Create a vector-search index on **ai_knowledge_chunks** through the deployment's supported administration tools, for example:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
    { "type": "filter", "path": "embeddingModel" }
  ]
}
```

Index provisioning and initial production indexing are explicit deployment steps, not an automatic migration. Verify deployment capability, index readiness and the intended database before enabling AI_INDEX_ENABLED. Changing the embedding model requires reindexing; old-model vectors are excluded.

Indexing reads only current public catalog DTOs and published managed documents. It chunks text with overlap, hashes source/model content, skips unchanged embeddings and retries on failure. A database lease coordinates workers; successful sweeps are scheduled every 15 minutes. Admin can queue another sweep. Hidden/deleted sources are always revalidated against live visibility before use. Index propagation can lag; current prices/stock are read from existing storefront services.

Lease heartbeat failures abort provider work. Each chunk write/delete is fenced by a transaction that writes the current unexpired lease row before mutating chunks, so a worker replaced during an embedding call cannot commit stale results. A reindex request arriving during an active sweep is kept for another sweep.

Search combines keyword and semantic candidates using reciprocal ranks. Price/brand/category UI filters take precedence over extracted intent. AI search paginates a **bounded ranked candidate pool** (up to 100 catalog keyword products, 40 SKU/description matches and 40 vector chunks); `total` describes that pool, not the whole catalog. Ordinary catalog pagination remains unchanged. Missing vector infrastructure/provider failure falls back to catalog keyword search. Do not describe the fallback as semantic search.

Chatbot sources are data, not instructions. Model output cannot run arbitrary queries or mutate business data. HTML is converted to text before indexing; frontend renders answers as text and only server-supplied local source/product links are clickable. This limits impact of prompt injection but is not a claim that LLM answers are infallible.

Public product DTO mapping is shared with the existing storefront. AI cards load in batches without review/order aggregations. Successful intent and query-embedding intermediates have a bounded, process-local five-minute cache, allowing pagination to reuse provider work; prices, stock and visibility are never cached there. An explicitly requested unknown brand/category returns no matches rather than broadening to unrelated products. Recommendation text is bounded before applying the public query schema.

Cancellation flows through retrieval, intent extraction, embeddings and answer generation. Public HTTP tasks reject at the 70-second deadline even if underlying work ignores cancellation; MongoDB retrieval operations also receive cancellation and execution limits. Frontend timeout is 75 seconds. Chat completion refreshes only owner-scoped conversation queries. History stores immutable product IDs and loads current public cards in a batch, preserving identity across slug changes/reuse. Hidden/deleted products are omitted. Legacy slug-only turns retain their transcript without inferred product cards.

Concurrent identical intent/embedding requests share one in-flight computation. Each subscriber can cancel independently; the underlying computation aborts when its last subscriber leaves. Failed/cancelled work is never cached. Answer streams require an explicit completed terminal event; unexpected EOF, failed/incomplete/error events and empty answers cannot be persisted as successful completions. Index synchronization prunes hidden products and products with inactive brand/category references before embedding work and after the sweep; retrieval still checks live visibility.

## API and Socket.IO

All paths start with `/api/v1/ai`. Mutating browser requests require an allowed Origin. Reuse existing Customer Authorization headers; anonymous requests use the guest cookie.

| Method/path | Purpose |
| --- | --- |
| POST /session | Initialize/renew chat browser identity; body {}; serialized before private requests |
| GET /conversations?page=1 | Owner-scoped list, ten per page |
| POST /conversations | Create; body {} |
| GET /conversations/:id/messages?page=1 | Most recent twenty turns on page 1, displayed chronologically |
| POST /conversations/:id/end | Idempotent completion; body {} |
| POST /conversations/:id/cancel | Owner-scoped durable cancellation; body { requestId, content }; returns the matching terminal status, answer and sources |
| POST /socket-ticket | Single-use, 30-second socket ticket; body {} |
| GET /search?q=... | Hybrid search; page/limit/category/brand/minPrice/maxPrice |
| GET /recommendations/:slug | Public similar/alternative products |
| GET /admin/status | ai:manage permission, no secrets or transcript contents |
| POST /admin/reindex | ai:manage permission, queues index sweep |

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
