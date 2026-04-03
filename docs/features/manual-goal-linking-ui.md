# Manual Goal Linking UI (Projects + Todos)

## Context

The backend already supports typed goal linkage:

- `ProjectConfig.goalRef` (single goal ID)
- `Todo.goalRefs` (explicit user override)
- `Todo.resolvedGoalRefs` (computed linkage used for reporting)

Today this is mostly agent/API-driven. End users cannot reliably set or edit these links in the UI.

This proposal adds full manual UI support while preserving existing typed-goal semantics.

---

## Product Goals

1. Let users manually link a project to a goal in Projects UI.
2. Let users manually link a todo to one or more goals at create and edit time.
3. Make inherited vs explicit linkage visible and understandable.
4. Preserve historical integrity (`resolvedGoalRefs` snapshot behavior for closed todos).
5. Keep goal linkage explicit only. No text-based inference.

---

## Non-Goals

- Full Goals management UI (create/edit hierarchy, progress editing, etc.).
- Automatic AI mapping of todos to goals from description text.
- Changes to goal progress computation model.

---

## UX Scope

## 1) Project-level link (default for todos)

Location:

- Project detail view (`projects/detail`)

Behavior:

- New **Goal Link** section with single-select:
  - `No goal` (clears `goalRef`)
  - One active goal ID/title
- Save updates `project.goalRef`.
- On save, show short impact message:
  - Example: "Will recompute linkage for 14 open todos in this project."

Notes:

- Selection is singular by design (matches backend model).
- If `goalRef` changes, open todos in that project are recomputed (already implemented server-side).

## 2) Todo-level link (manual override)

Locations:

- Create Todo dialog
- TaskCardEditor dialog
- Todo detail view
- Command create dialog

Behavior model (explicit and understandable):

- `Inherit from project` (default when todo has no explicit override)
- `Override` (user selects one or more goals into `goalRefs`)
- `No goal` (explicitly set `goalRefs: []`, disables inheritance)

Recommended copy in UI:

- "Inherit from project goal"
- "Override goal link"
- "No goal link"

Closed todo rule:

- If todo is closed (`done` or `archived`) and remains closed, goal-link editor is disabled with explanation:
  - "Goal link is frozen after completion/archive for historical reporting."

## 3) Visibility in cards/details

- Todo detail should show:
  - Explicit mode: `Inherit` / `Override` / `No goal`
  - Resolved links (read-only chips from `resolvedGoalRefs`)
- Todo card (kanban/list) can show compact badge:
  - First linked goal title + `+N` for additional refs

---

## Data & Semantics Contract

The UI must respect these exact semantics:

- `goalRefs === undefined` -> inherit from `project.goalRef`
- `goalRefs === []` -> explicit no-goal
- `goalRefs === ["goal-a", ...]` -> explicit override

Resolved linkage:

- Open todos: recompute on updates.
- Closing transition (`open -> done/archived`): snapshot is frozen.
- Closed and staying closed: do not recompute.

This means UI mode must map directly to wire payload:

- Inherit: omit `goalRefs` (or send `undefined`)
- No goal: send empty array
- Override: send selected IDs

---

## Backend Changes

## A) Validate goal references

Files:

- `bun-sidecar/src/features/projects/fx.ts`
- `bun-sidecar/src/features/todos/fx.ts`

Changes:

- Add server-side existence validation for incoming goal IDs:
  - `project.updates.goalRef`
  - `todo.goalRefs` / `todo.updates.goalRefs`
- Return clear `400` message for unknown goal IDs.

Why:

- Prevent dangling references from UI/API clients.

## B) Closed todo guard

File:

- `bun-sidecar/src/features/todos/fx.ts`

Changes:

- If todo is already closed and remains closed, reject `updates.goalRefs` mutation (or ignore with explicit warning response).
- Recommended: reject with `409` and clear message.

Why:

- Prevent mismatch between frozen `resolvedGoalRefs` and editable `goalRefs`.

## C) Archive/unarchive path consistency

File:

- `bun-sidecar/src/features/todos/fx.ts`

Changes:

- Refactor `archiveTodo` / `unarchiveTodo` to route through `updateTodo` logic.
- Ensures freeze/recompute behavior stays consistent in all state transitions.

## D) Optional sync side effects

Files:

- `bun-sidecar/src/features/projects/fx.ts`

Changes:

- After `goalRef` changes, optionally trigger:
  - `/api/goals/sync/project`
  - `/api/goals/sync/dashboards`

