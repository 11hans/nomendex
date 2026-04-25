# Dev Cost Tracking

Internal developer telemetry for LLM call cost and token usage. **Not a user-facing feature.** Disabled by default; data lives outside the workspace so there's nothing to migrate or delete for users.

Purpose: optimize agent prompts, skills, and tool loops by measuring what each call costs and how well caching works.

## Activation

The telemetry is active in three contexts:

1. **`bun run dev`** — `NODE_ENV !== "production"` auto-enables the flag.
2. **`./build-install-dev`** — the installed "Nomendex Dev.app" has `NOMENDEX_DEV_COST_HUD=1` baked in at compile time. See [How it's wired into the dev build](#how-its-wired-into-the-dev-build).
3. **Any run with the env var** — `NOMENDEX_DEV_COST_HUD=1 bun …` or a launchctl-set var.

Production release builds (`./mac-app && make release` etc.) are off by default.

Override via `NOMENDEX_DEV_COST_HUD`:

| Value | Effect |
| --- | --- |
| unset | auto (on in dev, off in prod) |
| `1` / `true` | force on |
| `0` / `false` | force off |

When off, the entire code path is no-op — no SSE events, no disk writes, no git shell-outs, no token-counting overhead.

### How it's wired into the dev build

`bun build --compile` bakes env vars at compile time via `--define`. The sidecar build script (`mac-app/scripts/build_sidecar.sh`) checks `NOMENDEX_BUILD_VARIANT`:

```bash
if [ "${NOMENDEX_BUILD_VARIANT:-}" = "dev" ]; then
  EXTRA_DEFINES+=(--define "process.env.NOMENDEX_DEV_COST_HUD='1'")
fi
```

`./build-install-dev` sets `NOMENDEX_BUILD_VARIANT=dev` before invoking `make`, so the "Nomendex Dev.app" binary has the flag literally substituted as `'1'` inside. The production `make release` path does not set the variant, so release bundles stay clean.

## What it tracks

Events are emitted from the Claude Agent SDK message stream in `chat-routes.ts`:

- **`assistant_turn`** — emitted per SDK `assistant` message. Captures the usage for one LLM call inside a larger agent turn (tool loops produce multiple of these).
- **`result`** — emitted on the final SDK `result` message. Contains the authoritative `total_cost_usd` from the SDK and session aggregates (`duration_ms`, `num_turns`).

Each event includes:

| Field | Source |
| --- | --- |
| `timestamp`, `sessionId`, `agentId` | request context |
| `model`, `turnIndex` | SDK `message.model`, internal counter |
| `kind` | `"assistant_turn"` or `"result"` |
| `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens` | SDK `message.usage` / result `usage` |
| `thinkingTokens` | estimated from content blocks (`thinking.length / 4`) |
| `costUsdListPrice` | list-price estimate via `dev/pricing.ts`; for `result` uses SDK `total_cost_usd` directly |
| `durationMs`, `numTurns` | SDK result fields (result events only) |
| `toolsUsed` | `tool_use` block names in the assistant message |
| `messagePreview` | first 80 chars of the user prompt (for orientation in logs) |
| `gitBranch`, `gitSha` | read once per process via `git rev-parse` |

**Cost caveat.** `costUsdListPrice` is Anthropic API list price, not what a Max subscription actually costs. Good for relative comparison (version A vs B, skill X vs Y); not an invoice.

## Storage

JSONL append-only at:

```
~/Library/Logs/com.firstloop.nomendex/usage.jsonl
```

Standard macOS log path. Not inside any workspace. Not tracked by git. No rotation — for heavy use, rename the file manually at month boundaries.

One JSON object per line. Writes are fire-and-forget (`void logUsageEvent(...)`) and swallow errors — telemetry must never break the chat stream.

## HUD in chat

Under each assistant message a monospace line appears:

```
$0.0087 · 1.2k in · 340 out · cache 82% (980r/0w) · think ~120
```

- `$` — sum of `costUsdListPrice` across all `assistant_turn` events for that message, overwritten by the authoritative `result.total_cost_usd` when the result event lands.
- `cache %` — `cacheReadTokens / (inputTokens + cacheReadTokens + cacheCreationTokens)`. Biggest lever for BPagent optimization — system prompt should cache cleanly across turns.
- `think ~N` — estimated thinking tokens (present only when extended thinking produced output).

The HUD is wired through a new SSE event type `usage` piggybacked on the existing chat stream. The client attaches accumulated usage to the current `assistantMessageId` in state; no persistence.

## Code map

| File | Role |
| --- | --- |
| `bun-sidecar/src/dev/pricing.ts` | Per-model `$/1M tokens` table and `computeCostUsd()`. Date-suffix stripping so `claude-sonnet-4-5-20250929` resolves to `claude-sonnet-4-5`. |
| `bun-sidecar/src/dev/usage-logger.ts` | Env flag `DEV_COST_HUD_ENABLED`, SDK-message extractors (`extractAssistantUsage`, `extractResultUsage`), event builders, JSONL append, cached git context. |
| `bun-sidecar/src/server-routes/chat-routes.ts` | In the SDK iterator loop, after reading an `assistant` or `result` message, builds the event, logs it, and pushes a `type: "usage"` frame onto the SSE queue. Only runs when flag is on. |
| `bun-sidecar/src/features/chat/sessionUtils.ts` | `ChatMessage.usage?: TurnUsage` + `TurnUsage` type. |
| `bun-sidecar/src/features/chat/chat-view.tsx` | SSE handler for `data.type === "usage"` (accumulates per-turn, replaces with authoritative total on `result`) and render of the HUD line. |

## Analyzing the log

The log is plain JSONL. DuckDB handles it directly without schema setup.

**Cost and cache ratio per agent+model:**

```sh
duckdb -c "
SELECT
  agentId,
  model,
  count(*)                                                   AS calls,
  round(sum(costUsdListPrice), 4)                            AS usd,
  round(sum(cacheReadTokens)::DOUBLE
        / nullif(sum(cacheReadTokens + inputTokens + cacheCreationTokens), 0), 2) AS cache_ratio
FROM read_json_auto('~/Library/Logs/com.firstloop.nomendex/usage.jsonl')
WHERE kind = 'result'
GROUP BY 1, 2
ORDER BY usd DESC;
"
```

**Most expensive sessions in the last 7 days:**

```sh
duckdb -c "
SELECT sessionId, agentId, model, costUsdListPrice AS usd, numTurns, durationMs
FROM read_json_auto('~/Library/Logs/com.firstloop.nomendex/usage.jsonl')
WHERE kind = 'result'
  AND timestamp::TIMESTAMP > now() - INTERVAL 7 DAY
ORDER BY usd DESC
LIMIT 20;
"
```

**Tool frequency inside expensive turns:**

```sh
duckdb -c "
SELECT tool, count(*) AS uses, round(sum(costUsdListPrice), 4) AS usd
FROM (
  SELECT unnest(toolsUsed) AS tool, costUsdListPrice
  FROM read_json_auto('~/Library/Logs/com.firstloop.nomendex/usage.jsonl')
  WHERE kind = 'assistant_turn'
)
GROUP BY 1 ORDER BY usd DESC;
"
```

## Sharing with the team

The JSONL file is self-contained and includes `gitBranch` + `gitSha`, so a copy is enough context for someone else to reproduce analyses against a specific agent version. Options:

- Upload to shared Drive / S3.
- Load into BigQuery via `bq load --source_format=NEWLINE_DELIMITED_JSON`.
- Point Metabase / Superset at a local DuckDB instance that reads the file.

Do not send files from workspaces that contain private user content unless previews are acceptable to share — the `messagePreview` field contains the first 80 chars of user prompts.

## What this intentionally is not

- **Not a feature in the UI.** No browser tab, no API routes, no settings page. Keeping the surface area zero means no migration, no privacy review, no "hide this from users" toggles.
- **Not in `{workspace}/.nomendex/`.** Workspace data may be shared or committed to git; dev telemetry has no place there.
- **Not a billing record.** List prices, not Max-subscription usage.
- **Not versioned.** When the event schema changes, archive or delete the old file — no migrations.

## Extending

If the team later wants hosted dashboards instead of local DuckDB, the cleanest extension is a second drain in `logUsageEvent()` — e.g. `posthog.capture("$ai_generation", ev)` or a POST to a collector — behind its own env flag (`NOMENDEX_POSTHOG_KEY` etc.). The local JSONL should stay as source of truth so analysis works offline and the app never depends on a remote service for its own optimization loop.
