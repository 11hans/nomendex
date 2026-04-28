# Agent Memory

Agent Memory provides long-term, structured memory for BPagent sessions. It includes:
- A persistence layer (`agent-memory.jsonl` via `FileDatabase`)
- MCP tools (`memory_search`, `memory_save`, `memory_list_recent`, `memory_delete`)
- REST APIs for search/save/manage workflows
- Memory Studio UI for human review/edit/delete
- Automatic post-session extraction (new — see below)
- Optional memory recall injection into BPagent runtime prompt
- Optional semantic (vector) search via Voyage AI embeddings — see "Vector Search"

## Overview

The feature solves a gap in normal chat history: context that should survive across sessions (preferences, goals, decisions, project context, references).

At runtime, BPagent can:
1. Search memory before responding (keyword + optional vector hybrid scoring)
2. Save durable context while working (or rely on automatic extraction)
3. Receive a compact serialized memory block in its system prompt

## Architecture

```text
Service init (initializeAgentMemoryService)
  -> FileDatabase<AgentMemoryRecord>     (persistence)
  -> initEmbeddings()                    (load vector store, non-blocking)
  -> cleanupExpired()                    (TTL + decay prune)
  -> sweepOrphanEmbeddings()             (remove embeddings without records)
  -> backfillMissingEmbeddings()         (background, fire-and-forget)
  -> startDailyMaintenance(22)           (scheduled at 10 PM local time)

BPagent chat request
  -> chat-routes.ts
     -> buildMemoryPromptBlock()        (recall into prompt)
     -> buildAgentMemoryMcpServer()     (MCP tools, read-only when extraction enabled)

Session ends
  -> triggerPostSessionExtraction()     (async, fire-and-forget)
     -> ExtractionOrchestrator
        -> OpenRouterExtractionProvider | ClaudeExtractionProvider
        -> saveAgentMemory()            (dedup + persist + embed)

Search (hybrid scoring)
  -> searchAgentMemory()
     -> embedQuery()                     (cached, 5-min LRU)
     -> dot(queryVec, recordVec)         (cosine sim via L2-normalized vectors)
     -> 0.6 × sim + 0.4 × keywordScore  (hybrid combine)
     -> CORRECTION_SCORE_BOOST           (applied after hybrid)

Daily maintenance (22:00 local, fire-and-forget)
  -> runDailyMaintenance()
     -> cleanupExpired()                 (TTL + decay)
     -> repairSupersedes()               (clean dead refs)
     -> sweepOrphanEmbeddings()          (re-run)
     -> runIntegrityCheck()              (empty content, fingerprint drift)
     -> runAIConsolidation()             (optional, via extraction provider)

User / UI management
  -> /api/agent-memory/*
  -> /api/memory-embeddings/config
     -> features/agent-memory/fx.ts
     -> features/agent-memory/embeddings.ts
     -> features/agent-memory/maintenance.ts
        -> FileDatabase<AgentMemoryRecord>
```

Core files:
- `bun-sidecar/src/features/agent-memory/index.ts` (schemas, enums, defaults)
- `bun-sidecar/src/features/agent-memory/fx.ts` (search/save/delete/sync/prompt serialization, TTL cleanup, hybrid scoring)
- `bun-sidecar/src/features/agent-memory/embeddings.ts` (Voyage embeddings, binary vector store, query cache, backfill)
- `bun-sidecar/src/features/agent-memory/maintenance.ts` (daily maintenance loop, repair, AI consolidation, scheduling)
- `bun-sidecar/src/features/agent-memory/extraction/orchestrator.ts` (post-session extraction)
- `bun-sidecar/src/features/agent-memory/extraction/prompt.ts` (extraction system prompt)
- `bun-sidecar/src/features/agent-memory/extraction/providers/` (OpenRouter, Claude providers)
- `bun-sidecar/src/mcp-servers/agent-memory.ts` (MCP tool definitions)
- `bun-sidecar/src/server-routes/agent-memory-routes.ts` (REST API)
- `bun-sidecar/src/server-routes/memory-embeddings-routes.ts` (embeddings config API)
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

## Daily Memory Maintenance

A daily maintenance loop keeps memory healthy and compact. It runs at a scheduled hour (default 22:00 local) and consists of:

### Mechanical maintenance (always runs, zero cost)