Can be async/fire-and-forget if latency is a concern.

---

## Frontend/API Layer Changes

## A) API hooks and typings

Files:

- `bun-sidecar/src/hooks/useTodosAPI.ts`
- `bun-sidecar/src/hooks/useProjectsAPI.ts`
- `bun-sidecar/src/features/todos/index.ts`

Changes:

- Add `goalRefs?: string[]` to todo create/update payload types.
- Add `goalRef?: string` to project update payload type.
- Include these fields in plugin function stubs (type parity).

## B) Goals API hook for UI

New file:

- `bun-sidecar/src/hooks/useGoalsAPI.ts`

Methods (minimum):

- `listGoals({ status?: string; horizon?: string })`
- `getGoal({ goalId })` (optional for detail labels)

## C) Picker components

New file:

- `bun-sidecar/src/features/todos/pickers/GoalPicker.tsx`

Behavior:

- Searchable popover list
- Multi-select mode (todos override)
- Single-select mode (project goal)
- Supports "None" option

Update exports:

- `bun-sidecar/src/features/todos/pickers/index.ts`

## D) Wire payload propagation

Files:

- `bun-sidecar/src/features/todos/CreateTodoDialog.tsx`
- `bun-sidecar/src/features/todos/TaskCardEditor.tsx`
- `bun-sidecar/src/features/todos/view.tsx`
- `bun-sidecar/src/features/todos/browser-view.tsx`
- `bun-sidecar/src/features/todos/CreateTodoCommandDialog.tsx`
- `bun-sidecar/src/features/projects/project-detail-view.tsx`

Changes:

- Add UI state for goal-link mode + selected goal IDs.
- Map UI mode to payload semantics (`undefined` vs `[]` vs `["id"]`).
- In Project detail, add save action for `goalRef`.

## E) Schema parity cleanup (important)

Files:

- `bun-sidecar/src/features/projects/project-types.ts`
- `bun-sidecar/src/features/projects/projects-types.ts`

Issue:

- There are two project schema files in repository; only one currently contains `goalRef`.

Proposal:

- Add `goalRef?: string` to `projects-types.ts` as well, or deprecate this duplicate model.
- Ensure migrations/services using `projects-types.ts` do not strip `goalRef` silently.

---

## Testing Plan

## Unit tests

Files:

- `bun-sidecar/src/features/todos/fx.ts` tests (new)
- `bun-sidecar/src/features/projects/fx.ts` tests (new)

Cases:

- `goalRefs` semantics: `undefined`, `[]`, non-empty.
- Closed todo guard (cannot mutate goal link while closed).
- Transition behaviors:
  - open -> done freezes
  - done -> open recomputes
  - archive/unarchive uses consistent recompute path.
- Unknown goal ID validation.

## Integration tests

Cases:

- Updating `project.goalRef` recomputes open todos in project.
- Closed todos stay frozen after project goal change.
- Todo override with multiple goals persists and reports correctly.

## UI tests (component/e2e)

Cases:

- Create todo with each mode (inherit, override, no-goal).
- Edit todo and switch modes.
- Closed todo shows disabled editor state.
- Project goal change updates linked open todos on refresh.

---

## Rollout Strategy

1. Ship backend validation + transition fixes first (safe foundation).
2. Ship UI behind feature flag (`manualGoalLinkingUI`).
3. Dogfood in one workspace for 1 week.
4. Enable globally.

Backfill:

- Optionally run `/api/todos/recompute-goal-refs` once post-release for open todos.

---

## Acceptance Criteria

1. User can set and clear `project.goalRef` from UI.
2. User can set todo linkage at create/edit from UI.
3. Inherit/override/no-goal states are explicit and persisted correctly.
4. Closed todo linkage cannot be changed in a way that breaks frozen snapshots.
5. Goal-linked reporting still reads only `resolvedGoalRefs`.
6. No regressions in existing todo/project create/update flows.

---

## Suggested Implementation Slices (Tickets)

1. API typing parity (`useTodosAPI`, `useProjectsAPI`, function stubs).
2. Goals hook + shared goal option mapping util.
3. Project goal link UI in `project-detail-view`.
4. Todo create/edit UI mode + `GoalPicker`.
5. Backend validation + closed-todo guard.
6. Archive/unarchive recompute path refactor.
7. Tests (unit + integration + UI).
8. Feature flag + rollout + docs update.
