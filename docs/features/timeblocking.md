# Timeblocking

Template-driven **weekly schedule generator**. You pick a day type for each of the 7 days in a week; Nomendex expands the matching day template into concrete `event` todos (scheduled blocks like "Deep Work 19:30–21:30") and writes them onto the week. The generator is idempotent per week and validates coverage + conflicts before anything is written.

Timeblocks are **schedule containers, not actionable tasks** — they are excluded from carry-forward, completion-rate math, and planned-task counts everywhere (daily/weekly/monthly review logic keys off `kind: "event"` + `source: "timeblock-generator"`; legacy fallback: tag `timeblock`).

## Concepts

- **Day type** — one of `work_full`, `work_early`, `pohotovost` (on-call), `free`. Each maps to a day template.
- **Block type** — a reusable block definition: `title`, `durationMin`, `project`, `tags`, optional `descriptionTemplate`. Referenced by id from templates and coverage rules.
- **Day template** — an ordered list of `{ blockType, start }` entries for a day type. `start` is either a clock time `HH:mm` (24h) or the relative expression `workEnd+<N>min` (resolved against that day's `workEnd`).
- **Coverage rule** — `{ id, blockType, minPerWeek, label }`. Checks whether a block type appears at least `minPerWeek` times across the generated week. Advisory only — coverage `warning` does **not** block apply.

## Config

Stored per workspace at `{workspace}/.nomendex/timeblocking.json` (`config.ts`, schema in `types.ts`). `ensureTimeblockingConfig()` writes a default config on first use.

```typescript
interface TimeblockingConfig {
    version: 1;
    defaults: { defaultDayType: DayType };
    blockTypes: Record<string, {
        title: string;
        durationMin: number;          // block length in minutes
        project: string;              // must be an existing project (else missing-project conflict)
        tags: string[];
        descriptionTemplate?: string; // {{weekStart}}, {{date}}, {{blockType}} placeholders
    }>;
    dayTemplates: {
        work_full: TemplateEntry[];
        work_early: TemplateEntry[];
        pohotovost: TemplateEntry[];
        free: TemplateEntry[];
    };
    coverageRules: { id: string; blockType: string; minPerWeek: number; label: string }[];
}
// TemplateEntry = { blockType: string; start: string }  // start: "HH:mm" | "workEnd+<N>min"
```

The default config seeds block types `morning-review`, `deep-work`, `movement`, `renovation`, `admin`, `evening-review` (all in the `Inbox` project), templates for the four day types, and coverage rules `movement` 3×/week, `renovation` 1×/week, `morning-review` 5×/week. There is no settings UI yet — edit `timeblocking.json` directly to customize.

### `start` expression syntax (`generate.ts`)

- `HH:mm` — absolute clock time, 00:00–23:59.
- `workEnd+<N>min` — `<N>` minutes after the day's `workEnd` (e.g. `workEnd+30min`). Only `+` and the `min` unit are supported. If a template uses this and the day has no `workEnd`, generation fails with a `missing-work-end` conflict.

A block ends at `start + durationMin`.

## Preview / Apply (`service.ts`)

Input: `{ weekStart, days }` where `weekStart` is a **Monday** (`YYYY-MM-DD`, validated) and `days` is **exactly 7** `DayConfig` (`{ type: DayType; workEnd?: "HH:mm" }`), Monday→Sunday.

- **`previewTimeblockingPlan`** → `{ weekStart, existingBlocks, generatedBlocks, conflicts, coverage }`. Pure computation, writes nothing. `existingBlocks` = current timeblock events overlapping the week (these would be replaced). `conflicts` includes project validation against the real project list.
- **`applyTimeblockingPlan`** → preview + `{ createdTodos, deletedBlocks }`. **Throws if any conflict is present.** Otherwise it deletes the week's existing timeblock events, then creates the generated ones — so re-running for the same week **replaces** rather than duplicates. On error it rolls back (re-creates deleted snapshots, removes partially created todos).

### Conflict codes (`validate.ts` + `generate.ts`)

| code | meaning |
|------|---------|
| `unknown-block-type` | template references a block type not in `blockTypes` |
| `missing-work-end` | a `workEnd+…` block on a day without `workEnd` |
| `invalid-time-expression` | start expression / scheduled time could not be parsed |
| `invalid-range` | block start ≥ end |
| `crosses-midnight` | block start and end fall on different calendar days |
| `overlap` | two blocks on the same day overlap |
| `missing-project` | block's `project` is not an existing project |

### Generated todo shape

Each generated block becomes a todo with `kind: "event"`, `source: "timeblock-generator"`, `status: "todo"`, plus `title`, `project`, `tags`, `scheduledStart`/`scheduledEnd` (local `YYYY-MM-DDTHH:mm`), and a rendered `description`. Because they carry `scheduledStart`/`scheduledEnd`, they also flow to Apple Calendar via the normal calendar sync.

## UI — "Plan Week" dialog (`TimeblockingDialog.tsx`)

Opened from the command palette (⌘K) → **"Plan Week (Timeblocking)"** (registered in `features/todos/commands.tsx`).

- Week picker defaulting to the **Monday of the current week**, with prev / next / "This week" navigation. Day labels follow the workspace date format (`getDateLocale`).
- Seven day-type selectors. Defaults: Mon–Fri = `defaults.defaultDayType`, Sat–Sun = `free`.
- A `work ends` time input appears only for day types whose template references `workEnd` (prefilled `16:00`).
- **Live, debounced preview** (300 ms): per-day block counts, coverage badges (green `ok` / amber `warning` with `actual/minPerWeek`), and a red conflict list.
- **Apply to week** is disabled while previewing, when there are conflicts, or when there are no blocks — so apply always matches what's shown. On success it toasts created/replaced counts; the board updates via the todo-event broadcast.

## API

All POST under `/api/todos/` (`server-routes/todos-routes.ts`), exposed via `useTodosAPI`:

- `timeblocking/config` → `getTimeblockingConfig()` — read-only, returns `ensureTimeblockingConfig()` (used by the dialog to seed defaults and detect workEnd-dependent day types).
- `timeblocking/preview` → `previewTimeblocking({ weekStart, days })`.
- `timeblocking/apply` → `applyTimeblocking({ weekStart, days })` — broadcasts todo upsert/delete events to live clients.

## Related

- **BPagent `/timeblocking` skill** — agent-driven entry point to the same API (see `bpagent.md`).
- **Task planner** (`task-planner.ts`, `/api/todos/task-planner/{preview,apply}`) lives in this module but is a **separate** mechanism: it schedules *existing* actionable todos onto days (`day_only` / `exact_time`), used by the `weekly-reviewer` for task-first scheduling. It does not generate template blocks.
- **Apple Calendar** — generated events sync like any other scheduled todo (`apple-calendar-integration.md`).

## Files

- `features/timeblocking/types.ts` — Zod schemas + types (`TimeblockingConfig`, `DayConfig`, `GeneratedTimeblock`, `TimeblockingConflict`, `CoverageResult`).
- `features/timeblocking/config.ts` — load/save/ensure config + default config.
- `features/timeblocking/generate.ts` — `generateTimeblocks`, start-expression resolution.
- `features/timeblocking/validate.ts` — `checkCoverage`, `validateGeneratedTimeblocks`.
- `features/timeblocking/service.ts` — `previewTimeblockingPlan`, `applyTimeblockingPlan`.
- `features/timeblocking/TimeblockingDialog.tsx` — the "Plan Week" UI.
- `server-routes/todos-routes.ts` — `timeblocking/{config,preview,apply}` routes.
