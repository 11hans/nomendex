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
