# Note External Change Detection

## Problem

A note open in a tab lives in memory while other writers change the file on disk: agents, Obsidian (on the Mac or synced from the phone through iCloud), CLI tools. Two things must hold:

1. The editor shows what's on disk when that loses nothing.
2. Saving from the editor never overwrites text written elsewhere that the editor hasn't seen.

## Solution

File modification time (`mtime`) is the version marker.

- **Detect:** `checkForExternalChanges()` compares the file's mtime with the last one the editor saw. It runs on the notes watcher's `notes:fileChanged` event, when the app regains focus or becomes visible (e.g. back from Obsidian) and when the tab becomes active.
- **Protect:** every editor save sends `expectedMtime`; the server refuses to write when the file changed since, and hands back what's on disk instead.
- Note tabs flush pending draft saves when switching away/unmounting, so tab lifecycle changes do not lose buffered edits (and the flush is protected the same way).

## Architecture

### Data Flow

```
 notes:fileChanged / window focus / tab activation
        │
        ▼
 own save pending? ──yes──▶ skip (its result decides)
        │ no
        ▼
 /api/notes/mtime  ── same mtime ──▶ nothing
        │ changed
        ▼
 read note from disk
        │
   ┌────┴──────────────────┬──────────────────────┐
   ▼                       ▼                      ▼
 text = last saved     no unsaved edits       unsaved edits
 (iCloud touch,        → silent reload        → toast
  front matter only)                            "Reload" / "Keep mine"
 → update mtime,
   tags, project
```

### Key Components

#### 1. Server-side: `FeatureStorage.getFileMtime()`

Location: `src/storage/FeatureStorage.ts`

```typescript
async getFileMtime(filename: string): Promise<number | null> {
    const filePath = path.join(this.basePath, filename);
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
        return null;
    }
    const stats = await file.stat();
    return stats.mtimeMs;
}
```

Uses `Bun.file().stat()` to get the file's modification time in milliseconds. Returns `null` if file doesn't exist.

#### 2. API Endpoint: `/api/notes/mtime`

Location: `src/server-routes/notes-routes.ts`

Lightweight endpoint that only returns the mtime, avoiding the cost of reading file content just to check freshness.

```typescript
"/api/notes/mtime": {
    async POST(req: Request) {
        const args = await req.json();
        const result = await functions.getNoteMtime.fx(args);
        return Response.json(result);
    },
}
```

#### 3. Client-side: `notesAPI.getNoteMtime()`

Location: `src/hooks/useNotesAPI.ts`

```typescript
getNoteMtime: (args: { fileName: string }) =>
    fetchAPI<{ mtime: number | null }>("mtime", args)
```

#### 4. Note Schema

Location: `src/features/notes/index.ts`

The `Note` type includes an optional `mtime` field:

```typescript
export const NoteSchema = z.object({
    fileName: z.string(),
    content: z.string(),
    frontMatter: z.record(z.string(), z.unknown()).optional(),
    folderPath: z.string().optional(),
    mtime: z.number().optional(), // File modification time in milliseconds
});
```

#### 5. Protected Saves: `saveNote({ expectedMtime })`

Location: `src/features/notes/fx.ts`, `src/features/notes/index.ts`

```typescript
async function saveNote(args: { fileName: string; content: string; expectedMtime?: number }) {
    if (args.expectedMtime !== undefined) {
        const diskMtime = await getStorage().getFileMtime(args.fileName);
        if (diskMtime !== null && diskMtime !== args.expectedMtime) {
            return { ...(await getNoteByFileName({ fileName: args.fileName })), conflict: true };
        }
    }
    // ... write file, return { ..., mtime } ...
}
```

- The output schema is `SaveNoteResultSchema = NoteSchema.extend({ conflict: z.boolean().optional() })`.
- On a conflict nothing is written and `/api/notes/save` leaves the backlinks/tags indexes alone.
- Callers without `expectedMtime` (agents, scripts, create dialogs) write unconditionally, as before.

#### 6. Editor Saves: `writeNote()`

Location: `src/features/notes/note-view.tsx`

`saveImmediately` (blur), `debouncedSave` (200 ms) and `flushPendingDraft` (tab switch/unmount) all go through `writeNote(fileName, content)`:

- **Queued:** saves run one at a time (`saveQueueRef`), so each sends the mtime the previous one produced. Without the queue, a blur save started while the debounced save is in flight would see its own previous write as a conflict.
- **`expectedMtime: lastKnownMtimeRef.current`** on every save; a success updates `lastSavedContentRef` and `lastKnownMtimeRef`.
- **Touch, not edit:** when the server reports a conflict but the text on disk equals `lastSavedContentRef` (iCloud rewrote the file, or only front matter changed), the save is retried with the disk mtime. Front matter is preserved by the server either way.
- **Real conflict:** `saveState = "unsaved"` and the conflict toast. `flushPendingDraft` only logs a warning: the tab is going away, and returning to it asks again.
- **Dropped after reload:** `applyFreshNote()` clears the pending debounce and bumps `reloadCountRef`; queued saves from before the reload are skipped, so they can't write stale text over what was just loaded.
- A save left over for a note this view no longer shows is written without `expectedMtime`, as before.

#### 7. `checkForExternalChanges()`

Location: `src/features/notes/note-view.tsx`

