# Channels & Gateway Security

Security hardening for the Telegram gateway and real-time WebSocket APIs.

## Server bind address

Server defaults to loopback (`127.0.0.1`) unless overridden by `SERVER_HOST` or `HOST` env vars. Resolved in `src/lib/request-security.ts:resolveServerHostname`.

## WebSocket origin validation

All WebSocket upgrade requests (`/ws` and `/terminal/:id`) are checked via `isAllowedWebSocketOrigin()` in `src/lib/request-security.ts`:

- No `Origin` header → allowed (non-browser clients, native app)
- Same origin → allowed
- Loopback server + loopback origin → allowed (local dev, different ports)
- Everything else → rejected with `403 Forbidden`

## Inbound ingestion allowlist

Inbound Telegram messages from senders not on the allowlist are dropped at ingestion in `GatewayService.handleTelegramInbound` — nothing is persisted to `channels-messages.jsonl`, no thread is created, and no realtime event is emitted. With an empty allowlist all inbound messages are dropped (deny by default).

chatId is the primary identity. Telegram usernames are mutable and can be re-registered by a different account, so a username-only allowlist match (`allowlistMatchType() === "username"`) is additionally verified against existing threads: if the username was previously seen with a different chatId, the message is dropped as a possible username takeover.

## Host header validation (DNS rebinding)

When the server is bound to loopback, the `Host` header must resolve to a loopback name (`isAllowedRequestHost()` in `src/lib/request-security.ts`). This defeats DNS rebinding, where both the request URL and the `Origin` header carry an attacker hostname that points at `127.0.0.1` and would pass the same-origin check. Enforced on WebSocket upgrades and mutating channel routes. Explicit non-loopback binds (`SERVER_HOST`) opt out — and are logged with a prominent security warning at startup.

## CSRF guard on mutating channel routes

`POST /api/channels/telegram/send`, `POST /api/channels/telegram/ai-reply`, and `PUT /api/channels/settings` are guarded by `evaluateMutatingRequestPolicy()`:

1. **Host not loopback** (loopback-bound server) → `403 FORBIDDEN_HOST`
2. **Foreign `Origin` header** → `403 FORBIDDEN_ORIGIN`
3. **Content-Type is not `application/json`** → `415 UNSUPPORTED_CONTENT_TYPE`

This closes off cross-site "simple requests" (`text/plain` POSTs need no CORS preflight) while keeping non-browser clients without an `Origin` header working.

## Operator trust model (headless agent)

The Telegram channel is the **operator's personal remote chat**: the allowlist binds the bot to the operator's own account(s), and that binding *is* the trust boundary. Inbound messages from allowlisted senders carry operator authority — the agent acts on them like app-chat messages, with the agent's full persisted tool grants (the same "Always Allow" set it has in the app; tools outside that set are denied, since headless runs cannot prompt). `AskUserQuestion` is always denied.

Consequences:

- **Everyone on the allowlist has operator-level access** to the agent's granted tools (potentially `Bash`). Keep the allowlist to accounts you control.
- A compromised or stolen Telegram account on the allowlist means agent access; the username→chatId binding (above) covers username re-registration, not account takeover.
- Replies transit Telegram's servers — the reply framing instructs the agent never to include secrets (API keys, tokens, credentials) in a message.

The policy check in `aiReplyTelegram` still runs **before** the agent query, so a disabled channel or de-allowlisted sender cannot trigger an agent run at all. Inbound text is wrapped in `<telegram-message>` framing that also pins the output contract (sent verbatim, no meta commentary).

## Polling retry policy

`TelegramMonitor.runLoop` retries failed `getUpdates` polls with exponential backoff (1s base, doubling, 60s cap; reset on success). HTTP 4xx responses other than 429 (bad token, competing `getUpdates` consumer) are non-retryable: the monitor logs an error, reports it via `onError`, and stops instead of hammering the API.

## Auto-reply rate limit

