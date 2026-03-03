# Inbox

A lightweight list view for quick task capture without a specific project.

## Overview

The Inbox provides a simple, distraction-free list to dump ideas and tasks before organizing them into projects. It is the default landing view and has a dedicated icon in the Activity Bar sidebar.

Under the hood, Inbox tasks are regular todos with `project: "Inbox"`. The "Inbox" project entity is auto-created on first launch so that agents and APIs can reference it immediately.

## Key Features

| Feature | Description |
|---------|-------------|
| **List view** | Flat task list (not a Kanban board) — optimized for quick capture |
| **Search** | Fuzzy search across task titles and descriptions |
| **Filters** | Tag filter pills and priority filter, same as the Kanban toolbar |
| **Quick create** | Create dialog with project locked to "Inbox" |
| **Delete + Undo** | Toast notification with undo action |
| **Archive + Undo** | Same pattern as delete |

## Auto-Initialization

On startup, the app ensures the "Inbox" project entity exists in `projects.json`. This is handled by the project migration step in `onStartup.ts`:

```
onStartup()
  → migrateProjects()
    → ensures "Inbox" ProjectConfig exists in projects.json
```

If the user has never used projects before, the Inbox project is pre-seeded so tasks created from the Inbox view have a valid project reference.

## Activity Bar

The Inbox has a dedicated icon (`Inbox` from Lucide) in the Activity Bar, positioned above all other plugin icons. Clicking it opens the Inbox view directly without going through the Todos plugin default view.

```typescript
openTab({
    pluginMeta: todosPlugin,
    view: "inbox",
    props: { project: "Inbox" }
})
```

## Data

Inbox tasks are standard todos with `project: "Inbox"`:

```yaml
---
title: "Quick idea"
project: "Inbox"
status: "todo"
---
```

Tasks with an empty or missing project are automatically assigned to "Inbox" when saved from the Inbox view:

```typescript
project: updatedTodo.project === "" ? "Inbox" : updatedTodo.project
```

## View Registration

The Inbox is registered as a view of the Todos plugin:

```typescript
// features/todos/index.ts
inbox: {
    id: "inbox",
    name: "Inbox",
    component: InboxListView,
}
```

## File Structure

```
bun-sidecar/src/features/todos/
├── inbox-view.tsx           # InboxListView component (new)
├── index.ts                 # View registration

bun-sidecar/src/features/projects/
├── projects-migration.ts    # Auto-creates Inbox project on startup (new)

bun-sidecar/src/components/
└── WorkspaceSidebar.tsx      # Inbox icon in Activity Bar
```
