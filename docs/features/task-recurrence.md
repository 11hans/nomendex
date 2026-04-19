# Task Recurrence

**Status:** Implemented  
**Added in:** `9cffeff`  
**Affects:** Users, Developers

## Overview

Task Recurrence lets you mark a top-level todo as repeating. When you complete a recurring task, Nomendex automatically creates the next occurrence with the same title, description, and scheduling offsets. The original completed task is archived; the new instance appears in the active todo list.

Recurrence is a top-level-only feature — subtasks cannot recur.

## Use Cases

- Weekly team sync prep that resets every Monday
- Monthly invoice review due on the 31st (handled correctly even in short months)
- Daily standup notes or habit tracking
- Custom intervals: every 2 weeks, every 3 months

## How It Works

### Schema

```typescript
// bun-sidecar/src/features/todos/todo-types.ts
export const RecurrenceSchema = z.object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(99).default(1),
    // Canonical day-of-month for monthly recurrence (see originDay below)
    originDay: z.number().int().min(1).max(31).optional(),
});
```

The `recurrence` field sits directly on the `Todo` object. Each spawned instance carries the same `recurrence` value, so the chain continues indefinitely.

### Spawn Logic

When a recurring todo is marked `done`, `spawnRecurringInstance()` in `fx.ts`:

1. Determines the **anchor date** — `dueDate` takes priority over `scheduledStart`, falling back to today.
2. Calls `advanceAnchorPastNow()` to skip past any already-overdue dates (prevents spawning still-overdue tasks after a long absence).
3. Copies the parent todo's fields to the new instance, replacing the dates with the computed next occurrence.
4. Preserves the `recurrence` object (including `originDay`) on the new instance.

### `originDay` — Monthly Drift Prevention

Monthly recurrence without a canonical origin day suffers from drift: a task originally due Jan 31 completes in February, spawning a Feb 28 instance, which completes in March as a Mar 28 instance — permanently shifted.

`originDay` records the original day-of-month (e.g. `31`) the first time a monthly task is completed. Subsequent spawns target that day, clamping to the last valid day of the month:

```
Jan 31 → Feb 28 (clamped) → Mar 31 → Apr 30 → ...
```

`originDay` is set automatically on the first completion if it is absent.

### Date Field Propagation

| Source todo has | Next instance gets |
|----------------|-------------------|
| `scheduledStart` only | `scheduledStart` advanced by recurrence, duration preserved |
| `dueDate` | `dueDate` advanced, `scheduledStart`/`scheduledEnd` preserved as-is |
| Neither | `dueDate` set to next occurrence |

### Display

`formatRecurrence()` produces human-readable strings:

| Config | Output |
|--------|--------|
| `{ frequency: "daily", interval: 1 }` | `Daily` |
| `{ frequency: "weekly", interval: 1 }` | `Weekly` |
| `{ frequency: "monthly", interval: 1 }` | `Monthly` |
| `{ frequency: "daily", interval: 3 }` | `Every 3 days` |
| `{ frequency: "weekly", interval: 2 }` | `Every 2 weeks` |

The Repeat icon in the `TaskCardEditor` toolbar is highlighted (accent colour) when recurrence is active, and shows the formatted string next to the icon.

## User Guide

### Setting Recurrence

1. Open a top-level task in `TaskCardEditor`.
2. Click the **Repeat** (↻) icon in the toolbar (hidden for subtasks and events).
3. Choose a frequency: **Daily**, **Weekly**, or **Monthly**.
4. Optionally adjust the interval with the **−** / **+** buttons (1–99).
5. Click outside to close the popover. The icon turns accent-coloured.

### Removing Recurrence

Open the Repeat popover and click **Remove recurrence** at the bottom, or click the currently-selected frequency to deselect it.

### Completing a Recurring Task

Mark the task as done via checkbox or status menu. The completed task is archived and the next occurrence appears in the list with updated dates.

If you were overdue by multiple periods, the next occurrence is scheduled for the first future date (not the very next period).

## Developer Guide

### API

Recurrence is included in the standard `createTodo` and `updateTodo` calls:

```typescript
// Set recurrence on create
await api.createTodo({
    title: "Weekly sync prep",
    dueDate: "2026-04-21",
    recurrence: { frequency: "weekly", interval: 1 },
});

// Remove recurrence via update
await api.updateTodo({
    todoId: "todo-123",
    updates: { recurrence: null },  // null clears it
});
```

`null` is a valid update value for `recurrence` (listed in `UPDATE_NULLABLE_KEYS`).

### Key Files

| File | Role |
|------|------|
| `bun-sidecar/src/features/todos/todo-types.ts` | `RecurrenceSchema`, `formatRecurrence()` |
| `bun-sidecar/src/features/todos/fx.ts` | `spawnRecurringInstance()`, `computeNextOccurrenceDate()`, `advanceAnchorPastNow()` |
| `bun-sidecar/src/features/todos/pickers/RecurrencePicker.tsx` | Popover UI for frequency + interval |
| `bun-sidecar/src/features/todos/TaskCardEditor.tsx` | Embeds `RecurrencePicker` in toolbar |

### Constraints

- Recurrence is **top-level only** — silently dropped when `parentTodoId` is set.
- `interval` range: 1–99.
- Supported frequencies: `daily`, `weekly`, `monthly`. No custom weekday patterns (e.g. "every Monday").
- The advance-past-now loop is bounded to 1000 iterations as a safety guard.

## Troubleshooting

**No new task appeared after completing a recurring todo** — Check that `recurrence` was set on the todo (not just visually). Run `api.getTodoById({ todoId })` and inspect the `recurrence` field.

**Monthly task is landing on the wrong day** — `originDay` should be set automatically after the first completion. If the chain started without it, you can patch it via `updateTodo` or by editing the JSON file directly in `{workspace}/todos/<id>.json`.

**Task keeps spawning in the past** — Occurs if the system clock was wrong when the task completed, or the anchor date was far in the past. The `advanceAnchorPastNow` guard should skip past overdue dates; if not, manually update `dueDate` on the spawned instance.

## Related Features

- [Subtasks](subtasks.md) — recurrence not available on subtasks
- [Daily Notes](daily-note-improvements.md) — daily skill integrates recurring tasks for daily review
