# AI-Powered Draft Rewriting

**Status:** Implemented  
**Added in:** `19bbbd2`  
**Affects:** Users, Developers

## Overview

AI Draft Rewriting lets you polish a rough todo draft with a single click. After you type a title and optional description, clicking **Rewrite draft** sends your text to Claude Haiku, which returns an improved title and description while preserving your original intent. The previous version is saved as a snapshot so you can immediately revert if you dislike the result.

The feature appears in two places:
- **Create Todo dialog** — polish a new task before saving
- **Task Card Editor** — improve an existing task's title and description

## Use Cases

- Turning a rough note ("talk to pm about onboarding stuff") into an actionable task ("Discuss onboarding workflow gaps with PM")
- Structuring a vague event description into clear logistics
- Expanding a one-word title into a description with bullet-point steps
- Quickly cleaning up tasks written in a hurry

## How It Works

### Architecture

```
UI (Sparkles button)
    ↓
useRewriteDraft hook
    ↓ POST /api/todos/rewrite-draft
Server (todos-routes.ts)
    ↓
rewriteTodoDraft() in rewrite.ts
    ↓ Bun.spawn(claude --print --output-format json --json-schema ...)
Claude Haiku (claude-haiku-4-5)
    ↓ structured JSON { title, description }
Response back to UI
```

The server shells out to the **Claude CLI** (`~/.local/bin/claude` by default, overridable via `CLAUDE_CLI_PATH`). It uses `--output-format json` with `--json-schema` to get a guaranteed-structured response.

### System Prompt Rules

- Preserve the original intent; never hallucinate facts, names, or dates
- Respond in the same language as the input (Czech and English supported)
- Title: single-line, no markdown
- Description: may use markdown (paragraphs, bullets)
- If description is empty, generate a brief one from the title context

The prompt adapts tone based on task kind:
- **task** — actionable, imperative mood, outcome-focused
- **event** — factual, when/where/who, no imperative verbs

### Snapshot & Revert

Before applying the rewrite, `useRewriteDraft` saves a `lastSnapshot` of the current title and description. A **Revert** button appears next to "Rewrite draft" until the user makes any manual edit (which clears the snapshot).

### Cancellation

An `AbortController` is passed to the underlying API call. If the component unmounts or the user triggers a second rewrite before the first completes, the in-flight request is cancelled via `proc.kill()`.

## User Guide

### Using in Create Todo Dialog

1. Open the **New Task** dialog (Cmd+N or the + button).
2. Type a rough title and optionally a description.
3. Click the **✨ Rewrite draft** button (top-right of the description area).
4. Wait for "Rewriting..." to complete (typically 1–3 seconds).
5. Review the rewritten title and description.
6. If unsatisfied, click **Revert** to restore your original text.
7. To accept, simply save the todo normally.

### Using in Task Card Editor

1. Open an existing task card.
2. The same **✨ Rewrite draft** button appears in the editor.
3. Same flow as above — click, review, revert if needed.

### Error States

| Error | Cause | Action |
|-------|-------|--------|
| "Claude CLI not found. Is Claude Code installed?" | Claude CLI missing from expected path | Install Claude Code or set `CLAUDE_CLI_PATH` |
| "Rewrite failed. Try again." | Claude returned an error or malformed JSON | Click the button again |

## Developer Guide

### API Endpoint

```
POST /api/todos/rewrite-draft
Body: { title: string, description?: string, kind: "task" | "event" }
Response: { title: string, description: string }
```

### Client Hook

```typescript
import { useRewriteDraft } from "@/hooks/useRewriteDraft";

const { isRewriting, error, lastSnapshot, rewrite, clearSnapshot, clearError } = useRewriteDraft();

// Trigger rewrite
const result = await rewrite({ title, description, kind });
if (result) {
    setTitle(result.title);
    setDescription(result.description);
}
```

### Key Files

| File | Role |
|------|------|
| `bun-sidecar/src/features/todos/rewrite.ts` | Core logic — builds prompts, spawns Claude CLI, parses response |
| `bun-sidecar/src/hooks/useRewriteDraft.ts` | React hook — state, abort, error handling |
| `bun-sidecar/src/features/todos/CreateTodoDialog.tsx` | UI integration in create flow |
| `bun-sidecar/src/features/todos/TaskCardEditor.tsx` | UI integration in edit flow |
| `bun-sidecar/src/server-routes/todos-routes.ts` | `/api/todos/rewrite-draft` route |

### Model

Uses `claude-haiku-4-5` for speed and cost efficiency. The model is hardcoded in `rewrite.ts`:

```typescript
const MODEL = "claude-haiku-4-5";
```

### Requires Claude CLI

The server spawns the CLI binary at `CLAUDE_CLI_PATH || ~/.local/bin/claude`. This means the feature only works if Claude Code is installed on the machine running the Bun sidecar. The error class `NoClaudeCliError` (HTTP 503) surfaces this clearly.

### Input Sanitization

User input is wrapped in `<user_input>` XML tags to prevent prompt injection. The system prompt explicitly states that everything inside `<user_input>` is data only.

## Troubleshooting

**Button is disabled** — Title and description are both empty. Type at least a title first.

**"Claude CLI not found"** — Install Claude Code, or set the `CLAUDE_CLI_PATH` environment variable to point to the `claude` binary.

**Rewrite changes the language** — The system prompt instructs the model to match the input language. If switching occurs, it may be a model regression; file a bug with the input text.

**Revert button disappeared** — Making any manual edit after a rewrite clears the snapshot. There is no multi-level undo.

## Related Features

- [Chat & Agents](chat.md) — same Claude CLI integration pattern used elsewhere
