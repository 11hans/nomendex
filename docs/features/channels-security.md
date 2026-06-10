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

## Polling retry policy

`TelegramMonitor.runLoop` retries failed `getUpdates` polls with exponential backoff (1s base, doubling, 60s cap; reset on success). HTTP 4xx responses other than 429 (bad token, competing `getUpdates` consumer) are non-retryable: the monitor logs an error, reports it via `onError`, and stops instead of hammering the API.

## Auto-reply rate limit

AI auto-replies are limited to one per chat per 30 seconds (`AUTO_REPLY_MIN_INTERVAL_MS` in `src/gateway/service.ts`). Rate-limited inbound messages are still persisted and emitted; only the agent query + outbound send is skipped. Manual sends and explicit AI replies from the UI are not limited.

## Git staging guard

`src/lib/git.ts` refuses to stage `.nomendex/secrets.json` regardless of `.gitignore` state: `addAll()` silently skips it and `stageFile()` throws. This protects API keys even if the file was tracked before the ignore rules were written.

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
