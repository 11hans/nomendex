# Completion Timestamp (`completedAt`)

Automatic timestamp recording when a task is marked as done.

## Overview

When a task's status changes to `"done"`, the backend automatically records the exact completion time. This timestamp is cleared if the task moves back to any other status. No UI interaction is needed — it's fully managed server-side.

## Behavior

| Event | Action |
|-------|--------|
| Status → `"done"` | `completedAt = new Date().toISOString()` |
| Status away from `"done"` | `completedAt = undefined` |
| Created with `status: "done"` | `completedAt` set to creation time |

The logic lives in `fx.ts` inside both `createTodo()` and `updateTodo()`:

```typescript
// createTodo
completedAt: status === "done" ? now : undefined,

// updateTodo — when status changes
if (input.updates.status === "done") {
    updates.completedAt = new Date().toISOString();
} else if (currentTodo.status === "done") {
    updates.completedAt = undefined;
}
```

## Data

Stored in task YAML frontmatter:

```yaml
completedAt: "2026-02-16T17:15:30.000Z"
```

### Schema

```typescript
// todo-types.ts
completedAt: z.string().optional()
```

## Use Cases

- **Productivity tracking** — tasks completed per day/week
- **Filtering by completion date** — future feature
- **Analytics and reporting** — completion velocity, average task lifetime

## File Structure

```
bun-sidecar/src/features/todos/
├── todo-types.ts   # completedAt field in TodoSchema
└── fx.ts           # Auto-set/clear logic in createTodo() and updateTodo()
```
