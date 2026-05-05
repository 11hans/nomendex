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
CalendarManager.swift (detectChanges)
  ↓ evaluateJavaScript -> window.__onCalendarChange
calendar-change-bridge.ts (writes back `scheduledStart`/`scheduledEnd` plus deadline updates)
  ↓ todosAPI.updateTodo
FileDatabase (markdown updated)
```

## Sync Triggers

Calendar sync fires automatically on three events:

| Trigger | Action | Function |
|---------|--------|----------|
| Task save | Upsert calendar event | `syncTaskToCalendar(task)` |
| Drag-and-drop | Upsert with new status | `syncTaskToCalendar(task)` |
| Task delete | Remove calendar event | `removeTaskFromCalendar(taskId)` |

The bridge functions are no-ops when:
- Not running inside the native macOS app (no `window.webkit`)
- Task has no `scheduledStart` and no `scheduledEnd`

### Manual Sync

Two commands are available in the Command Palette (`Cmd+K`):

- **"Reconcile Calendar"** — non-destructive. Deduplicates events per `taskId` across all Nomendex calendars, removes orphans (events whose task no longer exists), and upserts all live todos to refresh their metadata. Use this as the first fix when duplicates appear.
- **"Force Sync All to Calendar"** — destructive. Wipes and recreates all Nomendex calendars from scratch. Use after bulk imports or when Reconcile isn't enough.

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
| All-day events | Created when task has date only (no time) |
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

All three functions:
- Return a `Promise<void>` that resolves when Swift calls back
- Have a 5-second timeout to prevent dangling promises
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
| `syncTask(_:webView:callback:)` | Entry point — routes to upsert/delete/purge/reconcile on `syncQueue` |
| `requestAccess(completion:)` | Requests calendar permission (macOS 14+ API) |
| `getOrCreateCalendar(projectName:)` | Finds or creates a Nomendex calendar |
| `upsertEvent(taskData:webView:callback:)` | Creates or updates a calendar event (dedups and handles calendar moves) |
| `deleteEvent(taskData:webView:callback:)` | Removes event by task ID lookup |
| `purgeOrphanedEvents(taskData:webView:callback:)` | Deletes and recreates all Nomendex calendars (force sync) while preserving calendar colors |
| `reconcileEvents(taskData:webView:callback:)` | Deduplicates events per `taskId`, returns live taskIds to JS |
| `findEvent(taskId:)` | Looks up event by cached identifier or `nomendex://task/{id}` URL (cleans up duplicates on fallback) |
| `findAllEvents(taskId:)` | Scans Nomendex calendars and returns all events whose URL matches the task |
| `pickKeeper(_:)` | Chooses the canonical event among duplicates (cached identifier wins; otherwise oldest `creationDate`) |
| `detectChanges()` | Compares calendar state to snapshot, dedupes on-the-fly, sends changes to JS |

### Thread Safety

All `EKEventStore`, `ignoredTaskIDs`, `knownEventStates`, and `eventIdentifierCache` access is serialized on a single `syncQueue` (serial `DispatchQueue`). This includes:
- `upsertEvent` / `deleteEvent` / `purgeOrphanedEvents` (dispatched from `syncTask`)
- `detectChanges` (dispatched from `EKEventStoreChanged` notification)
- `snapshotCurrentEvents` (dispatched from `startObserving`)

Only `evaluateJavaScript` and `sendResult` dispatch to `.main` (required by WKWebView).

### Event Identifier Cache

`eventIdentifierCache: [String: String]` maps `taskId` to `EKEvent.eventIdentifier`. This provides reliable event lookups without depending on `events(matching:)` (which may not work with write-only calendar access). The cache is:
- Populated at startup from `snapshotCurrentEvents`
- Updated after each `eventStore.save()`
- Cleared on purge
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
- Incoming calendar change listener (`useEffect` in `useTodoEvents`) is not registered.
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
