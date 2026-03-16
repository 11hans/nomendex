# Inbox

Inbox is now a **master-detail task workspace** instead of a single flat capture list.

## Overview

The Inbox feature is still built on regular todos (`project: "Inbox"` for inbox-native tasks), but the UI evolved into a two-panel workflow:
- left panel: groups/projects navigation
- right panel: filtered task list + quick actions

This allows both quick capture and lightweight triage across Inbox + project tasks in one place.

## Layout

### Sidebar (Master)

Left panel includes:
- `All Tasks` group
- `Inbox` group
- dynamic project groups

Group badges show counts of active (non-done, non-archived) tasks.

### Detail Panel

Right panel includes:
- selected group title + item count
- status filters: `all | active | completed | archived`
- task list sorted by `updatedAt` (newest first)
- inline create button (`+ new`)

## Search and Filtering

Filtering is group-scoped and supports:
- title
- description
- project
- tags

Status filter counts are recomputed in scope of current group + search query.

## Drag and Drop Between Groups

Inbox supports drag-and-drop reassignment of task project:
- draggable rows in detail panel
- droppable groups in sidebar
- dropping onto group updates task project target

Normalization rules:
- empty/missing project => `Inbox`
- "inbox" casing normalized to `Inbox`

## Create Dialog Behavior

Create flow is context-aware:
- in `All Tasks`: project is editable
- in `Inbox` or specific project group: project is locked to selected group

When dialog closes, draft resets.

## Data Model

No new todo schema fields were introduced for this refactor.

Inbox behavior still relies on project naming conventions:
- canonical inbox project: `Inbox`
- missing project fallback: `Inbox`

## Auto-Initialization

On startup, app ensures Inbox project entity exists in project storage so APIs/agents can reference it.

## Key Behaviors Added in Master-Detail Refactor

- Resizable horizontal panel split
- Group-first triage workflow
- Group-aware counters and filters
- DnD project reassignment from inbox context
- Consistent edit/create dialogs shared with todo system

## File Structure

```text
bun-sidecar/src/features/todos/
├── inbox-view.tsx             # master-detail inbox implementation
├── TaskCardEditor.tsx         # shared editor
├── CreateTodoDialog.tsx       # shared create dialog
└── browser-view.tsx           # todo board counterpart

bun-sidecar/src/components/
└── WorkspaceSidebar.tsx       # Inbox entry point in views nav
```
