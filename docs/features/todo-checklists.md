# Todo Checklists

Tasks now support interactive markdown checklists directly inside `description`.

## Overview

Checklist support is built on plain markdown lines in task descriptions:
- unchecked: `- [ ] Item`
- checked: `- [x] Item`

The system provides:
- Editor insertion shortcut for checklist rows
- Card rendering of checklist items with inline checkbox toggles
- Progress counter (`done/total`)
- Optimistic persistence with rollback on failure

## Data and Syntax

Checklist items are parsed from `todo.description` line-by-line using markdown-like pattern matching.

Parsing rules:
- A checklist line matches `^-\s*\[([ xX])\]\s*(.*)$`
- `x`/`X` => checked
- space => unchecked
- Non-checklist lines remain regular description text

No new schema fields were introduced; checklist state is fully encoded in `description`.

## Editor Flow (`TaskCardEditor`)

A dedicated button (`ListChecks` icon) inserts a checklist row:
- insertion text: `- [ ] `
- if cursor is not on a new line, a newline is inserted first
- cursor is moved to the end of the inserted marker

This keeps authoring fast without opening a separate checklist UI.

## Card Rendering (`TodoCard`)

When description contains checklist lines:
1. Checklist lines are rendered as interactive rows with checkboxes
2. Non-checklist lines are rendered as normal text above checklist block
3. Progress is rendered as `checkedCount/total`

If description contains no checklist lines, card falls back to standard truncated description rendering.

## Toggle and Persistence Contract

Toggle action updates the source markdown line (`- [ ]` <-> `- [x]`) and sends one `updateTodo` mutation with new `description`.

Behavior in `TodosBrowserView`:
- Optimistic local update first
- API call: `updates: { description: newDescription }`
- On error: reload todos (`loadTodos`) to rollback to server state

This applies both for enabling and disabling checklist items.

## UX Guarantees

- Checklist interaction never changes title/status/project directly
- State remains portable in markdown text
- Existing integrations that read `description` continue to work
- Failed persistence recovers to consistent state via reload fallback
