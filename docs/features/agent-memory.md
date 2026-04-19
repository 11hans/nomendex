# Agent Memory

Agent Memory provides long-term, structured memory for BPagent sessions. It includes:
- A persistence layer (`agent-memory.jsonl` via `FileDatabase`)
- MCP tools (`memory_search`, `memory_save`, `memory_list_recent`, `memory_delete`)
- REST APIs for search/save/manage workflows
- Memory Studio UI for human review/edit/delete
- Automatic post-session extraction (new — see below)
- Optional memory recall injection into BPagent runtime prompt

## Overview

The feature solves a gap in normal chat history: context that should survive across sessions (preferences, goals, decisions, project context, references).

At runtime, BPagent can:
1. Search memory before responding
2. Save durable context while working (or rely on automatic extraction)
3. Receive a compact serialized memory block in its system prompt

## Architecture

```text
BPagent chat request
  -> chat-routes.ts
     -> buildMemoryPromptBlock()        (recall into prompt)
     -> buildAgentMemoryMcpServer()     (MCP tools, read-only when extraction enabled)

Session ends
  -> triggerPostSessionExtraction()     (async, fire-and-forget)
     -> ExtractionOrchestrator
        -> OpenRouterExtractionProvider | ClaudeExtractionProvider
        -> saveAgentMemory()            (dedup + persist)

User / UI management
  -> /api/agent-memory/*
     -> features/agent-memory/fx.ts
        -> FileDatabase<AgentMemoryRecord>
```

Core files:
- `bun-sidecar/src/features/agent-memory/index.ts` (schemas, enums, defaults)
- `bun-sidecar/src/features/agent-memory/fx.ts` (search/save/delete/sync/prompt serialization, TTL cleanup)
- `bun-sidecar/src/features/agent-memory/extraction/orchestrator.ts` (post-session extraction)
- `bun-sidecar/src/features/agent-memory/extraction/prompt.ts` (extraction system prompt)
- `bun-sidecar/src/features/agent-memory/extraction/providers/` (OpenRouter, Claude providers)
- `bun-sidecar/src/mcp-servers/agent-memory.ts` (MCP tool definitions)
- `bun-sidecar/src/server-routes/agent-memory-routes.ts` (REST API)
- `bun-sidecar/src/features/memory/browser-view.tsx` (Memory Studio)

## Data Model

`AgentMemoryRecord` includes:
- `id`, `agentId`
- `scope`: `agent | workspace`
- `kind`: `preference | goal | project | decision | context | reference`
- `title`, `text`, `tags[]`
- `importance` (0–1), `confidence` (0–1)
- `fingerprint` (dedupe key)
- `sourceType`: `chat | note | todo | manual | system`
- `sourceRef`
- `createdAt`, `updatedAt`, `lastAccessedAt`
- `expiresAt` (optional ISO timestamp)
- `archived` (optional)

Default TTL policy (`DEFAULT_TTL_DAYS`):
- Expiring: `context` and `reference` (90 days)
- Non-expiring by default: `goal`, `project`, `decision`, `preference`

## Visibility and Scope

- `agent` scope: private to the same `agentId`
- `workspace` scope: shared across agents/subagents in workspace context

Search and listing enforce visibility:
- `agent` records require matching `agentId`
- `workspace` records are visible cross-agent

## Deduplication

Deduplication is fingerprint-based (`title + text + kind + scope`, normalized + hashed).

When saving:
- Existing same fingerprint + same `agentId` + same `scope` is merged/updated
- Otherwise a new record is inserted

## Importance-Based TTL Cleanup

Records are cleaned up in two ways:

1. **Explicit TTL** — if `expiresAt` is set and is in the past, the record is deleted.
2. **Importance-based TTL** — for records without an explicit `expiresAt`:

| `importance` | Lifetime (since `updatedAt`) |
|-------------|------------------------------|
| ≥ 0.7 | Permanent (never cleaned up) |
| 0.4 – 0.69 | 180 days |
| < 0.4 | 60 days |

Cleanup runs on service initialization and every 24 hours via a background interval timer (`CLEANUP_INTERVAL_MS = 24h`). The timer is `.unref()`-ed to avoid holding the Bun process open.

## Automatic Post-Session Extraction (New)

After a BPagent session ends, `triggerPostSessionExtraction()` runs asynchronously (fire-and-forget). It:

