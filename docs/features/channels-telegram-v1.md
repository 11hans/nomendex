# Channels & Telegram Gateway (V1)

Adds a Telegram bot gateway to Nomendex: a long-polling monitor receives DMs sent to the user's own bot, captures each one as an Inbox todo (text and photos), and keeps the conversation as threads alongside the existing app chat sessions in a unified thread browser. The bot only confirms (`uloženo`); manual replies can be sent from the UI.

Since October 2026 the channel is capture-only: no agent runs on inbound messages and the bot cannot run tools on the Mac. The former AI auto-reply, the "AI Reply" button and `gateway/ai.ts` were removed — an allowlisted Telegram account with the agent's tool grants was effectively a remote shell.

Ported to `dev` from a dormant `telegram` branch in June 2026. Daily session bucketing by `session-registry` is still present in the gateway storage layer, but the feature otherwise does not group threads by calendar date at the UI level.

## Overview

Two channels are unified under the same thread browser:

| Channel | Source | Thread ID scheme |
|---------|--------|-----------------|
| `app` | App chat sessions (Claude SDK JSONL history) | `app:<sessionId>` |
| `telegram` | Gateway storage in `.nomendex/` | `telegram:dm:<chatId>:<YYYY-MM-DD>` |

App threads are read-only adapters over `~/.claude/projects/…` JSONL files; they cannot receive replies through the gateway. Only `telegram` threads support outbound sends.

## Architecture

### Gateway (`bun-sidecar/src/gateway/`)

| File | Purpose |
|------|---------|
| `types.ts` | Zod schemas + inferred types: `ChannelsSettings`, `PublicChannelsSettings`, `ChannelsSettingsPatch`, `UnifiedThread`, `UnifiedMessage`, `ChannelStatus`, `ChannelsDebugStatus`, `GatewayEvent`, `TelegramInboundMessage`. Input schemas with bounds: `TelegramSendSchema`, `ChannelsSettingsPatchSchema`. `TelegramInboundMessage.kind` is `text`, `photo` or `unsupported`. |
| `service.ts` | `GatewayService` singleton. Owns ingestion (`handleTelegramInbound` → Inbox capture + confirmation reply), unified thread listing, `sendTelegramMessage`, event emit with redaction, `initialize`/`reinitialize`. |
| `channel-manager.ts` | Token resolution from `secrets`, `TelegramMonitor` lifecycle, `ChannelStatus` tracking, `sendTelegram`, `downloadTelegramFile`. Scrubs bot token from error strings before they reach status responses, logs or WS events. |
| `telegram-monitor.ts` | Long-polling `getUpdates` loop, exponential backoff 1s→60s (60s cap), fatal 4xx stop, `toTelegramInboundMessage` payload validation (text, largest photo size + caption, everything else `unsupported`), at-least-once offset persistence, `sendTelegramText`, `downloadTelegramFile` (`getFile` + file endpoint, size-capped). |
| `telegram-normalization.ts` | Username: strip leading `@`, trim. Text: strip null bytes, normalize `\r\n`→`\n`, trim, cap at 4000 chars. `inboxTodoText`: Inbox todo title/description from message text. |
| `session-registry.ts` | `SessionRegistry` wraps `makeTelegramSessionKey` — produces the `telegram:dm:<chatId>:<YYYY-MM-DD>` thread ID using `Intl.DateTimeFormat` with the configured timezone (default `Europe/Prague`). |
| `app-sessions.ts` | Reads `chat-sessions.jsonl` and Claude SDK history files to expose app chat sessions as `UnifiedThread`/`UnifiedMessage` items. |
| `storage.ts` | Four files in `.nomendex/` (see Storage section). Thread upserts serialized through a write queue. Messages log compacted on init (5 MB / 5000-line thresholds). |
| `security.ts` | `allowlistMatchType`, `isAllowlisted`, `evaluateTelegramSendPolicy`, `redactGatewayEvent`. |
| `inbox-capture.ts` | `captureToInbox` — saves a photo to `uploads/` as an attachment, creates the Inbox todo via `createTodo`, broadcasts `upsert` on the todo event stream. Reply texts (`uloženo`, `neuloženo – …`). |
| `errors.ts` | `GatewayHttpError` — carries `status`, `code`, `message`. |
| `utils.ts` | `readJSONL<T>` — resilient JSONL reader; skips corrupted lines. |

