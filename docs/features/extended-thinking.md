# Extended Thinking (Thinking Effort)

**Status:** Implemented  
**Added in:** `0c5f3a3`  
**Affects:** Users, Developers

## Overview

Every chat message runs with adaptive thinking whose summary is shown in the chat, and a per-message **thinking effort** from the toolbar decides how much the model thinks. Higher effort improves quality on complex, multi-step problems at the cost of latency and tokens. You can switch the effort mid-conversation without changing the agent configuration.

## Use Cases

- Reasoning through a complex architecture decision
- Debugging a subtle multi-file interaction
- Planning a multi-step refactoring
- Any query where answer quality matters more than speed

## How It Works

### SDK options

The chat route always sends `thinking: { type: "adaptive", display: "summarized" }` and, when a preset other than Auto is selected, `effort`:

```typescript
// chat-routes.ts
thinking: { type: "adaptive", display: "summarized" },
...(effort && { effort }),
```

- **`display: "summarized"`** — without it the current models (Opus 4.7, Sonnet 5, Haiku 4.5) return thinking blocks with empty text, so the chat had nothing to show. The summary streams as `thinking_delta` events and is stored in the session transcript, so it also shows after reopening a session.
- **`effort`** replaces the deprecated `maxThinkingTokens`. Current models think adaptively and treat a token budget as plain on/off, so the old 1K–20K presets all behaved the same. Effort is what changes the depth (measured on Opus 4.7, same question: low 345, medium 547, high 566, max 875 output tokens).
- `type: "adaptive"` is safe on models without adaptive thinking too (Haiku 4.5): measured, the request does not fail and the model still thinks. Effort had no clear effect there.

The request field is validated with `ThinkingEffortSchema` (`features/chat/thinking-types.ts`); an unknown value is ignored (model default).

```
POST /api/chat
{ message, sessionId, agentId, effort: "high" }
```

### Presets

| Label | `effort` | Description |
|-------|----------|-------------|
| Auto   | `undefined` | Model default |
| Low    | `low`    | Fastest, least thinking |
| Medium | `medium` | Balanced |
| High   | `high`   | Thorough |
| Max    | `max`    | Deepest, slowest |

### Prompt cache

The effort level is part of the cached prompt prefix. Messages with the same effort reuse the cache; switching the preset mid-session writes the prefix again once (~16k tokens for the General Assistant).

### UI

`ThinkingSelector` renders as a **Brain** (🧠) icon button in the chat toolbar, next to the Agent selector. When a non-default preset is active, the icon turns primary-coloured and the preset label appears next to it.

State is local to the chat tab (`useState` in `chat-view.tsx`) — switching agent or opening a new tab resets to Auto.

## User Guide

### Changing the Thinking Effort

1. Open a chat tab.
2. Click the **🧠** (Brain) icon in the toolbar at the bottom of the chat.
3. Select a preset from the dropdown.
4. Send your message. The selected effort applies to that message and persists for subsequent messages in the same tab session until you change it.

### Choosing an Effort

| Situation | Recommended preset |
|-----------|-------------------|
| Quick factual questions | Low |
| Code review, explanation | Auto |
| Complex planning, debugging | High |
| Hard reasoning / ambiguous problems | Max |

Higher effort increases response time.

### Resetting to Default

Select **Auto** from the dropdown to use the model's default effort.

## Developer Guide

### Key Files

| File | Role |
|------|------|
| `bun-sidecar/src/features/chat/thinking-types.ts` | `ThinkingEffortSchema` (canonical type) |
| `bun-sidecar/src/features/chat/ThinkingSelector.tsx` | Dropdown UI with presets |
| `bun-sidecar/src/features/chat/chat-view.tsx` | State management, passes `effort` to the API call |
| `bun-sidecar/src/server-routes/chat-routes.ts` | Sends `thinking` + `effort` to the Claude Agent SDK |

## Troubleshooting

**Thinking selector is greyed out** — A query is in progress (`disabled={isLoading}`). Wait for the response to complete.

**No thinking shown** — Adaptive thinking skips easy questions, and Low often skips thinking entirely.

**No visible improvement at higher effort** — Some queries do not benefit from additional reasoning.

**Effort resets after switching tabs** — The effort is tab-local state. Each new chat tab starts at Auto. This is intentional — different conversations may need different depth.

## Related Features

- [Chat & Agents](chat.md) — full chat architecture and streaming
- [Agents & Skills](../CLAUDE.md) — agent model configuration
