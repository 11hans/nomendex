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
├── fx.ts                              # getDailyNoteName (server-side, subfolder-aware)
├── date-utils.ts                      # getDailyNoteFileName (date formatting)
├── daily-note-date-picker-dialog.tsx  # Today indicator, relative labels
├── note-view.tsx                      # Interactive table of contents

bun-sidecar/src/storage/
├── root-path.ts                       # getDailyNotesPath()

bun-sidecar/src/hooks/
└── useNotesAPI.ts                     # getDailyNoteName accepts optional date arg

bun-sidecar/src/server-routes/
└── notes-routes.ts                    # /api/notes/daily-name accepts date body
```
