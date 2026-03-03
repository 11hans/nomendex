# Note Renaming

Rename notes directly from the file tree without leaving the notes browser.

## Overview

A pencil icon (✏️) appears on hover for each note in the file tree. Clicking it opens a dialog where you can type a new name. The rename updates the file on disk, refreshes the file tree, and updates all open tabs that reference the renamed note.

## UI

### File Tree

Each note row in `NotesFileTree` shows action icons on hover:

| Icon | Action |
|------|--------|
| ✏️ Pencil | Rename note |
| 📁 Folder | Move to folder |
| 🗑️ Trash | Delete note |

### Rename Dialog

The `RenameNoteDialog` component:

- Opens via the command dialog overlay
- Pre-fills the current note name (without `.md` extension)
- Auto-selects the text for quick replacement
- Validates that the name is not empty
- Shows inline error messages if the rename fails
- Submit with **Rename** button or `⌘Enter`

```
┌──────────────────────────────────┐
│ Rename Note                      │
│ Enter a new name for "my-note"   │
│ ┌──────────────────────────────┐ │
│ │ my-note                      │ │
│ └──────────────────────────────┘ │
│              [Cancel] [Rename ⌘↵]│
└──────────────────────────────────┘
```

## Tab Synchronization

When a note is renamed, all open tabs referencing the old filename are updated to the new filename via `renameNoteTabs()` from the workspace context:

```typescript
renameNoteTabs(oldFileName, result.fileName);
```

This ensures tabs don't break or show stale data after a rename.

## API

### Rename Note

```
POST /api/notes/rename
Body: { "oldFileName": "old-name.md", "newFileName": "new-name" }
Response: { "fileName": "new-name.md" }
```

The backend appends `.md` if not already present and performs the file system rename.

## File Structure

```
bun-sidecar/src/features/notes/
├── rename-note-dialog.tsx    # RenameNoteDialog component (new)
├── NotesFileTree.tsx          # Pencil icon + onRenameNote prop
├── browser-view.tsx           # requestRenameNote handler

bun-sidecar/src/contexts/
└── WorkspaceContext.tsx        # renameNoteTabs() utility
```
