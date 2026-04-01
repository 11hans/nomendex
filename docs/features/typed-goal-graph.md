# Typed Goal Graph

This document describes the Typed Goal Graph architecture — a structured data layer for goals that serves as the source of truth for the goal-project-todo cascade.

## Motivation

Goals were previously stored only as markdown files (`Goals/*.md`) with checkbox lists. This made it impossible to:
- Compute goal progress programmatically
- Track typed relationships between goals, projects, and todos
- Distinguish outcome metrics from task throughput
- Provide the BPagent with structured goal data for planning

The Typed Goal Graph introduces `GoalRecord` as a first-class entity alongside `ProjectConfig` and `Todo`, with explicit typed linkage between all three.

---

## Core Principle

**Structured data = source of truth. Markdown = readable/editable mirror.**

```
GoalRecord store (.nomendex/goals/)     ← source of truth
    ↓ goalRef
ProjectConfig (.nomendex/projects.json)  ← source of truth
    ↓ resolvedGoalRefs
Todos (.nomendex/todos/)                 ← source of truth
    ↓
Daily Note (markdown, narativní)         ← snapshot
Goals/goals/*.md (per-goal mirror)       ← bidirectional sync
Goals/0-2.md (aggregated dashboards)     ← generated-only
Projects/*.md (project mirror)           ← bidirectional sync
```

---

## GoalRecord Schema/

**Storage:** FileDatabase in `{workspace}/.nomendex/goals/` (one `.md` file per goal with YAML frontmatter, same pattern as todos).

**Type definition:** `bun-sidecar/src/features/goals/goal-types.ts`

### Base Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique ID, e.g., `goal-career-nomendex-launch-1234567890-ab12` |
| `title` | `string` | Goal title |
| `description` | `string?` | Short context for agent use |
| `area` | `string` | Life area, e.g., "Career & Professional", "Health & Wellness" |
| `horizon` | `"vision" \| "yearly" \| "quarterly" \| "monthly"` | Time horizon |
| `status` | `"active" \| "completed" \| "paused" \| "dropped"` | Current state |
| `parentGoalId` | `string?` | Parent goal (monthly → quarterly → yearly → vision) |
| `targetDate` | `string?` | Target completion date (YYYY-MM-DD) |
| `tags` | `string[]?` | Optional tags |
| `mirrorNoteFile` | `string?` | Relative path to per-goal mirror note |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp |

### Progress Mode (Discriminated Union)

The `progressMode` field determines how progress is calculated. This prevents mixing outcome goals and task throughput into one percentage axis.

| Mode | Additional Fields | Calculation | Example |
|------|------------------|-------------|---------|
| `rollup` | (none) | Average of child goals. **Leaf-only rule:** goals with active children count ONLY children, never direct todos. | Career yearly = avg(Q1, Q2, Q3, Q4) |
| `metric` | `progressCurrent`, `progressTarget` | `current / target * 100` | 12/72 trainings = 17% |
| `manual` | `progressValue` (0-100) | Direct value | Renovation = 15% |
| `milestone` | (none) | Completed child goals / total child goals | 2/4 quarterly milestones = 50% |

---

## Linkage Model

### Project → Goal

```typescript
ProjectConfig {
  goalRef?: string  // single goal ID
}
```

Singular, not array. If a project genuinely supports multiple goals, individual todos get explicit `goalRefs`.

### Todo → Goal

```typescript
Todo {
  goalRefs?: string[]          // user/agent editable input
  resolvedGoalRefs?: string[]  // computed snapshot for reporting
}
```

**`resolvedGoalRefs` computation rules:**

| Todo State | Behavior |
|-----------|----------|
| Open (`todo`, `in_progress`, `later`, not archived) | **Recomputed** on every update. Formula: `todo.goalRefs ?? [project.goalRef].filter(Boolean)` |
| Closed (`done` or `archived`) | **Frozen** at moment of completion. Never recomputed, even if project.goalRef changes later. |

This means:
- Changing `project.goalRef` automatically updates all open todos in that project
- Historical reporting uses the snapshot from when the todo was completed
- Reporting always reads `resolvedGoalRefs`, never computes live

### Effective Goal Binding