### Server integration (`bun-sidecar/src/server.ts`)

- Gateway init runs after workspace services via `initializeGateway()` — safe to fail without crashing the app.
- `gatewayService.subscribe` fans out redacted `GatewayEvent`s to all `/ws` clients that have subscribed to the `channels` topic.
- On workspace switch: caller is expected to call `gatewayService.reinitialize()` (compacts messages file, reloads channel manager from new workspace's settings).

### Routes (`bun-sidecar/src/server-routes/channels-routes.ts`)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/channels/threads` | Query params: `channel=all\|app\|telegram`, `query=<search string>`. Returns `{ threads, status }`. |
| `GET` | `/api/channels/threads/*` | Thread ID in last path segment (URL-encoded). Returns `{ messages }`. |
| `POST` | `/api/channels/telegram/send` | Body: `TelegramSendSchema` (`threadId?`, `chatId?`, `text`). CSRF-guarded. |
| `GET` | `/api/channels/settings` | Returns `PublicChannelsSettings` (`hasToken` instead of the raw token). |
| `PUT` | `/api/channels/settings` | Body: `ChannelsSettingsPatchSchema`. CSRF-guarded. Reloads channel manager. |
| `GET` | `/api/channels/status` | Returns `ChannelsDebugStatus`: operational health only (token presence, polling state, thread count). |

CSRF guard (`rejectUntrustedMutation`) applies `evaluateMutatingRequestPolicy()` from `src/lib/request-security.ts` on all mutating routes. See `channels-security.md` for details.

### WebSocket realtime (`/ws`)

```
→ { "type": "subscribe", "topic": "channels" }
← { "type": "subscribed", "topic": "channels" }
```

After subscribing, the client receives redacted gateway events:

| Event ID | Payload fields delivered |
|----------|--------------------------|
| `channel.message.received` | `threadId`, `channel`, `role`, `direction`, `createdAt` |
| `channel.message.sent` | `threadId`, `channel`, `role`, `direction`, `createdAt` |
| `channel.thread.updated` | `threadId`, `channel`, `updatedAt` |
| `channel.status.changed` | `{ status: ChannelStatus }` |
| `channel.backlog.drained` | `{ count: number }` |

`channel.backlog.drained` is emitted when the first subscriber connects if messages arrived while no subscriber was present.

Message text, `externalChatId`, and `externalUsername` are stripped from WS events — they are fetched on demand via `GET /api/channels/threads/*`. See `channels-security.md` for the full redaction table.

### Shared libs

- `bun-sidecar/src/lib/agent-runtime.ts` — `runAgentTextQuery` headless agent runner, no longer called by the gateway (kept for future headless use). Resolves agent config, builds MCP servers, enforces the grant set with a `PreToolUse` hook (`buildHeadlessToolGate` — also covers tools the CLI auto-approves without `canUseTool`), always denies `AskUserQuestion`, applies `allowedToolsOverride` instead of persisted agent preferences when provided, and runs with `persistSession: false`. `buildMcpServersFromConfig` and `buildAgentContext` moved here from `chat-routes`; `chat-routes` now imports from here.
- `bun-sidecar/src/lib/request-security.ts` — origin/host validation and mutation policy. Details in `channels-security.md`.

### Frontend

- `bun-sidecar/src/features/channels/types.ts` — Frontend mirror of `UnifiedThread`, `UnifiedMessage`, `ChannelEvent`.
- `bun-sidecar/src/features/channels/useChannelEvents.ts` — React hook: opens a `WebSocket` to `/ws`, sends subscribe handshake and a ping on open, calls `onEvent` for each `{ type: "event" }` frame.
- `bun-sidecar/src/hooks/useAutoStickToBottom.ts` — Keeps the chat scroll container pinned to the bottom while the user hasn't scrolled up; suspends auto-stick when the user scrolls up and resumes when they return to within 96px of the bottom.
- `bun-sidecar/src/features/chat/browser-view.tsx` — `ChatBrowserView`: master-detail thread list with All / App / Telegram filter tabs, debounced text search (250ms), search-term highlighting in previews, keyboard navigation. Refreshes on `useChannelEvents` events. Opening a thread routes to `ChatView` with `{ channel, threadId/sessionId }`.
- `bun-sidecar/src/features/chat/chat-view.tsx` — `ChatView` dispatcher (bottom of file): infers channel from `props.channel` or `props.threadId?.startsWith("telegram:")`, routes to `TelegramChatView` or the standard `AppChatView`. `TelegramChatView` is a thread view with a ProseMirror input and a manual Send button. Subscribes to `useChannelEvents` for live updates.
- `bun-sidecar/src/pages/SettingsPage.tsx` — `ChannelsSettings` component inside the **Channels** settings tab: enable/disable toggle, bot token status (read-only — `hasToken` boolean only, token entry is in the API Keys tab under `TELEGRAM_BOT_TOKEN`), timezone, allowlist (one entry per line), and a debug status block showing polling state, thread count, and allowlist size.

## Storage

All channel state is stored in the active workspace's `.nomendex/` directory:

| File | Purpose |
|------|---------|
| `channels-settings.json` | `ChannelsSettings` (merged with defaults on read; defaults to `enabled: false`, empty allowlist). Only known keys are kept, so the retired `autoReplyEnabled` / `telegramAgentId` / `fallbackText` drop out on the next save. |
| `channels-threads.json` | `UnifiedThread[]` for telegram threads. Thread upserts are serialized through a promise queue to prevent concurrent read-modify-write races. |
| `channels-messages.jsonl` | Append-only log of `UnifiedMessage` records (both inbound and outbound). Compacted on gateway init: when the file exceeds 5 MB, only the last 5000 lines are kept. |
| `channels-telegram-state.json` | `{ lastUpdateId: number }` — persisted after each processed update for at-least-once delivery. |

App thread messages are NOT stored in `.nomendex/` — they are read directly from `~/.claude/projects/<workspace-path-dashed>/<sessionId>.jsonl` on demand (lookup via `lib/claude-session-files.ts`: every non-alphanumeric path character becomes `-`, with a fallback search across all project directories).

The bot token lives in `.nomendex/secrets.json` under `TELEGRAM_BOT_TOKEN` (or a custom key configured in settings). It never leaves the server process: the API exposes only `hasToken: boolean`.

## Message ingestion flow

1. `TelegramMonitor.runLoop` calls `getUpdates` with long-polling (default 25s timeout).
2. Each raw update is validated by `toTelegramInboundMessage` (private chat only, numeric fields checked, text normalized via `telegram-normalization.ts`). A text message maps to `kind: "text"`, a photo to `kind: "photo"` (largest size's `file_id`, caption as text), any other private message (voice, sticker, file, …) to `kind: "unsupported"`. Malformed updates and empty text are skipped; handler exceptions are logged per-update and do not trigger backoff.
3. `ChannelManager.onTelegramMessage` → `GatewayService.handleTelegramInbound`.
4. Allowlist check (`allowlistMatchType`). Non-allowlisted senders are dropped — nothing is persisted, no thread is created, no event is emitted.
5. Username-only allowlist matches are verified against known threads: if the username was previously seen with a different `chatId`, the message is dropped (possible username takeover).
6. Thread ID is derived: `SessionRegistry.telegramDmKey(chatId, messageTimestamp)` → `telegram:dm:<chatId>:<YYYY-MM-DD>` in the configured timezone.
7. `appendTelegramMessage` + `upsertTelegramThread` (serialized queue). A photo without caption is logged as `[fotka]`, an unsupported message as `[nepodporovaná zpráva]`.
8. `channel.message.received` and `channel.thread.updated` events are emitted (after redaction).
9. Inbox capture (below), then the result is sent back via `sendTelegramMessage` (send policy applies; the reply is recorded as an outbound message).

## Inbox capture flow

`GatewayService.captureInbound` → `inbox-capture.ts:captureToInbox`. Deterministic — no agent, no tools.

1. `unsupported` → nothing is saved, reply `neuloženo – pošli text nebo fotku`.
2. `photo` → `ChannelManager.downloadTelegramFile` (`getFile`, then the file endpoint; capped at 10 MB like `/api/uploads`). The file is written to `uploads/` as `upload-<ts>-<rand>.<ext>` and becomes an `Attachment` (`url: /api/uploads/<filename>`).
3. Title/description via `inboxTodoText`: title = first non-empty line, capped at 120 chars; the full text goes to `description` only when it is longer than the title (multi-line or capped). A photo without caption gets the title `Fotka z Telegramu`.
4. `createTodo({ title, description?, project: "Inbox", attachments? })`, then `broadcastTodoEvent({ type: "upsert" })` so open Inbox/Todos views refresh.
5. Reply `uloženo` only after the todo is written. Any failure (download, write, create) is logged and replied with `neuloženo – chyba, zkus to znovu`.

## Outbound send policy

`evaluateTelegramSendPolicy` in `security.ts` blocks sends when:

| Condition | HTTP status | Code |
|-----------|-------------|------|
| Channel disabled | 403 | `TELEGRAM_DISABLED` |
| Recipient not on allowlist | 403 | `TELEGRAM_NOT_ALLOWLISTED` |
| Thread/chatId mismatch | 409 | `TELEGRAM_THREAD_CHAT_MISMATCH` |
| Missing chatId | 400 | `TELEGRAM_CHAT_REQUIRED` |

Allowlist matching is case-insensitive; entries can be numeric chat IDs or `@username` format (leading `@` stripped on comparison).

## Key invariants

- **Deny by default**: an empty allowlist drops all inbound messages.
- **Token confinement**: `TELEGRAM_BOT_TOKEN` stays in `secrets.json` and in process memory only. The API exposes `hasToken` boolean. `ChannelManager` scrubs the token string from error messages before they reach any response or WS event.
- **No agent on the capture path**: inbound messages only ever become Inbox todos. Nothing in the gateway calls `runAgentTextQuery` or any tool — do not reintroduce an agent here without revisiting `channels-security.md`.
- **Reply reflects the outcome**: `uloženo` is sent only after the todo exists; otherwise the sender gets a `neuloženo – …` reply.
- **At-least-once delivery**: the polling offset is persisted after the handler runs. A crash between creating the todo and persisting the offset redelivers the update on restart and creates a duplicate Inbox todo (accepted — visible during triage).

## Security

Security details (ingestion allowlist, send policy, CSRF / host validation, capture-only trust model, WS origin validation, input limits, token scrubbing, event redaction, git staging guard) are documented in `docs/features/channels-security.md`.

## Setup

1. Create a Telegram bot via `@BotFather` and copy the bot token.
2. In Nomendex, open **Settings → API Keys** and save the token under key `TELEGRAM_BOT_TOKEN`.
3. Open **Settings → Channels** and:
   - Enable Telegram.
   - Add your Telegram chat ID (or `@username`) to the allowlist — one entry per line. The chat ID can be found by messaging `@userinfobot` on Telegram.
   - Optionally configure timezone (default `Europe/Prague`).
4. Save. The bot starts polling immediately.

Incoming DMs land in **Inbox** as todos; the conversation log (including the bot's confirmations) appears in the Chat browser under the Telegram filter. Click a thread to open it in `TelegramChatView`.

## File map

```
bun-sidecar/src/gateway/
├── types.ts
├── service.ts
├── channel-manager.ts
├── telegram-monitor.ts
├── telegram-normalization.ts
├── session-registry.ts
├── app-sessions.ts
├── storage.ts
├── security.ts
├── inbox-capture.ts
├── errors.ts
└── utils.ts

bun-sidecar/src/server-routes/channels-routes.ts
bun-sidecar/src/lib/agent-runtime.ts          # runAgentTextQuery (unused by gateway), buildAgentContext, buildMcpServersFromConfig
bun-sidecar/src/lib/request-security.ts       # CSRF / host / WS origin validation

bun-sidecar/src/features/channels/
├── types.ts                                   # Frontend UnifiedThread, UnifiedMessage, ChannelEvent
└── useChannelEvents.ts                        # WS hook

bun-sidecar/src/hooks/useAutoStickToBottom.ts
bun-sidecar/src/features/chat/browser-view.tsx   # ChatBrowserView (All/App/Telegram filter)
bun-sidecar/src/features/chat/chat-view.tsx      # ChatView dispatcher + TelegramChatView
bun-sidecar/src/pages/SettingsPage.tsx           # ChannelsSettings component (Channels tab)
```
