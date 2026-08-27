# Apple Calendar Integration (EventKit)

Tasks with scheduled dates are automatically synced to Apple Calendar via the native EventKit framework.

## Overview

1. **Apple Calendar**: When a user saves, moves, or deletes a task that has dates, the app syncs the corresponding event to Apple Calendar under a dedicated **"Nomendex Tasks"** calendar. It also features **Two-Way Sync**, where changes made directly in Calendar.app (e.g. moving or deleting events) are reflected back to Nomendex.

The integration is macOS-only, using the `WKScriptMessageHandler` bridge pattern for outgoing sync and `evaluateJavaScript` for incoming sync. Outgoing sync builds events from `scheduledStart`/`scheduledEnd`, while `dueDate` is preserved as the deadline metadata (overdue logic lives in Nomendex, not the calendar).

## Architecture

### Outgoing Sync (Nomendex → EventKit)
```
React UI (browser-view.tsx)
  ↓ save / delete / drag-drop
calendar-bridge.ts
  ↓ window.webkit.messageHandlers.calendarSync.postMessage()
WebViewWindowController.swift (WKScriptMessageHandler)
  ↓ dispatch
CalendarManager.swift (EventKit)
  ↓ EKEventStore.save() / .remove()
Apple Calendar.app
  ↓ callback via evaluateJavaScript
bridge ts (Promise resolved)
```

### Incoming Sync (Calendar.app → Nomendex)
```
Calendar.app
  ↓ EKEventStoreChangedNotification
CalendarManager.swift (detectChanges — deletions confirmed, see Incoming Deletions)
  ↓ evaluateJavaScript -> window.__onCalendarChange
calendar-change-bridge.ts (writes back `scheduledStart`/`scheduledEnd` plus deadline updates)
  ↓ todosAPI.updateTodo
FileDatabase (markdown updated)
```