```
1. todo.goalRefs (explicit override, if set)
2. project.goalRef (inherited, if todo has no explicit goalRefs)
3. unlinked (if neither exists)
```

Never infer goal relationships from text similarity or note content.

---

## API Endpoints

All endpoints are `POST` with JSON body.

**Location:** `bun-sidecar/src/server-routes/goals-routes.ts`

### CRUD

| Endpoint | Input | Output |
|----------|-------|--------|
| `/api/goals/list` | `{ horizon?, status?, area?, parentGoalId? }` | `GoalRecord[]` |
| `/api/goals/get` | `{ goalId }` | `GoalRecord` |
| `/api/goals/create` | `{ title, area, horizon, progressMode, ... }` | `GoalRecord` |
| `/api/goals/update` | `{ goalId, updates }` | `GoalRecord` |
| `/api/goals/delete` | `{ goalId }` | `{ success: boolean }` |

### Graph Query

| Endpoint | Input | Output |
|----------|-------|--------|
| `/api/goals/graph` | `{ goalId }` | `{ goal, childGoals, linkedProjects, linkedTodos, computedProgress }` |

Returns the full graph for a goal: child goals, projects with matching `goalRef`, todos with matching `resolvedGoalRefs`, and computed progress per `progressMode`.

### Mirror Sync

| Endpoint | Input | Output |
|----------|-------|--------|
| `/api/goals/sync/goal` | `{ goalId }` | `MirrorSyncResult` |
| `/api/goals/sync/project` | `{ projectId }` | `MirrorSyncResult` |
| `/api/goals/sync/all` | `{}` | `{ goals: MirrorSyncResult[], projects: MirrorSyncResult[] }` |
| `/api/goals/sync/dashboards` | `{}` | `void` |
| `/api/goals/sync/import` | `{ filePath }` | `{ changes }` or `null` |

### Migration

| Endpoint | Input | Output |
|----------|-------|--------|
| `/api/goals/migration/preview` | `{}` | `MigrationPlan` |
| `/api/goals/migration/execute` | `MigrationPlan` | `MigrationResult` |

---

## Mirror Sync

### Contract

Mirror notes (for both goals and projects) follow a unified contract:

```markdown
---
goalId: goal-career-nomendex-launch   # or projectId for projects
title: "Nomendex v produkci"
status: active
managedBy: nomendex-goal-sync         # or nomendex-project-sync
syncVersion: 1
lastSyncedAt: "2026-03-27T10:00:00Z"
managedHash: "a1b2c3d4"
---

# Goal Title

## Overview          ← user-editable
## Notes             ← user-editable
## Decisions         ← user-editable

<!-- managed:start -->
## Progress          ← managed (overwritten by sync)
## Linked Projects   ← managed
## Linked Todos      ← managed
<!-- managed:end -->
```

### Section Rules

| Section Type | Examples | Sync Behavior |
|-------------|----------|---------------|
| **User-editable** | Overview, Notes, Decisions | Never overwritten by sync |
| **Managed** | Progress, Linked Todos, Linked Projects | Overwritten entirely on each sync |

### Conflict Detection

Uses `managedHash` (MD5 hash of managed section content):

1. On sync: compute hash of current managed sections in file
2. Compare with stored `managedHash` in frontmatter
3. If mismatch → user edited managed section → conflict reported
4. Frontmatter diffs: compare each field with typed store

### File Layout

```
{workspace}/.nomendex/goals/          # Typed GoalRecords (FileDatabase)
  goal-career-nomendex-launch.md
  goal-health-movement-habit.md

{notesPath}/Goals/
  0. 3-Year Vision.md                 # Generated-only dashboard
  1. Yearly Goals.md                  # Generated-only dashboard
  2. Monthly Goals.md                 # Generated-only dashboard
  3. Weekly Review.md                 # Template (agent-managed working note)
  goals/                              # Per-goal mirror notes (bidirectional)
    career-nomendex-launch.md
    health-movement-habit.md

{notesPath}/Projects/                 # Project mirror notes (bidirectional)
  Nomendex.md
  Health.md
```

---

## Migration

Migration from legacy `Goals/*.md` markdown files to typed GoalRecords is **assisted, not automatic**.

### Flow

