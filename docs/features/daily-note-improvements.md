# Daily Note Improvements

Daily notes that work the same in Nomendex and Obsidian, created from the vault template, plus a today indicator and relative date labels in the date picker.

## Overview

Where daily notes live and how they're named comes from Obsidian's core Daily notes settings (`.obsidian/daily-notes.json`), so both apps open and create the same file. Nomendex only reads these settings; they're changed in Obsidian → Settings → Daily notes, and a change applies without a restart (the file is read on every call).

## Settings: `daily-notes-settings.ts`

`getDailyNotesSettings()` returns `{ folder, format, template }`:

| Field | With `.obsidian/daily-notes.json` | Without it |
|-------|-----------------------------------|------------|
| `folder` (relative to the notes root, `""` = root) | `folder`, empty = vault root (Obsidian's default) | `daily-notes` (`getDailyNotesPath()`) |
| `format` (Moment.js) | `format`, empty = `YYYY-MM-DD` (Obsidian's default) | `M-D-YYYY` |
| `template` | `template` + `.md` if that file exists | first `*daily*.md` in `vault-config.json → folderMapping.templates` |

Supported format tokens: `YYYY YY MM M DD D HH mm` and `[literal]` text. A format with anything else (`dddd`, `MMMM`, `Do`, a `/` folder part) falls back to `M-D-YYYY` with one warning in the log.

```
my-vault/
├── .obsidian/daily-notes.json   ← { "folder": "Daily", "format": "DD-MM-YYYY", "template": "Templates/Daily Note Template" }
├── Daily/                       ← created on startup if missing
│   ├── 12-10-2026.md
│   └── 13-10-2026.md
└── my-regular-note.md
```

## Finding a Daily Note

A file is the daily note for a date when it sits directly in the daily notes folder and its name parses as that date in the configured format (`getDailyNoteDate(fileName, settings)`):

- Parsing uses **only** the configured format. `10-11-2026` is 10 Nov as `DD-MM-YYYY` and 11 Oct as `M-D-YYYY`, so guessing another order would open the wrong day.
- Numbers may have a leading zero or not (`1-11-2026` = `01-11-2026`), so a note created by an older naming still matches.
- iCloud conflict copies (`28-03-2026 2.md`) and impossible dates are not daily notes.

`findDailyNote(date, settings)` tries the exact expected name first, then any file in the folder that parses to the same local day.

## Server-Side File Naming

```
POST /api/notes/daily-name
Body: { "date": "2026-03-03T00:00:00.000Z" }  // optional, defaults to today
Response: { "fileName": "Daily/03-03-2026.md" }
```

Returns the existing note for that day if there is one, otherwise the name it would be created under.

## Creating from the Vault Template

Every way of opening a daily note (the Today sidebar item, "Open Today's/Yesterday's/Tomorrow's Daily Note", the date picker) goes through one endpoint:

```
POST /api/notes/daily-open
Body: { "date": "2026-03-03T00:00:00.000Z" }  // optional, defaults to today
Response: Note & { created: boolean }
```

If no note exists for that day it is created deterministically (no LLM) from the settings' template, with Obsidian's placeholders filled in:

| Placeholder | Value |
|-------------|-------|
| `{{title}}`, `{{date}}` | the note's name (configured format) |
| `{{time}}` | current time, `HH:mm` |
| `{{date:FMT}}`, `{{time:FMT}}` | the note's date / current time in `FMT` (supported tokens only, otherwise left as is) |
| `{{yesterday}}`, `{{tomorrow}}` | Nomendex extension: the neighbouring days' names |

No template → empty note. Notes are only created when opened; nothing is pre-created for skipped days.

## Agents

BPagent's system prompt, its `<daily-context>` block (`daily_notes_dir`, `filename_pattern`, `today_note`) and the weekly/monthly reviewer and goal-aligner subagents all take the folder and format from `getDailyNotesSettings()`.

## Migrating to Another Folder or Format

`bun-sidecar/scripts/migrate-daily-notes.ts` moves existing daily notes to what's set in Obsidian and rewrites the links to them:

```
bun scripts/migrate-daily-notes.ts --vault <path> --from-folder daily-notes --from-format M-D-YYYY [--apply]
```

- Dry run by default: prints renames, skipped files, links per file and any leftover mention of the old folder.
- Each note is parsed strictly in `--from-format` and renamed to the new folder and format; conflict copies keep their suffix. A taken target name is skipped and reported, never overwritten.
- Links: `[[old/…]]`, `![[old/…]]`, bare `[[…]]` to a moved note and `[text](old/….md)`, with `|alias`, `#heading` and `^block` kept. Links to days without a note (yesterday/tomorrow navigation) are rewritten too, so clicking them creates the note in the new place. Only those strings change; the rest of each file stays byte-identical.
- Sets `vault-config.json → folderMapping.dailyNotes` and removes the old folder once it's empty.
- Refuses to run while Obsidian still points at the old folder or uses an unsupported format.

Afterwards rebuild the indexes: `/api/notes/backlinks/rebuild` and `/api/notes/tags/rebuild`.

## Daily Panel

Above a daily note's editor, a read-only panel (`features/today/daily-note-panel.tsx`, data from `POST /api/today/daily-panel`) shows:

- **Plán**
  - the previous day's last non-empty `zítra:` line (also `zitra:`, any case, as a list item or bold label);
  - open todos (tasks and events) whose `scheduledStart`–`scheduledEnd` range covers the note's day — all-day first, then by start time;
  - todos with `status: "in_progress"`, only in today's note (status has no history) and not already listed as scheduled.
  - Overdue todos from earlier days are deliberately not shown — a skipped day must not turn into a backlog.
- **Hotovo** — todos with `status: "done"` whose `completedAt` falls on the note's local day (archived included).

The panel only appears for daily notes (the server decides with `getDailyNoteDate`; the client only skips names without a digit) and renders nothing when everything is empty. The previous day's note is found by date (`findDailyNote`), not by name. It refreshes on todo changes and on external note changes (e.g. the previous day's note edited in Obsidian).

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
├── daily-notes-settings.ts            # getDailyNotesSettings (Obsidian settings), getDailyNoteDate
├── date-utils.ts                      # formatDailyNoteDate, parseDailyNoteDate, formatMomentDate (tested)
├── fx.ts                              # findDailyNote, getDailyNoteName, openDailyNote (template fill)
├── daily-note-date-picker-dialog.tsx  # Today indicator, relative labels
├── note-view.tsx                      # Interactive table of contents

bun-sidecar/src/storage/
├── root-path.ts                       # getDailyNotesPath() (default folder without Obsidian settings)

bun-sidecar/src/hooks/
└── useNotesAPI.ts                     # getDailyNoteName accepts optional date arg

bun-sidecar/src/features/today/
├── daily-panel.ts                     # extractPlan, scheduledOn, inProgress, completedOn (pure, tested)
├── fx.ts                              # getDailyPanel
├── daily-note-panel.tsx               # Panel above the daily note editor
├── open-today-note.ts                 # Shared "open today's note" for sidebar + legacy tab
└── today-view.tsx                     # Legacy Today tab → hands off to today's note

bun-sidecar/src/features/bpagent-pack/
└── daily-context.ts                   # <daily-context> block from the same settings

bun-sidecar/src/server-routes/
├── notes-routes.ts                    # /api/notes/daily-name, /api/notes/daily-open
└── today-routes.ts                    # /api/today/daily-panel

bun-sidecar/scripts/
└── migrate-daily-notes.ts             # Move daily notes to a new folder/format + rewrite links
```
