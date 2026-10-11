# Daily Note Improvements

Enhanced daily note creation with a dedicated subfolder, today indicator, and relative date labels.

## Overview

Daily notes are now stored in a `daily-notes/` subfolder within the notes directory, created automatically on startup. The date picker dialog highlights today's date and shows relative labels ("Yesterday", "Tomorrow"). File naming has moved from client-side to server-side to ensure consistency.

## Daily Notes Subfolder

Previously, daily notes were created at the root of the notes directory alongside regular notes. They are now stored in a dedicated subfolder:

```
my-workspace/
└── notes/
    ├── daily-notes/       ← Auto-created on startup
    │   ├── 3-1-2026.md
    │   ├── 3-2-2026.md
    │   └── 3-3-2026.md
    └── my-regular-note.md
```

The subfolder is created during notes service initialization:

```typescript
// fx.ts
const dailyPath = getDailyNotesPath();
await mkdir(dailyPath, { recursive: true });
```

Path resolution is centralized in `root-path.ts`:

```typescript
dailyNotesPath: path.join(notesPath, "daily-notes")
```

## Server-Side File Naming

The `getDailyNoteName` function moved from a simple client-side utility to a server-side endpoint that returns the full relative path:

```
POST /api/notes/daily-name
Body: { "date": "2026-03-03T00:00:00.000Z" }  // optional, defaults to today
Response: { "fileName": "daily-notes/3-3-2026.md" }
```

This ensures the daily notes subfolder prefix is always included and consistent across all callers.

## Creating from the Vault Template

Every way of opening a daily note (the Today sidebar item, "Open Today's/Yesterday's/Tomorrow's Daily Note", the date picker) goes through one endpoint:

```
POST /api/notes/daily-open
Body: { "date": "2026-03-03T00:00:00.000Z" }  // optional, defaults to today
Response: Note & { created: boolean }
```

If the note doesn't exist yet it is created deterministically (no LLM), the same way as the `daily-notes` skill script: the first file with "daily" in its name inside `vault-config.json → folderMapping.templates`, with `{{date}}`, `{{yesterday}}` and `{{tomorrow}}` filled in as `M-D-YYYY`. No template → empty note. Notes are only created when opened; nothing is pre-created for skipped days.

## Daily Panel

Above a daily note's editor, a read-only panel (`features/today/daily-note-panel.tsx`, data from `POST /api/today/daily-panel`) shows:

- **Plán**
  - the previous day's last non-empty `zítra:` line (also `zitra:`, any case, as a list item or bold label);
  - open todos (tasks and events) whose `scheduledStart`–`scheduledEnd` range covers the note's day — all-day first, then by start time;
  - todos with `status: "in_progress"`, only in today's note (status has no history) and not already listed as scheduled.
  - Overdue todos from earlier days are deliberately not shown — a skipped day must not turn into a backlog.
- **Hotovo** — todos with `status: "done"` whose `completedAt` falls on the note's local day (archived included).

The panel only appears for notes in the daily notes folder and renders nothing when everything is empty. It refreshes on todo changes and on external note changes (e.g. the previous day's note edited in Obsidian).

The Today sidebar item opens today's daily note in a regular notes tab. Older Today tabs (formerly a BPagent `/daily` chat) restored from `workspace.json` hand off to the note and close themselves.

## Date Picker Enhancements

### Today Indicator

The calendar component highlights today's date with a ring:

```typescript
modifiers={{ today: new Date() }}
modifiersClassNames={{ today: "ring-2 ring-primary ring-offset-1" }}
```

A **"Today"** badge also appears next to the formatted date when the selected date is today.

### Relative Date Labels

When navigating to yesterday or tomorrow, a subtle label appears below the date:

| Selected Date | Label |
|---------------|-------|
| Yesterday | "Yesterday" |
| Today | Badge: **Today** |
| Tomorrow | "Tomorrow" |
| Other | — |

## Interactive Table of Contents

The note sidebar's "On This Page" section supports keyboard navigation:

- Focus the minimap section, then use **↑↓** arrow keys to navigate headings
- A `↑↓` indicator appears when the section is focused
- Pressing Enter or clicking scrolls to the selected heading
- Active heading is highlighted with the accent color

## File Structure

```
bun-sidecar/src/features/notes/
├── fx.ts                              # getDailyNoteName, openDailyNote (template fill)
├── date-utils.ts                      # getDailyNoteFileName, formatDailyNoteDate, parseDailyNoteDate
├── daily-note-date-picker-dialog.tsx  # Today indicator, relative labels
├── note-view.tsx                      # Interactive table of contents

bun-sidecar/src/storage/
├── root-path.ts                       # getDailyNotesPath()

bun-sidecar/src/hooks/
└── useNotesAPI.ts                     # getDailyNoteName accepts optional date arg

bun-sidecar/src/features/today/
├── daily-panel.ts                     # extractPlan, scheduledOn, inProgress, completedOn (pure, tested)
├── fx.ts                              # getDailyPanel
├── daily-note-panel.tsx               # Panel above the daily note editor
├── open-today-note.ts                 # Shared "open today's note" for sidebar + legacy tab
└── today-view.tsx                     # Legacy Today tab → hands off to today's note

bun-sidecar/src/server-routes/
├── notes-routes.ts                    # /api/notes/daily-name, /api/notes/daily-open
└── today-routes.ts                    # /api/today/daily-panel
```