1. **Preview:** `POST /api/goals/migration/preview` parses existing goal files:
   - `0. 3-Year Vision.md` → vision-horizon goals (Key Areas sections)
   - `1. Yearly Goals.md` → yearly goals (checkboxes by area) + quarterly milestones
   - `2. Monthly Goals.md` → monthly goals (checkboxes by month)
   - `Projects/*.md` → `Supports: [[...]]` links → project-goal mapping

2. **Review:** Agent presents the migration plan to the user showing:
   - Extracted goal candidates with suggested IDs, horizons, areas, progress modes
   - Parent-child relationships
   - Project `goalRef` assignments from `Supports:` links

3. **Confirm:** User reviews, adjusts, confirms

4. **Execute:** `POST /api/goals/migration/execute` creates GoalRecords and updates projects

### Smart Detection

- **Metric detection:** If a goal title contains numbers (e.g., "2 AI projekty", "72 tréninků"), the parser suggests `metric` progressMode and extracts the target
- **Area inference:** Czech and English keyword matching for quarterly/monthly goals
- **Parent linking:** Automatic by matching area across horizons

---

## Todo Link Contract

### Format

```
[[todo:todo-id|Display Title]]
```

- `todo:` prefix = todo link (not a note link)
- Editor resolver opens todo detail panel, not a note file
- Backlinks engine ignores `todo:` prefixed links (no phantom notes)
- Visual distinction: purple accent color (vs. blue for note links)

### Legacy Compatibility

Old `[[todos/todo-id.md|Title]]` links continue to work but new links always use the `[[todo:id|Title]]` format.

---

## BPagent Integration

### System Prompt Updates

The BPagent system prompt (`built-in-bpagent.ts`) includes:
- Full Goals API endpoint reference
- Linkage model documentation
- Goal progress display conventions per `progressMode`
- Updated guidelines: API is source of truth, no text-based inference

### Skill Updates

| Skill | Change |
|-------|--------|
| `/daily` | Morning context surfacing includes goal progress from API. Evening cascade impact uses `resolvedGoalRefs`. |
| `/weekly` | Goal progress from `/api/goals/graph`. Project dashboard includes `goalRef`. Todo creation includes `goalRefs` when needed. |
| `/monthly` | Quarterly milestone check from typed goals. Monthly goal completion from API. |
| `/goal-tracking` | Completely rewritten to structured-first: reads goals from API, displays progress per `progressMode`, shows full cascade. |

### Planning Flow

**Weekly (with agent):**
1. Agent reads goal store → current goals and progress
2. Agent reads monthly goals → what's the focus this month
3. Agent reads todos → what's in progress, overdue
4. Agent proposes todos for the week with `scheduledStart/End` and `goalRefs`
5. User confirms/adjusts
6. Agent creates todos via API
7. Agent writes Weekly Review note (narrative mirror)

**Daily (with agent):**
1. Agent reads scheduled/overdue/in_progress todos
2. Agent shows goal progress for context
3. User adjusts plan based on reality (work, energy)
4. Agent saves workset to daily note
5. Evening: reconcile, completion rate, reflection

---

## Key Files

| File | Purpose |
|------|---------|
| `features/goals/goal-types.ts` | Zod schemas for GoalRecord with discriminated union |
| `features/goals/fx.ts` | CRUD + goal graph query with rollup computation |
| `features/goals/index.ts` | Re-exports |
| `features/goals/migration.ts` | Legacy markdown → GoalRecord migration |
| `features/goals/mirror-sync.ts` | Bidirectional mirror sync engine |
| `server-routes/goals-routes.ts` | API route handlers |
| `features/projects/project-types.ts` | ProjectConfig with `goalRef` |
| `features/todos/todo-types.ts` | Todo with `goalRefs` + `resolvedGoalRefs` |
| `features/todos/fx.ts` | resolvedGoalRefs computation logic |
| `features/projects/fx.ts` | goalRef change → recompute open todo refs |
| `features/bpagent-pack/built-in-bpagent.ts` | BPagent system prompt with goals API |
| `services/default-skills.ts` | Updated daily/weekly/monthly/goal-tracking skills |
| `storage/root-path.ts` | `getGoalsPath()` |
| `services/workspace-init.ts` | Goals service initialization |
