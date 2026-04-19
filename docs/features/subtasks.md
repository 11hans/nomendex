# Subtasks

**Status:** Implemented  
**Added in:** `4b25d83`  
**Affects:** Users, Developers

## Overview

Subtasks let you break a top-level todo into smaller, trackable steps. Each subtask is a full Todo record linked to its parent via `parentTodoId`. The hierarchy is intentionally limited to **one level** — you cannot create a subtask of a subtask.

When a parent todo has subtasks, the kanban card shows a progress bar (`done / total`) instead of the description checklist. Subtasks are archived, unarchived, and cascade-deleted together with their parent.

## Use Cases

- Breaking a large task into ordered steps ("Write tests", "Review PR", "Deploy")
- Tracking parallel workstreams under a single project card
- Delegating parts of a task while keeping the parent as the single card on the board

## How It Works

### Data Model

Subtasks are stored as ordinary `Todo` records with `parentTodoId` set:

```typescript
// bun-sidecar/src/features/todos/todo-types.ts
parentTodoId: z.string().optional(), // set on subtasks; absent on top-level todos
```

Key invariants enforced by the server:

| Rule | Detail |
|------|--------|
| Max depth | 1 — a subtask cannot itself have subtasks |
| Project | Always inherited from parent; cannot be changed directly |
| Status | Only `todo` or `done` allowed (no `in-progress`, `blocked`, etc.) |
| Recurrence | Not supported on subtasks (silently dropped) |

### Cascade Behaviour

| Parent action | Effect on subtasks |
|---------------|-------------------|
| Delete | All subtasks deleted first |
| Archive | All subtasks archived |
| Unarchive | All subtasks unarchived |
| Change project | Subtask project synced to new parent project |

### Progress Bar

`TodoCard` receives a pre-computed `subtaskProgress: { done, total }` prop. When `total > 0`, the card renders a progress bar and `done/total` counter instead of the description checklist.

### Filtering

`getTodos` excludes subtasks by default. Callers opt in with query params:

| Param | Behaviour |
|-------|-----------|
| `parentTodoId: <id>` | Return only subtasks of that parent |
| `includeSubtasks: true` | Include all todos regardless of depth |
| `subtasksOnly: true` | Return only todos that have a parent |

## User Guide

### Adding a Subtask

1. Open a top-level task card (click to expand `TaskCardEditor`).
2. Click the **+** (ListPlus) icon in the card footer, or press **Enter** in the subtask input field.
3. Type the subtask title and press **Enter** to save, **Escape** to cancel.

### Completing a Subtask

Click the checkbox next to a subtask. This toggles `status` between `todo` and `done`. The progress bar on the parent card updates immediately.

### Editing a Subtask

Click a subtask title to open its own `TaskCardEditor`. The editor shows an "Edit Subtask" header and hides controls that are not available on subtasks (kind selector, recurrence, project).

### Deleting / Archiving

Deleting or archiving the parent automatically removes all its subtasks. There is no way to delete a subtask independently — you can only complete it or delete the parent.

## Developer Guide

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/todos/list` | POST | `{ parentTodoId }` returns subtasks for a parent |
| `/api/todos/create` | POST | `{ parentTodoId, title, ... }` creates a subtask |
| `/api/todos/update` | POST | Update subtask fields (status only `todo`/`done`) |
| `/api/todos/delete` | POST | Deletes subtask; also cascade-deletes from parent |

### Client API

```typescript
// bun-sidecar/src/hooks/useTodosAPI.ts
const api = useTodosAPI();

// Fetch subtasks for a parent
const subtasks = await api.getSubtasks({ parentTodoId: "todo-123" });

// Create a subtask
const subtask = await api.createTodo({
    title: "Write unit tests",
    parentTodoId: "todo-123",
    kind: "task",
    source: "user",
    status: "todo",
});

// Toggle completion
await api.updateTodo({ todoId: subtask.id, updates: { status: "done" } });
```

### MCP Tool (AI agents)

```
create_todo(title="Write unit tests", parentTodoId="todo-123")
```

The MCP description explicitly documents the 1-level depth limit and that project is inherited from the parent.

### Key Files

| File | Role |
|------|------|
| `bun-sidecar/src/features/todos/todo-types.ts` | `parentTodoId` field in `TodoSchema` |
| `bun-sidecar/src/features/todos/fx.ts` | Validation, cascade delete/archive, project sync |
| `bun-sidecar/src/features/todos/TaskCardEditor.tsx` | Subtask list UI, add/toggle handlers |
| `bun-sidecar/src/features/todos/TodoCard.tsx` | Progress bar rendering |
| `bun-sidecar/src/hooks/useTodosAPI.ts` | `getSubtasks`, `createTodo` with `parentTodoId` |

## Troubleshooting

**"Cannot create a subtask of a subtask"** — The target `parentTodoId` is itself a subtask. Fetch the grandparent and use its ID instead.

**"Cannot change the project of a subtask directly"** — Change the parent todo's project. The subtask project syncs automatically.

**Subtask status rejected** — Subtasks only accept `todo` or `done`. Other status values (e.g. `in-progress`) are rejected at the API level.

**Subtask disappeared after parent deletion** — Expected behaviour. Subtasks cascade-delete with their parent.

## Related Features

- [Task Recurrence](task-recurrence.md) — not available on subtasks
- [Custom Kanban Boards](custom-kanban.md) — subtasks shown as progress bar on parent card
