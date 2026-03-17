# Start Date & Time Range

Tasks now distinguish schedule (calendar/today) information from deadlines. The UI, API, and native integrations all look at `scheduledStart`/`scheduledEnd` to understand when an event happens, while `dueDate` is reserved for the deadline that drives overdue highlighting and deadline reminders.

## Overview

Previously there was a single `dueDate` field (and the optional `startDate` extension), which conflated schedule and deadline semantics. The current model separates those ideas:

- **`scheduledStart`** — when the task is scheduled to start (date or datetime, in local time). This is the value that calendars, today views, and schedule buckets examine first.
- **`scheduledEnd`** — optional end point for multi-day ranges or time windows. When present, calendar events span from `scheduledStart` to `scheduledEnd`.
- **`dueDate`** — the deadline. This field still supports dates and datetimes, but it no longer drives the schedule view. Use it for overdue detection, deadline badges, and `TodoCard`’s deadline display.
- **`duration`** — length in minutes (defaults to 60). It is still used when a native calendar event needs a fallback end time and (`scheduledEnd` is missing).

## Date Format

All dates still use local ISO strings:

| Type | Format | Example |
|------|--------|---------|
| Date only (all-day) | `YYYY-MM-DD` | `2026-02-16` |
| Date + time | `YYYY-MM-DDThh:mm` | `2026-02-16T14:00` |

Time detection still relies on the presence of `T`.

## Data

```yaml
scheduledStart: "2026-02-16T14:00"
scheduledEnd: "2026-02-16T15:00"
dueDate: "2026-02-16T16:00"
duration: 60
```

Legacy YAML may still contain `startDate`; startup migration removes it and rehydrates `scheduledStart`/`scheduledEnd`.

## Schema

```typescript
// todo-types.ts
scheduledStart: z.string().optional()
scheduledEnd: z.string().optional()
dueDate: z.string().optional()
duration: z.number().optional()
```

## Editor UI

The editor now shows two separate pickers in the footer:

1. **Scheduled Range (`ScheduledDateTimePicker`)** — This range picker edits `scheduledStart`/`scheduledEnd`. It handles single-day or multi-day spans, optional times, and writing those fields independently of the deadline.
2. **Deadline (`DateTimePicker`)** — This picker edits `dueDate` only. It shows due-time input, overdue coloring, and the compact pill for inline editing. Clearing this control removes the deadline without touching the scheduled range.

The separation keeps schedule edits (calendar/today) and deadline edits orthogonal, so inline updates, dialogs, and integrations don’t accidentally mix the two concerns.

## Card Display

`TodoCard` now uses `scheduledStart`/`scheduledEnd` to show the task’s scheduled window. When both fields are present, it renders the range; when only `scheduledStart` exists it shows the single date/time.

Deadline information still comes from `dueDate`. Overdue coloring, inline date pills, and `TodoCard`’s overdue badge only respond to `dueDate`, so scheduled changes don’t ring the overdue alarm unless the deadline moves.

## API

Both `createTodo` and `updateTodo` now accept:

```typescript
scheduledStart?: string | null
scheduledEnd?: string | null
dueDate?: string | null
duration?: number | null
```

### Duration vs Scheduled End

- If `scheduledEnd` is present, it is authoritative for the event end. `duration` is derived from `scheduledStart -> scheduledEnd` when possible.
- If only `scheduledStart` is present, `duration` is used by native calendar sync as the fallback to compute end time (`start + duration`, default 60).
- This prevents conflicting data like `scheduledEnd = 15:00` together with `duration = 120`.

## Clearing Date & Time

The schedule picker clears `scheduledStart`/`scheduledEnd`; the deadline picker clears `dueDate`. Clearing one does not affect the other, so you can remove a deadline while keeping the event scheduled, or vice versa.

## File Structure

```
bun-sidecar/src/features/todos/
├── todo-types.ts            # scheduledStart/scheduledEnd/dueDate schema
├── TaskCardEditor.tsx       # Two pickers: schedule + deadline
├── TodoCard.tsx             # Displays schedule from scheduled* , overdue state from dueDate
├── ScheduledDateTimePicker.tsx # Range picker for writing scheduled* fields
├── DateTimePicker.tsx       # Deadline-only picker that changes dueDate
├── browser-view.tsx         # Sends scheduled* + dueDate, respects new semantics
└── fx.ts                    # create/update handle scheduled* + dueDate

bun-sidecar/src/hooks/
└── useTodosAPI.ts           # Input types for scheduled* / dueDate
```
