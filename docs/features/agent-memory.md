# Agent Memory

Agent Memory provides long-term, structured memory for BPagent sessions. It includes:
- A persistence layer (`agent-memory.jsonl` via `FileDatabase`)
- MCP tools (`memory_search`, `memory_save`, `memory_list_recent`, `memory_delete`)
- REST APIs for search/save/manage workflows
- Memory Studio UI for human review/edit/delete
- Optional memory recall injection into BPagent runtime prompt

## Overview

The feature solves a gap in normal chat history: context that should survive across sessions (preferences, goals, decisions, project context, references).

At runtime, BPagent can:
1. Search memory before responding
2. Save durable context while working
3. Receive a compact serialized memory block in its system prompt

## Architecture

```text
BPagent chat request
  -> chat-routes.ts
     -> buildMemoryPromptBlock()     (recall into prompt)
     -> buildAgentMemoryMcpServer()  (MCP tools)

User / UI management
  -> /api/agent-memory/*
     -> features/agent-memory/fx.ts
        -> FileDatabase<AgentMemoryRecord>
```

Core files:
- `bun-sidecar/src/features/agent-memory/index.ts` (schemas, enums, defaults)
- `bun-sidecar/src/features/agent-memory/fx.ts` (search/save/delete/sync/prompt serialization)
- `bun-sidecar/src/mcp-servers/agent-memory.ts` (MCP tool definitions)
- `bun-sidecar/src/server-routes/agent-memory-routes.ts` (REST API)
- `bun-sidecar/src/features/memory/browser-view.tsx` (Memory Studio)

## Data Model

`AgentMemoryRecord` includes:
- `id`, `agentId`
- `scope`: `agent | workspace`
- `kind`: `preference | goal | project | decision | context | reference`
- `title`, `text`, `tags[]`
- `importance` (0-1), `confidence` (0-1)
- `fingerprint` (dedupe key)
- `sourceType`: `chat | note | todo | manual | system`
- `sourceRef`
- `createdAt`, `updatedAt`, `lastAccessedAt`
- `expiresAt` (optional)
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

## Deduplication and Cleanup

Deduplication is fingerprint-based (`title + text + kind + scope`, normalized + hashed).

When saving:
- Existing same fingerprint + same `agentId` + same `scope` is merged/updated
- Otherwise a new record is inserted

Cleanup:
- Expired records (`expiresAt < now`) are periodically removed
- Cleanup runs on initialization and then on interval (24h)

## Prompt Recall Injection

`buildMemoryPromptBlock()` performs a safe, budgeted serialization:
- Memory search first, highest relevance first
- Per-field truncation (`title`, `text`)
- Hard cap on total prompt payload size
- JSON serialization (not free-form markdown) to reduce prompt-injection risk

Resulting block is appended to BPagent system prompt when available.

## MCP Tools

MCP server name: `agent-memory`

Tools:
- `memory_search`
- `memory_save`
- `memory_list_recent`
- `memory_delete`

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
