# Start Date & Time Range

Tasks support both a start date/time and a due date/time, enabling time range display for scheduled tasks.

## Overview

Previously tasks only had a `dueDate` (date only). Now tasks support:
- **Start date/time** — when the task begins
- **Due date/time** — when the task is due (deadline)
- **Duration** — length in minutes (default 60, reserved for future use)

Both dates support an optional time component for scheduling within a day.

## Date Format

Combined ISO string format, backwards compatible with existing date-only values:

| Type | Format | Example |
|------|--------|---------|
| Date only (all-day) | `YYYY-MM-DD` | `2026-02-16` |
| Date + time | `YYYY-MM-DDThh:mm` | `2026-02-16T14:00` |

Time detection is based on the presence of `T` in the string:

```typescript
const hasTime = dateString.includes('T');
```

## Data

Stored in task YAML frontmatter:

```yaml
startDate: "2026-02-16T14:00"
dueDate: "2026-02-16T15:00"
duration: 60  # minutes, default 60
```

### Schema

```typescript
// todo-types.ts
startDate: z.string().optional()
dueDate: z.string().optional()
duration: z.number().optional()
```

## Editor UI

Two date/time pickers in the `TaskCardEditor` footer:

1. **📅 Due Date** (calendar icon) — deadline / end time
2. **→ Start Date** (arrow icon) — start time

Each opens a popover containing:
- Calendar date picker (day selection)
- Optional `<input type="time">` for selecting hours and minutes

Setting a time converts the date from `YYYY-MM-DD` to `YYYY-MM-DDThh:mm`. Clearing the time reverts to date-only format.

## Card Display

`TodoCard` renders time information intelligently based on available data:

| Scenario | Display | Example |
|----------|---------|---------|
| Date only | `MMM DD` | `Feb 16` |
| Due time only | `MMM DD HH:MM` | `Feb 16 14:00` |
| Start + Due time | `MMM DD HH:MM–HH:MM` | `Feb 16 14:00–15:00` |

```typescript
// TodoCard.tsx — time range rendering
const startTime = todo.startDate?.includes('T') ? todo.startDate.split('T')[1] : null;
const dueTime = todo.dueDate.includes('T') ? todo.dueDate.split('T')[1] : null;
if (startTime && dueTime) return ` ${startTime}–${dueTime}`;
if (dueTime) return ` ${dueTime}`;
```

## API

Both `createTodo` and `updateTodo` accept `startDate` and `duration`:

```typescript
// createTodo input
startDate?: string    // ISO date or datetime
duration?: number     // minutes

// updateTodo input
updates: {
    startDate?: string
    duration?: number
    dueDate?: string  // existing field, now supports time
}
```

## Clearing Date & Time

Clicking the **X** button next to the date pill clears both `dueDate` and `startDate`. The editor sets them to `undefined`, and the save handler converts to explicit `null` before sending to the API (since `JSON.stringify` drops `undefined` keys). The storage layer then strips `null` fields from the YAML file.

## File Structure

```
bun-sidecar/src/features/todos/
├── todo-types.ts        # startDate, duration fields in TodoSchema
├── TaskCardEditor.tsx   # Time picker in Due Date popover + Start Date pill
├── TodoCard.tsx          # Time range display logic
├── browser-view.tsx     # Fields included in handleSaveTodo
├── index.ts             # Updated function stubs
└── fx.ts                # startDate, duration in create/update

bun-sidecar/src/hooks/
└── useTodosAPI.ts       # startDate, duration in API types
```
