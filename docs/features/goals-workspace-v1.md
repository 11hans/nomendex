# Goals Workspace V1 (Browser + Detail + Inline Editing)

This document describes the first-class Goals workspace UI implemented in the existing plugin architecture.

Scope of this version:
- Goals is now a top-level workspace view in sidebar navigation
- `Goals Browser` + `Goal Detail` with full inline editing
- Browser uses `forest` summary data (no N+1 detail calls)
- Detail provides navigation to Projects, Todos, and mirror note
- Goals can be created, edited, and deleted from the UI without chat

Out of scope for V1:
- review workflow automation (weekly/monthly modes)
- sidebar alert badges

---

## Why Plugin (Not Route)

Goals follows the same architecture as other workspace entities:
- registered in plugin registry
- opened via workspace tabs
- supports browser/detail view model

This keeps one consistent navigation model instead of adding a parallel route-only UI branch.

Implementation files:
- `bun-sidecar/src/features/goals/plugin.ts`
- `bun-sidecar/src/registry/registry.ts`
- `bun-sidecar/src/components/WorkspaceSidebar.tsx`
- `bun-sidecar/src/hooks/useWorkspace.tsx`

---

## Sidebar + Navigation Behavior

Sidebar view order is now explicit for core views:
1. Inbox
2. Goals
3. Projects
4. Todos
5. Notes

Then existing secondary views continue (`Media`, `Tags`, `Memory`), then `Agents`, then `Chat`.

Behavior:
- clicking `Goals` opens `goals/browser`
- no dedicated route was added
- navigation stays inside workspace tabs

`default` and `browser` are treated as equivalent for Goals tab deduplication (same pattern as other browser-like plugins).

---

## Data Flow

### Browser

`Goals Browser` fetches:
- `POST /api/goals/graph/forest`

Frontend contract (`GoalForestNodeView`):
- `goal`
- `children`
- `linkedProjects`
- `linkedProjectCount`
- `linkedTodoCount`
- `openTodoCount`
- `doneTodoCount`
- `computedProgress`

Key point: browser gets lightweight counts in one response, so UI does not call `getGoalGraph()` per row.

### Detail

`Goal Detail` fetches:
- `POST /api/goals/graph` with `{ goalId }`
- optional `POST /api/goals/get` for parent goal label (`parentGoalId`)

Mirror note quick action is enabled only if `mirrorNoteFile` exists and `notes/getNoteMtime` confirms file availability.

---

## Forest Summary Counts (Backend)

Forest node response was extended additively with:
- `linkedProjectCount`
- `linkedTodoCount`
- `openTodoCount`
- `doneTodoCount`

Semantics:
- `linkedTodoCount`: all linked todos for goal (resolved via `getEffectiveGoalRefs(todo, projectGoalRef)` — explicit `goalRefs` or inherited from `project.goalRef`)
- `openTodoCount`: only **task** todos with status in `todo | in_progress | later`
- `doneTodoCount`: only **task** todos with status `done`

Implementation detail:
- backend builds indexed maps (`goalsByParent`, `projectsByGoalId`, `todosByGoalId`)
- counts are computed during tree construction
- existing fields (`goal`, `children`, `linkedProjects`, `computedProgress`) stay unchanged for backward compatibility

Relevant source:
- `bun-sidecar/src/features/goals/fx.ts`

---

## Goals Browser UX

File:
- `bun-sidecar/src/features/goals/goals-browser-view.tsx`
- `bun-sidecar/src/features/goals/create-goal-dialog.tsx`

Structure:
1. Header with `+ new` button (opens Create Goal dialog)
2. Summary strip
   - Active
   - Needs attention
   - Without project
   - Without next action
   - Focus (count of goals with `focus: true`)
3. Attention block
   - union of `without_project`, `without_next_action`, `stale`
4. Filter bar
   - Filter mode: `All | Needs Attention | Without Next Action | Focus | This Quarter`
   - `Hide Completed` toggle — removes completed/dropped goals from list
5. Grouped list
   - grouped by horizon only: `vision`, `yearly`, `quarterly`, `monthly`
   - `area` shown as row metadata (not grouping)

Inline editing in browser:
- **Quick status change**: each row has a clickable status pill with dropdown (Active/Completed/Paused/Dropped)
- Status change triggers forest reload to reflect updated counts/grouping
- **Focus toggle**: star/pin button on each row sets `goal.focus = true/false` (instant save)

Create Goal dialog:
- Fields: title, area, horizon (select), progress mode (select)
- Defaults: horizon=quarterly, progressMode=rollup
- Follows same dialog pattern as `CreateProjectDialog`

Search:
- case-insensitive match over `title` + `area`

Empty states:
- no typed goals
- goals exist but none linked to projects
- goals exist but no open next actions
- filtered view has no matches

---

## Attention Heuristics (Frontend Helper)

Implemented in:
- `bun-sidecar/src/features/goals/goals-view-model.ts`

