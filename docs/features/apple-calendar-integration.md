# Apple Calendar & Reminders Integration (EventKit)

Tasks with dates and priorities are automatically synced to Apple Calendar and Apple Reminders via the native EventKit framework.

## Overview

1. **Apple Calendar**: When a user saves, moves, or deletes a task that has dates, the app syncs the corresponding event to Apple Calendar under a dedicated **"Nomendex Tasks"** calendar. It also features **Two-Way Sync**, where changes made directly in Calendar.app (e.g. moving or deleting events) are reflected back to Nomendex.
2. **Apple Reminders**: Tasks with a priority of **high** or **medium** are automatically synced to a dedicated "Nomendex Tasks" list in Apple Reminders, complete with alarms. It also features **Two-Way Sync**, where completing a task in Reminders.app marks it as done in Nomendex, and changing its title or due date updates the markdown file as well.

The integration is macOS-only, using the `WKScriptMessageHandler` bridge pattern for outgoing sync and `evaluateJavaScript` for incoming sync.

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
calendar-change-bridge.ts
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
- Task has no `dueDate` and no `startDate`

### Manual Sync (Force Sync)

Users can manually trigger a full synchronization of all tasks that have dates configured. This is especially useful after importing tasks or making bulk changes outside of the Nomendex UI.

- Open **Command Palette** (`Cmd+K`)
- Run **"Force Sync All to Calendar"**

This command fetches all tasks from the local storage and runs `syncTaskToCalendar(todo)` for each task containing a `startDate` or `dueDate`.

## Calendar Event Behavior

| Feature | Details |
|---------|---------|
| Calendar name | **Nomendex Tasks** (auto-created on first sync) |
| Event lookup | Via `nomendex://task/{id}` URL in `EKEvent.url` |
| All-day events | Created when task has date only (no time) |
| Timed events | Created when task has date + time |
| Time range | `startDate` → event start, `dueDate` → event end |
| Duration fallback | If only `dueDate` with time: start = due − duration (default 60 min) |
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

The Swift side handles both date formats:

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
    dueDate: task.dueDate,
    startDate: task.startDate,
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

Both functions:
- Return a `Promise<void>` that resolves when Swift calls back
- Have a 5-second timeout to prevent dangling promises
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
| `handleMessage(message:webView:)` | Entry point from WKScriptMessageHandler |
| `requestAccess(completion:)` | Requests calendar permission (macOS 14+ API) |
| `getOrCreateCalendar()` | Finds or creates the "Nomendex Tasks" calendar |
| `upsertEvent(taskData:webView:callback:)` | Creates or updates a calendar event |
| `deleteEvent(taskData:webView:callback:)` | Removes event by task ID lookup |
| `findEvent(taskId:in:)` | Looks up event by `nomendex://task/{id}` URL |
| `parseISO(_:)` | Parses both datetime and date-only strings |
| `sendResult(webView:callback:success:error:)` | Calls back to JS with result |

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
├── calendar-bridge.ts   # WebKit bridge with async callbacks (new)
└── browser-view.tsx     # Sync calls after save/delete/drag-drop

bun-sidecar/src/hooks/
└── useTheme.tsx         # calendarSync in WebKitMessageHandlers type
```
