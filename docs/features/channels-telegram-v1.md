# Channels + Telegram V1

This document describes the implemented V1 for unified App/Telegram chat inside Nomendex.

> Note: the original branch also included a "daily chat" feature (date-bucketed threads). It was superseded by the Today tab and was not ported.

## Scope implemented

- Single unified chat plugin with channel support (`app`, `telegram`)
- Telegram Bot API integration via long-polling
- Daily session keys for Telegram DM threads (timezone-aware via `session-registry`)
- Channel routes (`/api/channels/*`) and realtime WebSocket events (`channel.*`) via `/ws`
- Settings page Channels tab for Telegram/channel configuration
- AI auto-reply via `runAgentTextQuery` (`src/lib/agent-runtime.ts`), sandboxed to pre-approved tools

## Architecture

### Gateway (`src/gateway/`)

| File | Purpose |
|------|---------|
| `types.ts` | Shared types: `ChannelsSettings`, `TelegramInboundMessage`, `UnifiedThread`, etc. |
| `service.ts` | Orchestrates channels — init, reinitialize on workspace switch |
| `channel-manager.ts` | Telegram connection state and message routing |
| `telegram-monitor.ts` | Long-polling Telegram Bot API for updates |
| `app-sessions.ts` | Reads app chat sessions from Claude SDK storage |
| `ai.ts` | AI response generation for auto-reply |
| `storage.ts` | Telegram messages, settings, and state persistence |
| `session-registry.ts` | Session key generation with timezone awareness |
| `utils.ts` | JSONL file reading utility |

### Features

- `src/features/channels/` — `ChannelId` types and `useChannelEvents` WebSocket hook
- `src/features/chat/` — Extended with `TelegramChatView` and unified thread browser

### Shared libs

- `src/lib/agent-runtime.ts` — Headless single-text agent query (`runAgentTextQuery`) used by the gateway auto-reply; mirrors the chat route's agent resolution, MCP config, and tool-permission conventions
- `src/lib/request-security.ts` — WebSocket origin validation + loopback-default server hostname
- `src/hooks/useAutoStickToBottom.ts` — Auto-scroll-to-bottom for chat views

## Storage

All channel state is stored in the workspace `.nomendex/` directory:

- `channels-settings.json`
- `channels-threads.json`
- `channels-messages.jsonl`
- `channels-telegram-state.json`

The bot token lives in `.nomendex/secrets.json` under `TELEGRAM_BOT_TOKEN`.

## Local run

1. Add Telegram token in **Settings → API Keys** under key `TELEGRAM_BOT_TOKEN` (or custom key used in Channels settings).
2. Open **Settings → Channels** and configure:
   - enable Telegram
   - allowlist (comma-separated Telegram user IDs or @usernames)
   - timezone (default `Europe/Prague`)
   - optional auto-reply + Telegram agent ID
3. Start app:

```bash
cd bun-sidecar
bun run dev
```

## Railway deployment blueprint

Use local workspace persistence in production (volume) to preserve channel state and dedup checkpoint.

Recommended Railway setup:

- Start command: `bun run dev` (or production command if available)
- Healthcheck path: `/health`
- Required secret: `TELEGRAM_BOT_TOKEN` (or matching key from channel settings)
- Persistent volume mounted for app/workspace data

Suggested runtime notes:

- Only one active instance should run Telegram long-polling for a tenant.
- Keep workspace volume persistent so `channels-telegram-state.json` survives restarts.
- If scaling to multiple replicas, introduce leader election or move polling to a single worker.

## Security hardening (P0)

- Telegram send is denied when Telegram channel is disabled.
- When `autoReplyEnabled=true`, manual Telegram send also enforces allowlist policy.
- Realtime `/ws` requires explicit subscribe handshake (`{ "type": "subscribe", "topic": "channels" }`) before event delivery.
- Realtime event payloads are metadata-only (no message text, no `externalChatId`, no external usernames).
- `/api/channels/status` returns only operational health data (no token fingerprint fields).
- Server defaults to loopback bind (`127.0.0.1`) unless overridden by environment (`SERVER_HOST` or `HOST`).