Incoming sync never deletes a todo: a deleted event unschedules a `task` and archives an `event`. See [Incoming Deletions](#incoming-deletions).

## Sync Triggers

Calendar sync fires automatically on three events:

| Trigger | Action | Function |
|---------|--------|----------|
| Task save | Upsert calendar event | `syncTaskToCalendar(task)` |
| Drag-and-drop | Upsert with new status | `syncTaskToCalendar(task)` |
| Task delete | Remove calendar event | `removeTaskFromCalendar(taskId)` |
| Task archive | Remove calendar event | `syncTaskToCalendar(task)` (routes to remove) |

The bridge functions are no-ops when:
- Not running inside the native macOS app (no `window.webkit`)
- Task has no `scheduledStart` and no `scheduledEnd`
- Task is archived — an archived todo is removed from the calendar rather than upserted (this is what keeps an event archived by incoming sync from being immediately re-created)

### Manual Sync

Two commands are available in the Command Palette (`Cmd+K`):

- **"Reconcile Calendar"** — non-destructive. Deduplicates events per `taskId` across all Nomendex calendars, removes orphans (events whose task no longer exists), and upserts all live todos to refresh their metadata. Use this as the first fix when duplicates appear.
- **"Force Sync All to Calendar"** — destructive. Wipes and recreates all Nomendex calendars from scratch. Use after bulk imports or when Reconcile isn't enough.

Both commands upsert todos via the `upsertBatch` action (`syncTasksToCalendarBatch`): one native call carrying all tasks, saved with the commit deferred and a single `EKEventStore.commit()` at the end — instead of one round-trip + commit per task.

#### Reconcile Calendar

1. JS sends `action: "reconcile"` to Swift.
2. Swift scans Nomendex calendars, groups events by `taskId`, keeps one (cache match preferred, else oldest `creationDate`) and deletes the rest. Returns `{ taskIds, removed }`.
3. JS removes orphans (calendar taskIds not present in the todo store) and upserts every live todo with dates.

#### Force Sync (delete-and-recreate)
1. Sends a `purge` action to Swift which deletes all Nomendex calendars (e.g. "Nomendex Tasks", "Nomendex - ProjectName")
2. Upserts each task that has `scheduledStart`/`scheduledEnd` (and includes `dueDate` for metadata) — this recreates the calendars and events from scratch
   - Only tasks that carry scheduled info are synced; we no longer treat `dueDate` alone as enough to create a calendar event.

Color behavior during purge/recreate:
- Before delete, Swift stores each Nomendex calendar color (`cgColor`)
- After recreation, the original color is restored per calendar title
- This preserves user visual grouping after force sync

This approach avoids the need to read existing events (which requires full calendar access — write-only access can create events but cannot query them with `events(matching:)`).

## Calendar Event Behavior

| Feature | Details |
|---------|---------|
| Calendar name | **Nomendex Tasks** or **Nomendex - ProjectName** (auto-created on first sync) |
| Project-specific calendars | Tasks can be routed into per-project Nomendex calendars |
| Event lookup | Cached `eventIdentifier` first, then `nomendex://task/{id}` URL fallback |
| All-day events | Created when task has date only (no time). `EKEvent` all-day ends are **exclusive**: outgoing adds a day, incoming (`formatScheduledEnd`) takes it back off. Skipping either half stretches the todo by a day on every round-trip. |
| Timed events | Created when task has date + time |
| Time range | `scheduledStart` → event start, `scheduledEnd` → event end |
| Duration precedence | When `scheduledEnd` is set, it wins; `duration` is derived/ignored for end-time decisions |
| Duration fallback | If only `scheduledStart` (with time): end = start + duration (default 60 min) |
| Calendar alerts | Optional 30 + 15 minute alerts via `calendarReminderPreset` on timed events |
| Done tasks | Prefixed with ✅ in calendar title |

### Event Mapping

```swift
// CalendarManager.swift — event construction
event.title = isDone ? "✅ \(title)" : title
event.url = URL(string: "nomendex://task/\(taskId)")
event.notes = description
event.calendar = getOrCreateCalendar()  // "Nomendex Tasks"
```

### Date Parsing

Swift parses the incoming `scheduledStart`/`scheduledEnd` strings (and reads `dueDate` for metadata) using the same local ISO formats:

```swift
// "2026-02-16T14:00" → DateFormatter with "yyyy-MM-dd'T'HH:mm"
// "2026-02-16"       → DateFormatter with "yyyy-MM-dd" (all-day)
```

## TypeScript Bridge

**File:** `bun-sidecar/src/features/todos/calendar-bridge.ts`

Two exported functions:

### `syncTaskToCalendar(task: Todo)`

Sends an upsert message to Swift with all task data:

```typescript
window.webkit.messageHandlers.calendarSync.postMessage({
    action: "upsert",
    taskId: task.id,
    title: task.title,
    description: task.description || "",
    scheduledStart: task.scheduledStart,
    scheduledEnd: task.scheduledEnd,
    dueDate: task.dueDate,
    duration: task.duration || 60,
    priority: task.priority || "none",
    status: task.status,
    callback: "__calendarSyncCallback",
});
```

### `syncTasksToCalendarBatch(tasks: Todo[])`

Sends all tasks (filtered to those with `scheduledStart`/`scheduledEnd`) in one `upsertBatch` message. Swift saves each event with `commit: false` and commits once at the end. Returns `{ synced, failed }` or `null` when unavailable/timed out. Timeout scales with batch size (min 30 s).

### `removeTaskFromCalendar(taskId: string)`

Sends a delete message:

```typescript
window.webkit.messageHandlers.calendarSync.postMessage({
    action: "delete",
    taskId: taskId,
    callback: "__calendarSyncCallback",
});
```

### `purgeCalendarEvents()`

Sends a purge message that deletes all Nomendex calendars (and their events). Used by Force Sync before recreating events.

```typescript
window.webkit.messageHandlers.calendarSync.postMessage({
    action: "purge",
    callback: "__calendarSyncCallback",
});
```

### `reconcileCalendar()`

Non-destructive. Asks Swift to dedupe duplicate events per `taskId` and returns the list of taskIds that still have an event.

```typescript
window.webkit.messageHandlers.calendarSync.postMessage({
    action: "reconcile",
    callback: "__calendarSyncCallback",
});
// callback receives: { success, error, taskIds: string[], removed: number }
```

All bridge functions:
- Resolve when Swift calls back, with a timeout guard (5 s single ops, 10 s reconcile, ≥30 s batch) to prevent dangling promises — Swift-side `sendResult` wraps the callback in a `typeof` check so a late reply after the timeout (e.g. first-run permission dialog) doesn't throw
- Are serialized on a shared `calendarSyncQueue` to prevent concurrent operations
- Are no-ops when `window.webkit.messageHandlers.calendarSync` is unavailable

## Swift Implementation

**File:** `mac-app/macos-host/Sources/CalendarManager.swift`

A singleton (`CalendarManager.shared`) that manages all EventKit operations:

```swift
class CalendarManager {
    static let shared = CalendarManager()
    private let eventStore = EKEventStore()
    private let calendarTitle = "Nomendex Tasks"
}
```

### Methods

| Method | Description |
|--------|-------------|
| `syncTask(_:webView:callback:)` | Entry point — routes to upsert/upsertBatch/delete/purge/reconcile on `syncQueue` |
| `requestAccess(completion:)` | Requests calendar permission (macOS 14+ API) |
| `getOrCreateCalendar(projectName:)` | Finds or creates a Nomendex calendar |
| `nomendexEventsPredicate()` | Shared lookup window for all event queries (see Lookup Window below) |
| `upsertEvent(taskData:webView:callback:)` | Single upsert — `applyUpsert` + immediate commit |
| `upsertEventBatch(taskData:webView:callback:)` | Applies all upserts with commit deferred, then one `commit()` |
| `applyUpsert(taskData:commit:)` | Core upsert shared by single/batch (cache-first lookup, dedup, calendar moves) |
| `deleteEvent(taskData:webView:callback:)` | Removes event by task ID lookup; early-returns without scanning when the task is in neither `eventIdentifierCache` nor `knownEventStates` |
| `purgeOrphanedEvents(taskData:webView:callback:)` | Deletes and recreates all Nomendex calendars (force sync) while preserving calendar colors |
| `reconcileEvents(taskData:webView:callback:)` | Deduplicates events per `taskId`, returns live taskIds to JS |
| `findEvent(taskId:)` | Looks up event by cached identifier or `nomendex://task/{id}` URL (cleans up duplicates on fallback) |
| `findAllEvents(taskId:)` | Scans Nomendex calendars and returns all events whose URL matches the task |
| `pickKeeper(_:)` | Chooses the canonical event among duplicates (cached identifier wins; otherwise oldest `creationDate`) |
| `detectChanges()` | Compares calendar state to snapshot, dedupes on-the-fly, confirms deletions, sends changes to JS |
| `liveEvent(taskId:)` | Authoritative single-event lookup by cached identifier — not limited by window or calendar visibility |
| `isWithinLookupWindow(_:)` | Whether a known event's absence can legitimately mean deletion |
| `scheduleDeletionRecheck()` | Re-runs detection after the grace period so pending deletions converge |
| `reportSuspectedBulkDeletion(taskIds:webView:)` | Warns the app about an implausible mass disappearance instead of applying it |
| `formatScheduledEnd(_:isAllDay:)` | Formats an event end for Nomendex, undoing the exclusive all-day end |

### Lookup Window

`EKEventStore.predicateForEvents` silently truncates ranges longer than **four years to the first four years** — a former ±5y window evaluated as `[now-5y, now-1y]` and missed every current event, so upserts kept creating duplicates that `detectChanges` then cleaned up (constant create+delete churn). All event queries (snapshot, change detection, find, reconcile) now share `nomendexEventsPredicate()` with a single `[now − 365 d, now + 1095 d]` window (1460 days, under the limit). Events scheduled outside that window are not reachable by sync.

### Incoming Deletions

EventKit has no deletion callback, so "the event is gone" can only ever be inferred from its **absence** in a scan — and a scan lies. It returns partial or empty results while an iCloud source resyncs, it only sees calendars currently visible under the `Nomendex` title prefix, and it cannot see events outside the [lookup window](#lookup-window) at all. On 2026-08-27 one false-empty scan deleted 12 event todos permanently.

A deletion now has to clear four gates before it reaches the app:

1. **Per-event lookup** — `liveEvent(taskId:)` re-checks the cached `eventIdentifier` via `eventStore.event(withIdentifier:)`. Unlike `events(matching:)` it is bound neither by the window nor by which calendars the scan saw, so a hit proves the scan was wrong; the event is kept and diffed normally.
2. **Window check** — `isWithinLookupWindow` rejects tasks whose dates sit at or beyond the window edges. Without it, an event simply aging past the `now − 365 d` bound (or dragged past `now + 1095 d` in Calendar.app) reads as a deletion and destroys the todo on a boundary crossing.
3. **Grace period** — the task must stay unresolvable across passes for `deletionGraceInterval` (120 s), tracked in `missingSince`. Since `EKEventStoreChanged` may never fire again, `scheduleDeletionRecheck()` re-runs detection once after the grace period so genuine deletions still converge (typical latency ~2 min).
4. **Blast-radius cap** — more than `max(3, knownEventStates.count / 2)` confirmed deletions in one pass is treated as a bad read, not intent. Nothing is applied; the taskIds go to `window.__onCalendarBulkDeletionSuspected` and the user gets a warning toast. Re-sent only when the suspected set changes, so repeated calendar changes don't spam.

Everything held back stays in `knownEventStates` (`survivors`), so those todos keep syncing normally once the calendar recovers.

On the web side, `calendar-change-bridge.ts` repeats the cap independently (`MAX_DELETIONS_PER_BATCH = 3`) — it ships with every app update, while the native host only ships with a rebuild — and its `CalendarTodosAPI` has **no delete method at all**. Deletions that cleared the gates above arrive flagged `confirmed: true` and skip the web cap (the host already applied a proportional one); an older host sends bare deletions, and those stay capped at 3 per batch. What a confirmed deletion does:

| Todo kind | Effect |
|-----------|--------|
| `task` | Unscheduled — `scheduledStart`/`scheduledEnd` cleared, reminder preset reset. Todo survives. |
| `event` | **Archived** (`archived: true`), the app's own way to retire an event (its status can't be changed). Dates are kept and the todo stays recoverable in the Archived view. |

Never make incoming sync call `deleteTodo`. The signal it acts on is an inference, and an inference must not be able to destroy user data.

### Thread Safety

All `EKEventStore`, `ignoredTaskIDs`, `knownEventStates`, and `eventIdentifierCache` access is serialized on a single `syncQueue` (serial `DispatchQueue`). This includes:
- `upsertEvent` / `deleteEvent` / `purgeOrphanedEvents` (dispatched from `syncTask`)
- `detectChanges` (dispatched from `EKEventStoreChanged` notification)
- `snapshotCurrentEvents` (dispatched from `startObserving`)

Only `evaluateJavaScript` and `sendResult` dispatch to `.main` (required by WKWebView).

### Event Identifier Cache

`eventIdentifierCache: [String: String]` maps `taskId` to `EKEvent.eventIdentifier`. This provides reliable event lookups without depending on `events(matching:)` (which may not work with write-only calendar access). The cache is:
- Populated at startup from `snapshotCurrentEvents`
- Updated after each `eventStore.save()` (for batch upserts: after the final `commit()`, identifiers aren't stable before it)
- Consulted first by `applyUpsert` and `findEvent` — a hit (with matching `nomendex://task/` URL) skips the full calendar scan
- Used with `knownEventStates` as a negative cache by `deleteEvent`: a task in neither has no event, so the delete is a no-op without a scan (this is the hot path — every update of a todo without scheduled dates triggers a bridge delete)
- Cleared on purge, and per-task after a successful delete
- Cleared on `startObserving` (workspace switch) — previous-workspace identifiers must not leak

### Duplicate Handling

iCloud/CalDAV round-trips, multi-device races, and lost `url` fields can leave multiple events pointing at the same `taskId`. Every path that enumerates Nomendex events now dedupes:

- `snapshotCurrentEvents` and `detectChanges` group matches by `taskId`, keep one via `pickKeeper`, and `eventStore.remove` the rest.
- `upsertEvent` runs `findAllEvents` before save, dedupes if needed, and if the keeper lives in a different calendar than the target (e.g. after a project assignment change), removes the old event and creates a fresh one — in-place `event.calendar` reassignment is unreliable across source boundaries (local ↔ iCloud).
- `reconcileEvents` performs the same dedup and reports `{ taskIds, removed }` to the JS side, which then upserts live todos and removes orphans.

### Echo Suppression (`ignoredTaskIDs`)

`ignoredTaskIDs` is populated before every self-originated `save`/`remove` so the resulting `EKEventStoreChanged` notification doesn't bounce back as an inbound change. `detectChanges` clears entries while iterating `knownEventStates` **and** when it sees a new `taskId` in `currentMap` that wasn't in the previous snapshot (first-time upserts); otherwise an entry could leak and silently drop the next genuine external change for that task.

During purge:
- calendar colors are captured before delete
- matching recreated calendars receive original `cgColor`

## Enable/Disable Toggle

Apple Calendar sync can be toggled per workspace in **Settings → Apple Calendar Sync**. The setting is stored as `appleCalendarSync: boolean` in `workspace.json` (defaults to `true`).

When disabled:
- `syncTaskToCalendar` and `removeTaskFromCalendar` calls in `useTodoEvents` are skipped.
- The incoming calendar change listener is unregistered — `initCalendarChangeListener` returns a dispose fn that the `useTodoEvents` effect cleanup calls, so toggling off takes effect immediately (no reload needed).
- No data is deleted from Calendar.app — the toggle only gates future sync activity.

Source: `bun-sidecar/src/hooks/useTodoEvents.ts`, `bun-sidecar/src/pages/SettingsPage.tsx`.

## Permissions

- macOS prompts **"Nomendex would like to access your calendar"** on first sync
- Configurable in **System Settings → Privacy & Security → Calendars**
- Required entries in `Info.plist`:
  - `NSCalendarsUsageDescription`
  - `NSCalendarsFullAccessUsageDescription`
- Required entitlements: 
  - `com.apple.security.personal-information.calendars`

## File Structure

### Swift (mac-app)

```
mac-app/macos-host/
├── Sources/
│   ├── CalendarManager.swift           # EventKit integration
│   └── WebViewWindowController.swift   # calendarSync message handler
├── entitlements.plist                   # Calendar entitlement
├── Info.plist                           # Calendar usage descriptions
├── build_host_app.sh                   # CalendarManager.swift + EventKit framework
└── package_app.sh                      # Codesign with entitlements
```

### TypeScript (bun-sidecar)

```
bun-sidecar/src/features/todos/
├── calendar-bridge.ts        # WebKit bridge with serialized queue
├── calendar-change-bridge.ts # Incoming sync handler (Calendar.app → Nomendex)
└── browser-view.tsx          # Sync calls after save/delete/drag-drop

bun-sidecar/src/hooks/
└── useTheme.tsx         # calendarSync in WebKitMessageHandlers type
```