Reasons:
- `without_project`: `linkedProjectCount === 0` on active goal
- `without_next_action`: `openTodoCount === 0` on active goal
- `stale`: active goal with `updatedAt >= 14 days`
- `nearly_complete`: active goal with progress `80..99`

`Needs attention` summary uses union of:
- `without_project`
- `without_next_action`
- `stale`

(`nearly_complete` is shown as row signal, but not counted in `Needs attention` summary.)

## Filter Modes (`GoalBrowserFilterMode`)

| Mode | Behavior |
|------|----------|
| `all` | All goals (subject to `hideCompleted`) |
| `needs_attention` | Goals with any attention reason (`without_project`, `without_next_action`, `stale`) |
| `without_next_action` | Active goals with `openTodoCount === 0` |
| `focus` | Goals with `goal.focus === true` |
| `this_quarter` | Active quarterly/monthly goals in the current calendar quarter |

`hideCompleted: boolean` is a separate orthogonal toggle applied after the filter mode. When enabled, goals with `status === "completed"` or `"dropped"` are removed from the result.

## Visual Signals

Rows apply visual signals to communicate goal state:

| Signal | Appearance |
|--------|-----------|
| `paused` or `dropped` status | 0.55 opacity |
| Future quarterly milestone (Q not yet started) | Dim + dashed horizon badge (e.g. "Q3", "Q4") |
| Rollup goal where all active children are paused | Shows grey "Paused" label instead of 0% progress |
| `focus: true` | Focus indicator (star/pin) highlighted |
| `nearly_complete` (80–99%) | Progress badge uses accent color |

---

## Goal Detail UX

File:
- `bun-sidecar/src/features/goals/goal-detail-view.tsx`

Sections:
- header (editable title, status dropdown, horizon dropdown, editable area, progress badge)
- parent shortcut (if parent exists)
- description (editable, always visible section)
- progress editor (mode-aware)
- child goals
- linked projects
- linked todos
- quick actions
- delete goal (destructive action at bottom)

Inline editing in detail:
- **Title**: click-to-edit inline text field with confirm/cancel buttons
- **Status**: dropdown pill (Active/Completed/Paused/Dropped) — instant save
- **Horizon**: dropdown pill (Vision/Yearly/Quarterly/Monthly) — instant save
- **Area**: click-to-edit inline text field
- **Description**: click-to-edit multiline textarea, always visible (shows placeholder when empty)
- **Progress**: mode-aware editor
  - `rollup` / `milestone`: read-only computed label
  - `manual`: 0–100 range slider with percentage display
  - `metric`: editable current/target number inputs with computed percentage
- **Delete**: destructive button, navigates back to browser after confirmation

All edits call `goalsAPI.updateGoal()` and update local state optimistically. Errors are shown via `toast.error()`.

Quick actions:
- `Open Project` -> `projects/detail`
- `Open Todo Context` -> `todos/browser` with `{ project?, selectedTodoId }`
  - tab reuse path updates props so selected todo stays in focus intent
- `Open Mirror Note` -> `notes/editor` when mirror reference is valid

Detail empty states:
- no child goals
- no linked projects
- no linked todos
- missing mirror note availability

---

## Hook + Type Layer

API hook extension:
- `bun-sidecar/src/hooks/useGoalsAPI.ts`

Methods:
- `listGoals(...)`
- `getGoal({ goalId })`
- `getGoalForest()`
- `getGoalGraph({ goalId })`
- `createGoal({ title, area, horizon, progressMode, ... })`
- `updateGoal({ goalId, updates })`
- `deleteGoal({ goalId })`

Shared view types:
- `bun-sidecar/src/features/goals/goals-view-types.ts`

Purpose:
- keep browser/detail contracts explicit
- keep JSX focused on rendering (not ad-hoc shape inference)

---

## Testing

Added tests:
- `bun-sidecar/src/features/goals/goal-forest-summary.test.ts`
  - validates project/todo/open/done counts including edge cases
- `bun-sidecar/src/features/goals/goals-view-model.test.ts`
  - attention rules
  - summary aggregation
  - horizon ordering
  - search over title/area
- `bun-sidecar/src/hooks/useWorkspace.browser-equivalence.test.ts`
  - `goals` default/browser dedup behavior

Recommended quick run:
- `bun test src/features/goals/goal-forest-summary.test.ts src/features/goals/goals-view-model.test.ts src/hooks/useWorkspace.browser-equivalence.test.ts`

---

## Known V1 Limits

- `Open Mirror Note` depends on existing mirror file; it does not create one.
- Todo-context focusing depends on browser tab prop update path (works for current integration, but can be tightened further with explicit prop-sync effect in todos browser if needed).
- Progress mode cannot be changed after creation (would require re-shaping the goal record).
- Browser status change reloads full forest; could be optimized to patch local state.
- No batch operations (e.g. archive all completed goals).