AI auto-replies are limited to one per chat per 5 seconds (`AUTO_REPLY_MIN_INTERVAL_MS` in `src/gateway/service.ts`) — short enough for chat-like use, nonzero as a flood guard. Rate-limited inbound messages are still persisted and emitted; only the agent query + outbound send is skipped. Manual sends and explicit AI replies from the UI are not limited.

## Git staging guard

`src/lib/git.ts` refuses to stage `.nomendex/secrets.json` regardless of `.gitignore` state: `addAll()` silently skips it, and `stageFile()` and `resolveConflict()` throw (conflict resolution stages the file at the end, and the `mark-resolved` variant needs no actual conflict, so the guard applies there too). This protects API keys even if the file was tracked before the ignore rules were written.

## Telegram send policy

All outbound Telegram messages (manual and AI auto-reply) go through `evaluateTelegramSendPolicy()` in `src/gateway/security.ts`:

1. **Channel disabled** → `403 TELEGRAM_DISABLED`
2. **Recipient not on allowlist** → `403 TELEGRAM_NOT_ALLOWLISTED`
3. **Thread/chatId mismatch** → `409 TELEGRAM_THREAD_CHAT_MISMATCH`
4. **Missing chatId** → `400 TELEGRAM_CHAT_REQUIRED`

Allowlist matching is case-insensitive and supports both numeric chat IDs and `@username` format.

## Structured error handling

`GatewayHttpError` (`src/gateway/errors.ts`) carries `status`, `code`, and `message`. Route handlers in `channels-routes.ts` catch these and return typed JSON errors:

```json
{ "error": "Telegram channel is disabled", "code": "TELEGRAM_DISABLED" }
```

## Realtime event redaction

WebSocket events are redacted before broadcast via `redactGatewayEvent()` in `src/gateway/security.ts`. Stripped fields:

| Event | Kept | Stripped |
|-------|------|----------|
| `channel.message.received/sent` | `threadId`, `channel`, `role`, `direction`, `createdAt` | `text`, `externalChatId`, `username`, full `message` object |
| `channel.thread.updated` | `threadId`, `channel`, `updatedAt` | All other thread fields |

## Subscribe handshake

Realtime `/ws` requires explicit subscribe before event delivery:

```
→ { "type": "subscribe", "topic": "channels" }
← { "type": "subscribed", "topic": "channels" }
```

Unsubscribing is also supported. Clients that never subscribe receive no events.

## Input limits

API inputs are bounded by Zod schemas in `src/gateway/types.ts`: message text and AI-reply prompt at 4096 chars (Telegram's own message limit), allowlist at 100 entries of 64 chars, plus caps on the remaining settings strings.

## Polling loop robustness

`TelegramMonitor.runLoop` validates raw `getUpdates` payloads (`toTelegramInboundMessage`) before processing — malformed fields are skipped instead of crashing downstream. Handler exceptions are logged per-update and do not enter the connection-failure path (no backoff or fatal stop). The update offset is persisted *after* the handler runs, so a crash mid-handling redelivers the update on restart (at-least-once). When the loop stops on its own (fatal 4xx), the `onStop` callback flips `status.running` to `false`, and `lastError` strings are scrubbed of the bot token before reaching status responses or WS events.

## Storage bounds

Thread upserts (read-modify-write on `channels-threads.json`) are serialized through a write queue. `channels-messages.jsonl` is compacted on gateway init: above 5 MB only the last 5000 lines are kept.

## Input normalization

Inbound Telegram messages are normalized in `src/gateway/telegram-normalization.ts`:

- Username: strip leading `@`, trim whitespace
- Text: strip null bytes, normalize `\r\n` → `\n`, trim, cap at 4000 chars

## Debug status sanitization

`/api/channels/status` returns only operational health data. Removed from debug output: token prefix, token length, OAuth shape heuristics, whitespace diagnostics. Added: `pollingTimeoutSec`, `lastUpdateId`.

## Test coverage

- `src/gateway/security.test.ts` — allowlist matching, send policy evaluation, event payload redaction
- `src/lib/request-security.test.ts` — loopback detection, server hostname resolution, WebSocket origin validation
- `src/gateway/telegram-monitor.test.ts` — username and inbound text normalization
