# Todo Kind & Source

Todos now carry an explicit `kind` and `source` field that distinguishes tasks from events and tracks how an item was created. Previously this distinction was inferred from tags (`timeblock`), which was fragile and implicit.

## Model

```typescript
// todo-types.ts
kind: z.enum(["task", "event"])      // required, default "task"
source: z.enum(["user", "timeblock-generator"])  // required, default "user"
```

| kind | Meaning |
|------|---------|
| `task` | Actionable work item. Has full lifecycle: todo → in_progress → done. Counts toward completion stats. |
| `event` | Calendar occurrence. Status is always `todo` (active) or archived. Cannot be completed. |

| source | Meaning |
|--------|---------|
| `user` | Created manually by the user or by an agent on behalf of the user. |
| `timeblock-generator` | Created automatically by the timeblocking engine. |

## Lifecycle rules

- **Events cannot be completed.** Status must stay `todo`. Attempting to set status to `done`, `in_progress`, or `later` on an event is rejected by the API with a 400 error.
- **Events cannot have `completedAt`.** The field is only set for tasks transitioning to `done`.
- **Switching kind from task to event** resets status to `todo` and clears `dueDate` and `priority` (handled by `applyTodoKindToDraft` in create/edit UI).
- **Switching kind from event to task** is allowed without restrictions.

## Shared helpers — `todo-kind-utils.ts`

Single source of truth for kind/source logic, used by both UI and backend:

```typescript
getTodoKind(todo)        // → "task" | "event", defaults to "task"
getTodoSource(todo)      // → "user" | "timeblock-generator", defaults to "user"
isEventTodo(todo)        // kind === "event"
isTaskTodo(todo)         // kind === "task"
isTimeblockTodo(todo)    // event + (source === "timeblock-generator" OR legacy tag)
applyTodoKindToDraft(draft, kind)  // applies kind switch with field cleanup
getTodoKindLabel(kind)   // "Task" | "Event" display label
```

`isTimeblockTodo` includes a legacy fallback: items with `tags: ["timeblock"]` are still recognized as timeblocks even if they still carry legacy `kind/source` values. This will be removed once all legacy data has been migrated.

## API

### Create

```typescript
POST /api/todos/create
{
  title: "Team standup",
  kind: "event",           // optional, defaults to "task"
  source: "user",          // optional, defaults to "user"
  scheduledStart: "2026-04-07T09:00",
  scheduledEnd: "2026-04-07T09:15"
}
```

Creating an event with `status: "done"` is rejected.

### Update

```typescript
POST /api/todos/update
{
  todoId: "todo-team-standup-...",
  updates: {
    kind: "event"          // optional — only set if explicitly changing kind
  }
}
```

Updating an event's status to anything other than `todo` is rejected.

### List filtering

```typescript
POST /api/todos/list
{
  kind: "task",                    // single kind filter
  kinds: ["task", "event"],        // multi-kind filter (OR)
  source: "user",                  // single source filter
  sources: ["user", "timeblock-generator"] // multi-source filter (OR)
}
```

Both `kind`/`kinds` and `source`/`sources` can be combined. When neither is provided, all values are returned.

## Migration

Two one-off startup migrations handle the rollout:

### v4 — add `kind` / `source`

Marker: `{workspace}/.nomendex/migrations/todos-kind-source-v4.done`

1. For each todo missing `kind`/`source` fields:
   - If `tags` includes `"timeblock"` → `kind: "event"`, `source: "user"` (conservative — does not assume generator provenance for legacy items)
   - Otherwise → `kind: "task"`, `source: "user"`

### v5 — canonicalize legacy timeblocks

Marker: `{workspace}/.nomendex/migrations/todos-timeblock-backfill-v5.done`

1. For each todo whose `tags` include `"timeblock"`:
   - Set `kind: "event"`
   - Set `source: "timeblock-generator"`
   - Normalize `status` back to `todo`
   - Clear `completedAt` if it was present

The sanitize layer (`todo-sanitize.ts`) still defaults missing `kind`/`source` to `"task"`/`"user"` at read time, so pre-migration data is safe to display, but the real data fix happens in startup migrations.

## UI

### KindPicker

A segmented toggle (`pickers/KindPicker.tsx`) in create and edit dialogs. Switching to Event:
- Resets status to `todo`
- Clears deadline (`dueDate`) and priority
- Hides completion checkbox in TodoCard

### Statistics and filters

- `needsAttention()` only considers tasks (`isTaskTodo`)
- Completion counts and progress bars only count tasks
- Events remain visible in lists but are excluded from task math
- Project detail view shows a separate events section

## Timeblocking integration

- The weekly timeblocking generator now creates todos as `kind: "event"` and `source: "timeblock-generator"`.
- Newly generated timeblocks no longer rely on the `timeblock` tag to be recognized.
- Timeblocking preview/apply and calendar incoming sync now use `kind/source` semantics. The legacy `timeblock` tag remains only as a fallback for older data that has not yet been cleaned up past `v5`.

## Files

| File | Role |
|------|------|
| `todo-types.ts` | Zod schemas for `TodoKindSchema`, `TodoSourceSchema` |
| `todo-kind-utils.ts` | Shared kind/source helpers (UI + backend) |
| `todo-sanitize.ts` | Read-time normalization with defaults |
| `fx.ts` | Backend lifecycle guards, migration, API handlers |
| `pickers/KindPicker.tsx` | UI toggle component |
| `index.ts` | API schemas with kind/kinds filters |
| `todos-routes.ts` | Route-level Zod validation |
| `useTodosAPI.ts` | Client API types |
