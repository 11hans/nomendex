# Extended Thinking (Reasoning Tokens)

**Status:** Implemented  
**Added in:** `0c5f3a3`  
**Affects:** Users, Developers

## Overview

Extended Thinking gives Claude a configurable "thinking budget" — additional reasoning tokens the model uses internally before producing its response. Higher budgets improve quality on complex, multi-step problems at the cost of increased latency and token usage. The feature is per-message: you can switch the budget mid-conversation without changing the agent configuration.

## Use Cases

- Reasoning through a complex architecture decision
- Debugging a subtle multi-file interaction
- Planning a multi-step refactoring
- Any query where answer quality matters more than speed

## How It Works

### Parameter

`maxThinkingTokens` is an integer passed alongside the chat message. The Claude Agent SDK respects it as the thinking token budget for that query:

```
POST /api/chat
{ message, sessionId, agentId, maxThinkingTokens: 10000 }
```

The server spreads it into the SDK query options:

```typescript
// chat-routes.ts
...(maxThinkingTokens !== undefined && { maxThinkingTokens }),
```

When `undefined` (Auto preset), no explicit budget is sent and the SDK uses its default behaviour.

### Presets

| Label | `maxThinkingTokens` value | Description |
|-------|--------------------------|-------------|
| Auto  | `undefined` | SDK default (~medium) |
| Low   | 1 024 | ~1K tokens |
| Medium | 5 000 | ~5K tokens |
| High  | 10 000 | ~10K tokens |
| Max   | 20 000 | ~20K tokens |

These are UI presets — the underlying value is simply an integer. There is no server-side validation on the range.

### UI

`ThinkingSelector` renders as a **Brain** (🧠) icon button in the chat toolbar, next to the Agent selector. When a non-default preset is active, the icon turns primary-coloured and the preset label appears next to it.

State is local to the chat tab (`useState` in `chat-view.tsx`) — switching agent or opening a new tab resets to Auto.

## User Guide

### Changing the Thinking Budget

1. Open a chat tab.
2. Click the **🧠** (Brain) icon in the toolbar at the bottom of the chat.
3. Select a preset from the dropdown.
4. Send your message. The selected budget applies to that message and persists for subsequent messages in the same tab session until you change it.

### Choosing a Budget

| Situation | Recommended preset |
|-----------|-------------------|
| Quick factual questions | Auto or Low |
| Code review, explanation | Auto |
| Complex planning, debugging | High |
| Hard reasoning / ambiguous problems | Max |

Higher budgets increase response time. "Max" (20K tokens) can add 10–30 seconds to a response depending on the model and problem complexity.

### Resetting to Default

Select **Auto** from the dropdown to remove the explicit budget.

## Developer Guide

### Passing `maxThinkingTokens`

Include the field in the chat POST body:

```typescript
await fetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({
        message: "Explain this architecture",
        sessionId,
        maxThinkingTokens: 10000,  // optional
    }),
});
```

Omit the field or pass `undefined` to use the SDK default.

### Server Integration

```typescript
// bun-sidecar/src/server-routes/chat-routes.ts
const queryOptions = {
    model: agentConfig.model,
    // ...other options
    ...(maxThinkingTokens !== undefined && { maxThinkingTokens }),
};
```

### Key Files

| File | Role |
|------|------|
| `bun-sidecar/src/features/chat/ThinkingSelector.tsx` | Dropdown UI with presets |
| `bun-sidecar/src/features/chat/chat-view.tsx` | State management, passes value to API call |
| `bun-sidecar/src/server-routes/chat-routes.ts` | Forwards `maxThinkingTokens` to Claude Agent SDK |

### Adding a Custom Preset

Edit `PRESETS` in `ThinkingSelector.tsx`:

```typescript
const PRESETS: ThinkingPreset[] = [
    { label: "Auto",   value: undefined, description: "~Medium (default)" },
    { label: "Low",    value: 1024,      description: "~1K tokens" },
    // Add here:
    { label: "Custom", value: 7500,      description: "~7.5K tokens" },
    // ...
];
```

## Troubleshooting

**Thinking selector is greyed out** — A query is in progress (`disabled={isLoading}`). Wait for the response to complete.

**No visible improvement at higher budget** — Some queries do not benefit from additional reasoning. The model may reach a quality ceiling before the token budget is exhausted.

**Very slow responses at Max** — Expected. 20K thinking tokens can take 20–40 seconds. Use High (10K) for a better speed/quality trade-off in most cases.

**Budget resets after switching tabs** — The thinking budget is tab-local state. Each new chat tab starts at Auto. This is intentional — different conversations may need different budgets.

## Related Features

- [Chat & Agents](chat.md) — full chat architecture and streaming
- [Agents & Skills](../CLAUDE.md) — agent model configuration