1. Skip while the initial load has no mtime, a debounce is pending or a save is queued (`pendingSavesRef`). Our own writes trigger the watcher too; their result decides.
2. Same mtime → nothing.
3. Read the note. If a save or reload landed meanwhile (`lastKnownMtimeRef` moved), stop; that write's own event checks again.
4. Disk text equals `lastSavedContentRef` → `applyNoteMetadata()` (mtime, tags, project), the editor is untouched.
5. No unsaved edits → `applyFreshNote()` (silent reload).
6. Unsaved edits → conflict toast, only in the active tab; an inactive tab asks when it's activated.

**Unsaved edits** (`hasUnsavedEdits()`): in markdown mode, the text differs from `lastSavedContentRef`. In rich mode the serializer writes markdown its own way (a note written in Obsidian rarely round-trips byte for byte), so the editor document is compared with the parsed last-saved text (`doc.eq`) instead. The same check decides whether `flushPendingDraft` writes at all, so opening and leaving a note never rewrites it.

**Triggers:**

```typescript
// notes:fileChanged (watcher SSE): agent edits / locked files reload unconditionally,
// everything else goes through checkForExternalChanges()
// window "focus" + document "visibilitychange" (active tab only)
// tab activation (inactive → active transition, via prevActiveTabIdRef)
```

#### 8. Draft Flush on Tab Switch / Unmount

When the note tab transitions from active to inactive, or unmounts, a pending debounced save is flushed immediately through `writeNote()`:

```typescript
useEffect(() => {
    const isActive = activeTab?.id === tabId;
    if (wasActiveRef.current && !isActive) {
        void flushPendingDraft();
    }
    wasActiveRef.current = isActive;
}, [activeTab?.id, tabId, flushPendingDraft]);
```

#### 9. Tab Visibility Model (Hidden vs Mounted)

Tabs infrastructure hides inactive tab content via CSS (`data-[state=inactive]:hidden`) and selectively force-mounts specific views (chat/todos). Inactive note tabs still receive `notes:fileChanged` and reload silently when that loses nothing; conflicts wait for activation.

## Conflict Resolution

When the file changed on disk AND the editor has unsaved edits (detected by a check or by a refused save):

1. **Toast** "Note was modified externally" (one per note: `id: note-conflict-<fileName>`, so repeated events don't stack).
2. **"Reload"**: discards local edits and loads the note from disk.
3. **"Keep mine"**: takes the current disk mtime and saves the editor's text over it right away. If the file changed yet again in between, the toast comes back.

Without unsaved edits the content is refreshed silently. Agent edits (`source: "agent"`, or while the agent holds the file lock) always reload, with a "Note updated by Claude" toast.

## Why mtime?

- **Stored automatically**: The filesystem maintains mtime on every write - no manual tracking needed
- **Lightweight check**: Fetching mtime is much cheaper than reading and comparing file content
- **Reliable**: Detects any change source (agents, external editors, CLI tools, etc.)

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| File deleted externally | `null` mtime, check skipped; the next save recreates it |
| iCloud rewrites the file with the same text | mtime adopted, no reload, no toast |
| Front matter edited elsewhere | tags/project refreshed; editor untouched; saves keep the new front matter |
| Typing while Obsidian writes | the debounced save is refused, toast; Obsidian's text stays on disk |
| Blur save while debounced save is in flight | queued, second save sends the first one's mtime |
| Own save fires the watcher | skipped while pending; afterwards the mtime matches |
| Switch away with pending debounce save | flushed immediately (refused if the file changed) |
| Initial mount | skipped via `prevActiveTabIdRef` transition check |
| mtime not yet loaded | skipped via `lastKnownMtimeRef === null` |

## Common Pitfalls

### 1. False positives on every keystroke

**Problem**: The external change toast appears while typing.

**Cause**: Either:
- The effect's dependency array includes `content`, causing it to run on every keystroke
- `lastKnownMtimeRef` is not updated after auto-save, so the saved file's new mtime is seen as "external"

**Solution**:
- Only include `[activeTab?.id, tabId, noteFileName]` in the dependency array
- Save only through `writeNote()`, which updates `lastKnownMtimeRef` after every successful save
- Skip checks while a save is pending (`saveTimeoutRef`, `pendingSavesRef`)

### 2. Check runs on initial mount

**Problem**: The check runs immediately when opening a note, potentially showing a stale toast.

**Cause**: The effect runs whenever `activeTab?.id === tabId`, including on mount.

**Solution**: Track the previous active tab ID and only run when transitioning from inactive to active:
```typescript
const wasActive = prevActiveTabIdRef.current === tabId;
const isActive = activeTab?.id === tabId;
prevActiveTabIdRef.current = activeTab?.id;
if (!isActive || wasActive) return;
```

### 3. saveNote doesn't return mtime

**Problem**: After saving, the client doesn't know the new mtime.

**Cause**: The server-side `saveNote` function wasn't returning the mtime.

**Solution**: Fetch mtime after writing and include it in the response:
```typescript
const mtime = await getStorage().getFileMtime(args.fileName);
return { ...note, mtime };
```

### 4. Recreating the editor on `setNote`

**Problem**: unsaved edits vanish after a metadata refresh.

**Cause**: the first `note` change after the rich editor is created re-runs its effect, which rebuilds the editor from `note.content`.

**Solution**: `applyNoteMetadata()` updates only mtime, tags and project; `setNote` is called only by `applyFreshNote()`, when the editor content is replaced anyway.

## Testing

To test manually:

1. Open a note in Nomendex.
2. Append a line to the file elsewhere (Obsidian, or `echo "x" >> note.md`).
3. Observe without switching tabs:
   - no local changes: content updates silently;
   - typing in Nomendex at the same time: toast appears, the appended line stays on disk until you pick "Keep mine".
4. Switch to Obsidian, edit, switch back: the focus check picks up the change.