1. **`cleanupExpired()`** — Hard-deletes records via two mechanisms:
   - **Explicit TTL** — if `expiresAt` is set and is in the past, the record and its embedding are deleted.
   - **Importance-based decay** — for records without explicit `expiresAt`:

     | `importance` | Lifetime (since `updatedAt`) |
     |-------------|------------------------------|
     | ≥ 0.7 | Permanent (never cleaned up) |
     | 0.4 – 0.69 | 180 days |
     | < 0.4 | 60 days |

   Records that fall below a quality threshold (`importFactor + recencyFactor + decayFactor < -0.6`) are pruned. Records with score ≥ -0.5 but below 0 are archived instead. Both paths also remove the corresponding embedding.

2. **`repairSupersedes()`** — Walks every record's `supersedes[]` and drops IDs that no longer exist in the database. These dead references accumulate when a superseded record is later pruned by decay/TTL.

3. **`sweepOrphanEmbeddings()`** — Removes embeddings whose owning record is gone. This also runs on service init.

4. **`runIntegrityCheck()`** — Read-only scan for:
   - Records with empty `title` and `text`
   - Fingerprint drift (recomputed fingerprint doesn't match stored one)

### AI consolidation (optional, via extraction provider)

**`runAIConsolidation()`** — Single-pass Proposer using the configured extraction provider. Both `"openrouter"` and `"claude"` providers route through OpenRouter API using `memoryExtraction.consolidationModel` (default `anthropic/claude-sonnet-4-6`). Runs when:
- `memoryExtraction.provider !== "disabled"` (both `"openrouter"` and `"claude"` require `OPENROUTER_API_KEY`)
- At least 10 active, non-archived records exist

The LLM receives a compact list of memory records sorted by importance (low first) + age (old first) and proposes:
- **prune** — delete obsolete/noise records
- **supersede** — archive losers, keep winner
- **merge** — archive losers, keep winner

Safety guards:
- `correction` kind records are **never** pruned, superseded, or merged
- Records with `importance >= 0.9` are excluded from candidates
- Records with `importance >= 0.7` are not pruned/superseded/merged even if proposed
- Cross-scope safety: never archive a `workspace` memory in favor of an `agent` one
- Archived records, corrections, and already-expired records are excluded from candidates
- Max 80 candidates per run (oldest, lowest-importance first)

Proposals are validated against the live database before application. Failures are isolated per proposal.

### Scheduling

`startDailyMaintenance(hour)` returns a dispose function. The first run fires at the exact target time (`computeMsUntilNext`), then switches to a 24-hour interval. Both timers are `.unref()`-ed to avoid holding the Bun process open. The dispose function is stored in `maintenanceDispose` and called:
- On workspace init (replaces any previous schedule)
- On workspace switch/teardown via `disposeAgentMemoryService()`

The maintenance loop is kicked off from `initializeAgentMemoryService()` in `services/workspace-init.ts`.

## Automatic Post-Session Extraction (New)

After a BPagent session ends, `triggerPostSessionExtraction()` runs asynchronously (fire-and-forget). It:

1. Loads extraction config from `workspace.json` → `memoryExtraction.provider`.
2. Skips if provider is `"disabled"` or the conversation has fewer than 2 turns.
3. Picks a provider: `openrouter` (requires `OPENROUTER_API_KEY` secret) or `claude` (uses `@ai-sdk/anthropic` with `ANTHROPIC_API_KEY`).
4. Falls back to Claude if OpenRouter fails.
5. Submits conversation history to the provider, which returns memory candidates.
6. Saves non-duplicate candidates via `saveAgentMemory()`.

### Extraction Config

Stored in `{workspace}/.nomendex/workspace.json`:

```json
{
  "memoryExtraction": {
    "provider": "openrouter",
    "openRouterModel": "xiaomi/mimo-v2-flash:free",
    "consolidationModel": "anthropic/claude-sonnet-4-6"
  }
}
```

Three fields, two different jobs:

| Field | Controls | Used by |
|---|---|---|
| `provider` | **Post-session extraction** provider (runs after every BPagent chat). `"openrouter"` → OpenRouter API; `"claude"` → Anthropic API via `@ai-sdk/anthropic` with `claude-haiku-4-5`; `"disabled"` → skip. Also gates daily AI consolidation. | Post-session extraction, AI consolidation |
| `openRouterModel` | Model for **post-session extraction** when provider is `"openrouter"`. | `OpenRouterExtractionProvider` |
| `consolidationModel` | Model for **daily AI consolidation** (prune/supersede/merge proposals). Both `"openrouter"` and `"claude"` providers route consolidation through OpenRouter using this model. Default: `anthropic/claude-sonnet-4-6`. | `runAIConsolidation()` in `maintenance.ts` |

Valid `provider` values: `"disabled"` | `"openrouter"` | `"claude"`

When `provider` is `"claude"`, post-session extraction uses `ANTHROPIC_API_KEY` (not `OPENROUTER_API_KEY`). AI consolidation still requires `OPENROUTER_API_KEY` for all providers.

### Read-Only MCP Mode

When extraction is enabled, the `agent-memory` MCP server is mounted in **read-only** mode — `memory_save` is disabled. The agent is instructed to use `memory_search` and `memory_list_recent` only; saving is handled by the extractor after the session.

When extraction is disabled, the agent uses `memory_save` proactively.

### Frequency Guard

`sessionExtractionTurnCount` tracks how many turns were extracted per session. Re-extraction is skipped if the turn count hasn't changed since the last run.

## Vector Search (Semantic Recall)

Keyword search alone misses synonym/paraphrase recall — "Jakou kávu mám rád?" never matches "Preferuji espresso s mlékem". Optional vector search closes this gap with a hybrid scoring model that preserves the existing recency / importance / tag / correction signals.

### Provider Configuration

Embeddings are **opt-in** (default `disabled`) — memory contents leave the workspace, so the user must explicitly turn it on.

`{workspace}/.nomendex/workspace.json`:

```json
{
  "embeddings": {
    "provider": "voyage"
  }
}
```

Valid providers: `"disabled"` | `"voyage"`. The Voyage AI API key is read from `secrets.json` as `VOYAGE_API_KEY` (same pattern as `OPENROUTER_API_KEY`). When provider is `disabled` or the key is missing, search transparently falls back to keyword-only ranking — nothing else changes.

Model: `voyage-3-lite`, 512 dimensions, ~$0.10 / 1M tokens (≈ $0.01 one-time for 1000 memories).

### Storage Layout

Vectors are persisted alongside `.nomendex/`:

- `agent-memory-embeddings.bin` — packed Float32 vectors, L2-normalized at write time so cosine similarity collapses to a dot product
- `agent-memory-embeddings.idx` — JSON map of `id → vector offset`

Float32 + binary keeps 10k records at ~20 MB. Writes are atomic via `temp + rename`, serialized through a `FileMutex`.

### Hybrid Scoring

```
sim    = max(0, dot(queryVec, recordVec))    // 0 if record has no embedding
hybrid = 0.6 × sim + 0.4 × keywordScore       // keywordScore WITHOUT correction boost
final  = hybrid + (record.kind === "correction" ? 0.15 : 0)
```

Key invariants:
- The correction boost is applied **after** the hybrid combine, so it isn't diluted to `0.4 × 0.15`.
- Records without an embedding get `sim = 0` and the same hybrid formula, keeping all records on a consistent scale.
- When the query embedding fails (API error, empty query), every record falls back to pure keyword scoring — order remains deterministic.

The keyword score is split into `scoreRecordBase` (no correction boost, used by hybrid) and `scoreRecord` (with boost, used by Memory Studio's `listManagedMemories`).

### Lifecycle Hooks

Embeddings are kept in sync with records throughout the lifecycle:

| Event | Behavior |
|---|---|
| `saveAgentMemory` (create) | Fire-and-forget embed + store |
| `saveAgentMemory` (dedup) | Re-embed only if `fingerprint` changed |
| `saveMemoryFromMarkdown` (create/update) | Same — re-embed gated on fingerprint change |
| `syncAgentMemoryFromVault` (create/update) | Same — fire-and-forget so vault sync stays fast |
| `deleteAgentMemory` | Embedding removed |
| `cleanupExpired` (TTL prune, decay prune) | Embedding removed alongside record |
| Daily maintenance `sweepOrphanEmbeddings` | Re-runs orphan sweep |
| AI consolidation prune | Embedding removed via `deleteMemoryRaw` |
| Archive (decay archive, supersedes, vault archive) | Embedding kept (search filters `archived` records anyway) |
| Service init | Orphan sweep removes embeddings whose record id no longer exists |

Re-embed is gated on `existing.fingerprint !== newFingerprint`, so unchanged content (the common dedup path) costs zero API calls.

### Backfill

`initializeAgentMemoryService` only **reads** existing `.bin` / `.idx` — it never blocks startup on Voyage. Records that lack an embedding are processed in a background task (`backfillMissingEmbeddings`) using Voyage's batch endpoint (up to 128 inputs per request, 5 concurrent batches). Search works during the backfill — those records just score with `sim = 0` until their embedding lands.

### Query Cache

`embedQuery` keeps a 50-entry LRU with a 5-minute TTL keyed on `query.trim().toLowerCase()`. This prevents debounced UI search bars (Memory Studio, command palette) from re-billing identical queries.

### Lifecycle and Cancellation

A single module-level `AbortController` is created in `initEmbeddings` and aborted in `disposeEmbeddings`, cancelling in-flight Voyage requests when the workspace switches or the sidecar shuts down. `flushEmbeddings` runs on dispose to persist any pending writes.

If the workspace toggles `embeddings.provider` at runtime, call `invalidateEmbeddingsConfig()` to drop the cached config — the next `embeddingsAvailable()` call will re-read `workspace.json`.

### Failure Modes

- Voyage API failure → `embed()` returns `null`; search falls back to pure keyword.
- Corrupt `.bin` or `.idx` at startup → log warning, start with an empty map, backfill rebuilds.
- Crash mid-flush → `temp + rename` guarantees the previous committed file is intact.
- Texts shorter than 20 chars → not embedded (signal-to-noise too low).

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

### Embeddings config

- `GET /api/memory-embeddings/config` — read current embeddings config
- `POST /api/memory-embeddings/config` — update provider + API key

### Vault pin

- `GET /api/agent-memory/vault-pin` — returns the configured vault workspace path (or `null` if unset)

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

## Vault Sync and 409 Mismatch

`/api/agent-memory/manage/sync-vault` imports memory candidates from vault files (Goals/Projects). Vault path is configurable via the `NOMENDEX_VAULT_WORKSPACE_PATH` environment variable:

- **When set** — sync only works when the active workspace matches the configured path. Mismatched workspaces get a `409` response.
- **When unset** — any workspace can run vault sync (no pinning, distribution-friendly).

The Memory Studio queries `/api/agent-memory/vault-pin` to determine whether to show the workspace mismatch CTA.

Mismatch behavior:
- Throws `MemoryWorkspaceMismatchError`
- API returns HTTP `409` with:
  - `code: "WRONG_WORKSPACE"`
  - `expectedWorkspacePath`
  - `activeWorkspacePath`

This protects against accidental cross-workspace memory ingestion when the env var is configured.

## Memory Studio UX Flow

Memory Studio (`features/memory/browser-view.tsx`) supports:
- List/filter/search managed memories
- Open memory as markdown representation
- Create from template
- Edit and save markdown-backed memory
- Delete memory
- Sync from vault (respects `NOMENDEX_VAULT_WORKSPACE_PATH` pin; shows workspace mismatch CTA when pinned to a different workspace)

This gives users a transparent, editable memory layer instead of black-box memory only.

## Troubleshooting

**Extraction not running** — Check `workspace.json` → `memoryExtraction.provider`. If `"disabled"`, no extraction occurs. If `"openrouter"`, verify `OPENROUTER_API_KEY` is set in `secrets.json`.

**Memory not appearing after session** — Extraction is fire-and-forget and runs after the query completes. Wait a few seconds, then check Memory Studio. Short conversations (< 2 turns) are skipped.

**Old memories not being cleaned up** — Daily maintenance runs at 22:00 local time. To force it, restart the Bun sidecar (cleanup runs on init). Records with `importance ≥ 0.7` are permanent and will not be cleaned. Check the server log for `Daily memory maintenance complete` messages.

**`memory_save` is missing from MCP tools** — This is expected when extraction is enabled. The agent should not save manually; the extractor handles it post-session.

**Semantic search not finding obvious matches** — Check Settings → Memory → Semantic Search. If provider is `disabled`, only keyword search runs. If `voyage`, verify the Voyage API key is saved. Existing memories without embeddings are filled in by the background backfill — newly imported workspaces may take a minute before semantic recall is fully populated.

**Embeddings store rebuild** — Delete `agent-memory-embeddings.bin` and `agent-memory-embeddings.idx` from `.nomendex/` and restart the sidecar. The next init will start with an empty store and the background backfill will regenerate embeddings for all active records.

**Vault sync returns 409** — Check that `NOMENDEX_VAULT_WORKSPACE_PATH` env var points to the correct workspace, or unset it to allow vault sync in any workspace.

## Related Features

- [Chat & Agents](chat.md) — full chat architecture
- [Goals System](typed-goal-graph.md) — goals can be synced as workspace-scope memories via vault sync
