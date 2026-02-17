# Task Priority Levels

Tasks support four priority levels with visual indicators and filtering.

## Overview

Each task can be assigned a priority level that affects its visual appearance on Kanban cards and can be used for filtering. Priorities are optional — tasks default to no priority.

## Priority Levels

| Priority | Color | Hex | Alarm (Calendar) |
|----------|-------|-----|-------------------|
| High | 🔴 Red | `#ef4444` | 15 min before |
| Medium | 🟡 Amber | `#f59e0b` | 30 min before |
| Low | 🔵 Blue | `#3b82f6` | — |
| None | — | No border | — |

## Data

Stored in task YAML frontmatter:

```yaml
priority: high | medium | low | none
```

### Schema

```typescript
// todo-types.ts
priority: z.enum(["high", "medium", "low", "none"]).optional()
```

## Visual Indicators

### Card Border

`TodoCard` renders a colored left border (`3px solid`) based on the task's priority:

```typescript
const priorityColors: Record<string, string> = {
    high: "#ef4444",
    medium: "#f59e0b",
    low: "#3b82f6",
};
```

Tasks with `priority: "none"` or no priority have no colored border.

### Editor UI

A **Flag icon** (🚩) button in the `TaskCardEditor` footer opens a popover with four selectable options. The icon color reflects the current priority and updates dynamically when changed.

The priority popover uses the same `Popover` / `PopoverContent` pattern as other editor controls (status, project).

## Filtering

A **Priority Filter** pill in the Kanban toolbar allows filtering the board by a single priority. The filter appears alongside the existing `TagFilter`.

### Component

```typescript
// PriorityFilter.tsx
interface PriorityFilterProps {
    selectedPriority: Priority | null;
    onPriorityChange: (priority: Priority | null) => void;
}
```

**Behavior:**
- Click "Priority" label → opens popover with all four options
- Select a priority → filters board, shows active priority with color + flag icon
- Click ✕ → clears filter
- Click active priority again → toggles off (same as clear)

## API

Both `createTodo` and `updateTodo` accept an optional `priority` field:

```typescript
// createTodo input
priority?: "high" | "medium" | "low" | "none"

// updateTodo input
updates: {
    priority?: "high" | "medium" | "low" | "none"
}
```

## File Structure

```
bun-sidecar/src/features/todos/
├── todo-types.ts        # priority field in TodoSchema
├── PriorityFilter.tsx   # Filter component (new)
├── TodoCard.tsx          # Colored left border
├── TaskCardEditor.tsx   # Flag icon + priority popover
├── browser-view.tsx     # Integrates PriorityFilter in toolbar
├── index.ts             # Updated function stubs
└── fx.ts                # priority in create/update logic

bun-sidecar/src/hooks/
└── useTodosAPI.ts       # priority in CreateTodoInput/UpdateTodoInput
```