1. Loads extraction config from `workspace.json` → `memoryExtraction.provider`.
2. Skips if provider is `"disabled"` or the conversation has fewer than 2 turns.
3. Picks a provider: `openrouter` (requires `OPENROUTER_API_KEY` secret) or `claude` (uses Claude CLI).
4. Falls back to Claude if OpenRouter fails.
5. Submits conversation history to the provider, which returns memory candidates.
6. Saves non-duplicate candidates via `saveAgentMemory()`.

### Extraction Config

Stored in `{workspace}/.nomendex/workspace.json`:

```json
{
  "memoryExtraction": {
    "provider": "openrouter",
    "openRouterModel": "xiaomi/mimo-v2-flash:free"
  }
}
```

Valid providers: `"disabled"` | `"openrouter"` | `"claude"`

### Read-Only MCP Mode

When extraction is enabled, the `agent-memory` MCP server is mounted in **read-only** mode — `memory_save` is disabled. The agent is instructed to use `memory_search` and `memory_list_recent` only; saving is handled by the extractor after the session.

When extraction is disabled, the agent uses `memory_save` proactively.

### Frequency Guard

`sessionExtractionTurnCount` tracks how many turns were extracted per session. Re-extraction is skipped if the turn count hasn't changed since the last run.

## Prompt Recall Injection

`buildMemoryPromptBlock()` performs a safe, budgeted serialization:
- Memory search first, highest relevance first
- Per-field truncation (`title`, `text`)
- Hard cap on total prompt payload size
- JSON serialization (not free-form markdown) to reduce prompt-injection risk

Resulting block is appended to BPagent system prompt when available.

## MCP Tools

MCP server name: `agent-memory`

Tools (read-only when extraction is enabled):
- `memory_search`
- `memory_list_recent`
- `memory_delete`
- `memory_save` _(disabled in read-only mode)_

BPagent auto-allows `mcp__agent-memory__*` tools in chat permission flow.

## REST API

### Query/CRUD

- `POST /api/agent-memory/search`
- `POST /api/agent-memory/save`
- `POST /api/agent-memory/delete`
- `POST /api/agent-memory/list-recent`

### Memory Studio management

- `POST /api/agent-memory/manage/list`
- `POST /api/agent-memory/manage/get-markdown`
- `POST /api/agent-memory/manage/create-markdown`
- `POST /api/agent-memory/manage/save-markdown`
- `POST /api/agent-memory/manage/delete`
- `POST /api/agent-memory/manage/sync-vault`

## Access Control

Routes validate memory-enabled agents. Current allowlist:
- `bpagent`

Invalid agent IDs return `403`.

## TheVault Sync and 409 Mismatch

`/api/agent-memory/manage/sync-vault` imports memory candidates from vault files (Goals/Projects) but only when active workspace matches `THE_VAULT_WORKSPACE_PATH`.

Mismatch behavior:
- Throws `MemoryWorkspaceMismatchError`
- API returns HTTP `409` with:
  - `code: "WRONG_WORKSPACE"`
  - `expectedWorkspacePath`
  - `activeWorkspacePath`

This protects against accidental cross-workspace memory ingestion.

## Memory Studio UX Flow

Memory Studio (`features/memory/browser-view.tsx`) supports:
- List/filter/search managed memories
- Open memory as markdown representation
- Create from template
- Edit and save markdown-backed memory
- Delete memory
- Sync from vault

This gives users a transparent, editable memory layer instead of black-box memory only.

## Troubleshooting

**Extraction not running** — Check `workspace.json` → `memoryExtraction.provider`. If `"disabled"`, no extraction occurs. If `"openrouter"`, verify `OPENROUTER_API_KEY` is set in `secrets.json`.

**Memory not appearing after session** — Extraction is fire-and-forget and runs after the query completes. Wait a few seconds, then check Memory Studio. Short conversations (< 2 turns) are skipped.

**Old memories not being cleaned up** — Cleanup runs every 24h. To force it, restart the Bun sidecar (cleanup runs on init). Records with `importance ≥ 0.7` are permanent and will not be cleaned.

**`memory_save` is missing from MCP tools** — This is expected when extraction is enabled. The agent should not save manually; the extractor handles it post-session.

## Related Features

- [Chat & Agents](chat.md) — full chat architecture
- [Goals System](typed-goal-graph.md) — goals can be synced as workspace-scope memories via vault sync
