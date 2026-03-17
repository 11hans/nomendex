# Apple Calendar & Reminders Integration (EventKit)

Tasks with dates and priorities are automatically synced to Apple Calendar and Apple Reminders via the native EventKit framework.

## Overview

1. **Apple Calendar**: When a user saves, moves, or deletes a task that has dates, the app syncs the corresponding event to Apple Calendar under a dedicated **"Nomendex Tasks"** calendar. It also features **Two-Way Sync**, where changes made directly in Calendar.app (e.g. moving or deleting events) are reflected back to Nomendex.
2. **Apple Reminders**: Tasks with a priority of **high** or **medium** are automatically synced to a dedicated "Nomendex Tasks" list in Apple Reminders, complete with alarms. It also features **Two-Way Sync**, where completing a task in Reminders.app marks it as done in Nomendex, and changing its title or due date updates the markdown file as well.

The integration is macOS-only, using the `WKScriptMessageHandler` bridge pattern for outgoing sync and `evaluateJavaScript` for incoming sync. Outgoing sync builds events from `scheduledStart`/`scheduledEnd`, while `dueDate` is preserved as the deadline metadata (overdue logic lives in Nomendex, not the calendar).

## Architecture

### Outgoing Sync (Nomendex → EventKit)
```
React UI (browser-view.tsx)
  ↓ save / delete / drag-drop
calendar-bridge.ts / reminder-bridge.ts
  ↓ window.webkit.messageHandlers.[calendarSync|reminderSync].postMessage()
WebViewWindowController.swift (WKScriptMessageHandler)
  ↓ dispatch
CalendarManager.swift / ReminderManager.swift (EventKit)
  ↓ EKEventStore.save() / .remove()
Apple Calendar.app / Apple Reminders.app
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

### Manual Sync (Force Sync)

Users can manually trigger a full synchronization of all tasks that have dates configured. This is especially useful after importing tasks or making bulk changes outside of the Nomendex UI.

- Open **Command Palette** (`Cmd+K`)
- Run **"Force Sync All to Calendar"**

Force sync performs a **delete-and-recreate** cycle:
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
| High priority | 🔴 Alarm 15 minutes before |
| Medium priority | 🟡 Alarm 30 minutes before |
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
| `syncTask(_:webView:callback:)` | Entry point — routes to upsert/delete/purge on `syncQueue` |
| `requestAccess(completion:)` | Requests calendar permission (macOS 14+ API) |
| `getOrCreateCalendar(projectName:)` | Finds or creates a Nomendex calendar |
| `upsertEvent(taskData:webView:callback:)` | Creates or updates a calendar event |
| `deleteEvent(taskData:webView:callback:)` | Removes event by task ID lookup |
| `purgeOrphanedEvents(taskData:webView:callback:)` | Deletes and recreates all Nomendex calendars (force sync) while preserving calendar colors |
| `findEvent(taskId:)` | Looks up event by cached identifier or `nomendex://task/{id}` URL |
| `detectChanges()` | Compares calendar state to snapshot, sends changes to JS |

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

During purge:
- calendar colors are captured before delete
- matching recreated calendars receive original `cgColor`

## Permissions

- macOS prompts **"Nomendex would like to access your calendar"** and **"Nomendex would like to access your reminders"** on first sync
- Configurable in **System Settings → Privacy & Security → Calendars / Reminders**
- Required entries in `Info.plist`:
  - `NSCalendarsUsageDescription`
  - `NSCalendarsFullAccessUsageDescription`
  - `NSRemindersUsageDescription`
  - `NSRemindersFullAccessUsageDescription`
- Required entitlements: 
  - `com.apple.security.personal-information.calendars`
  - `com.apple.security.personal-information.reminders`

## File Structure

### Swift (mac-app)

```
mac-app/macos-host/
├── Sources/
│   ├── CalendarManager.swift           # EventKit integration (new)
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
