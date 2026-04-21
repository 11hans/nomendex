import EventKit
import WebKit
import Foundation

class CalendarManager {
    static let shared = CalendarManager()

    private let eventStore = EKEventStore()
    private let defaultCalendarTitle = "Nomendex Tasks"
    private let calendarPrefix = "Nomendex"
    private let syncQueue = DispatchQueue(label: "com.nomendex.calendar-sync")

    private init() {}

    // MARK: - Change Observation

    private weak var webViewRef: WKWebView?
    private var changeObserver: NSObjectProtocol?
    private var knownEventStates: [String: EventState] = [:]  // taskId -> snapshot
    private var ignoredTaskIDs: Set<String> = []
    private var eventIdentifierCache: [String: String] = [:]  // taskId -> EKEvent.eventIdentifier

    struct EventState {
        let title: String
        let startDate: Date?
        let endDate: Date?
        let isAllDay: Bool
    }

    func startObserving(webView: WKWebView) {
        self.webViewRef = webView

        // Remove existing observer if any
        if let existing = changeObserver {
            NotificationCenter.default.removeObserver(existing)
        }

        // Clear stale caches — workspace may have switched, identifiers from
        // a previous workspace must not leak into the new one.
        syncQueue.async { [weak self] in
            self?.eventIdentifierCache.removeAll()
            self?.knownEventStates.removeAll()
            self?.ignoredTaskIDs.removeAll()
        }

        // Initial snapshot
        snapshotCurrentEvents()

        changeObserver = NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: nil
        ) { [weak self] _ in
            // Dispatch to syncQueue so all eventStore and ignoredTaskIDs access
            // happens on a single serial queue, preventing data races
            self?.syncQueue.async {
                self?.detectChanges()
            }
        }

        log("Started observing calendar changes")
    }

    private func snapshotCurrentEvents() {
        syncQueue.async { [weak self] in
            guard let self = self else { return }
            let nomendexCalendars = self.getNomendexCalendars()
            guard !nomendexCalendars.isEmpty else { return }
            let start = Date().addingTimeInterval(-365 * 24 * 3600)
            let end = Date().addingTimeInterval(365 * 24 * 3600)
            let predicate = self.eventStore.predicateForEvents(withStart: start, end: end, calendars: nomendexCalendars)
            let events = self.eventStore.events(matching: predicate)

            // Group by taskId so we can detect and clean up duplicates.
            var grouped: [String: [EKEvent]] = [:]
            for event in events {
                if let url = event.url?.absoluteString, url.hasPrefix("nomendex://task/") {
                    let taskId = String(url.dropFirst("nomendex://task/".count))
                    grouped[taskId, default: []].append(event)
                }
            }

            var newState: [String: EventState] = [:]
            for (taskId, matches) in grouped {
                let keeper = self.pickKeeper(matches)
                // Remove duplicates — iCloud/CalDAV can occasionally leave extras,
                // and multi-device races produce parallel events for the same task.
                if matches.count > 1 {
                    log("snapshot: found \(matches.count) events for task \(taskId), removing \(matches.count - 1) duplicate(s)")
                    for duplicate in matches where duplicate != keeper {
                        try? self.eventStore.remove(duplicate, span: .thisEvent)
                    }
                }
                newState[taskId] = EventState(
                    title: keeper.title ?? "",
                    startDate: keeper.startDate,
                    endDate: keeper.endDate,
                    isAllDay: keeper.isAllDay
                )
                self.eventIdentifierCache[taskId] = keeper.eventIdentifier
            }
            self.knownEventStates = newState
        }
    }

    /// Picks the canonical event among duplicates. Preference order:
    /// 1. The event whose identifier is already in our cache (stable for live tasks)
    /// 2. The earliest created event (oldest wins — later ones are likely iCloud artifacts)
    private func pickKeeper(_ events: [EKEvent]) -> EKEvent {
        precondition(!events.isEmpty)
        if let taskIdURL = events.first?.url?.absoluteString,
           taskIdURL.hasPrefix("nomendex://task/") {
            let taskId = String(taskIdURL.dropFirst("nomendex://task/".count))
            if let cachedId = eventIdentifierCache[taskId],
               let cachedMatch = events.first(where: { $0.eventIdentifier == cachedId }) {
                return cachedMatch
            }
        }
        return events.min(by: { (a, b) in
            let aDate = a.creationDate ?? .distantFuture
            let bDate = b.creationDate ?? .distantFuture
            return aDate < bDate
        }) ?? events[0]
    }

    /// Returns all events across Nomendex calendars whose URL points to the given task.
    private func findAllEvents(taskId: String) -> [EKEvent] {
        let nomendexCalendars = getNomendexCalendars()
        guard !nomendexCalendars.isEmpty else { return [] }
        let start = Date().addingTimeInterval(-5 * 365 * 24 * 3600)
        let end = Date().addingTimeInterval(5 * 365 * 24 * 3600)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nomendexCalendars)
        let events = eventStore.events(matching: predicate)
        let targetURL = URL(string: "nomendex://task/\(taskId)")
        return events.filter { $0.url == targetURL }
    }

    private func detectChanges() {
        guard let webView = webViewRef else { return }
        // Reset store to ensure we get fresh data after EKEventStoreChanged
        eventStore.reset()
        let nomendexCalendars = getNomendexCalendars()
        guard !nomendexCalendars.isEmpty else { return }

        let start = Date().addingTimeInterval(-365 * 24 * 3600)
        let end = Date().addingTimeInterval(365 * 24 * 3600)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nomendexCalendars)
        let currentEvents = eventStore.events(matching: predicate)

        // Group by taskId so we can detect and clean up duplicates on-the-fly.
        var grouped: [String: [EKEvent]] = [:]
        for event in currentEvents {
            if let url = event.url?.absoluteString, url.hasPrefix("nomendex://task/") {
                let taskId = String(url.dropFirst("nomendex://task/".count))
                grouped[taskId, default: []].append(event)
            }
        }

        var currentMap: [String: (EKEvent, EventState)] = [:]
        for (taskId, matches) in grouped {
            let keeper = pickKeeper(matches)
            if matches.count > 1 {
                log("detectChanges: found \(matches.count) events for task \(taskId), removing \(matches.count - 1) duplicate(s)")
                for duplicate in matches where duplicate != keeper {
                    try? eventStore.remove(duplicate, span: .thisEvent)
                }
            }
            currentMap[taskId] = (keeper, EventState(
                title: keeper.title ?? "",
                startDate: keeper.startDate,
                endDate: keeper.endDate,
                isAllDay: keeper.isAllDay
            ))
            eventIdentifierCache[taskId] = keeper.eventIdentifier
        }

        var changesToSend: [[String: Any]] = []

        // Check for modified or deleted events
        for (taskId, oldState) in knownEventStates {
            if ignoredTaskIDs.contains(taskId) {
                ignoredTaskIDs.remove(taskId)
                continue
            }

            if let current = currentMap[taskId] {
                let newState = current.1

                var hasChanges = false
                var syncPayload: [String: Any] = ["taskId": taskId]

                if oldState.title != newState.title {
                    hasChanges = true
                    let cleanTitle = newState.title.hasPrefix("✅ ") ? String(newState.title.dropFirst(2)) : newState.title
                    syncPayload["title"] = cleanTitle
                }

                if oldState.startDate != newState.startDate || oldState.endDate != newState.endDate || oldState.isAllDay != newState.isAllDay {
                    hasChanges = true

                    if let formattedStart = formatScheduledDate(newState.startDate, isAllDay: newState.isAllDay) {
                        syncPayload["scheduledStart"] = formattedStart
                    } else {
                        syncPayload["scheduledStart"] = NSNull()
                    }

                    if let formattedEnd = formatScheduledDate(newState.endDate, isAllDay: newState.isAllDay) {
                        syncPayload["scheduledEnd"] = formattedEnd
                    } else {
                        syncPayload["scheduledEnd"] = NSNull()
                    }
                }

                if hasChanges {
                    changesToSend.append(syncPayload)
                }
            } else {
                // Event was deleted
                changesToSend.append([
                    "taskId": taskId,
                    "deleted": true
                ])
            }
        }

        // Update snapshot
        var nextState: [String: EventState] = [:]
        for (taskId, current) in currentMap {
            nextState[taskId] = current.1
            // Clear ignore entries for newly created events that weren't in
            // knownEventStates (the loop above only clears entries it iterates).
            // Without this, the echo-suppression entry for a first-time upsert
            // leaks and the next genuine external change is silently dropped.
            if knownEventStates[taskId] == nil {
                ignoredTaskIDs.remove(taskId)
            }
        }
        knownEventStates = nextState

        // Send to JS
        if !changesToSend.isEmpty {
            log("Detected calendar changes for \(changesToSend.count) tasks")
            do {
                let data = try JSONSerialization.data(withJSONObject: changesToSend)
                if let jsonString = String(data: data, encoding: .utf8) {
                    DispatchQueue.main.async {
                        let js = "if (window.__onCalendarChange) { window.__onCalendarChange(\(jsonString)); }"
                        webView.evaluateJavaScript(js, completionHandler: nil)
                    }
                }
            } catch {
                log("Failed to serialize calendar changes: \(error)")
            }
        }
    }

    // MARK: - Public API

    func syncTask(_ taskData: [String: Any], webView: WKWebView?, callback: String?) {
        requestAccess { granted in
            guard granted else {
                self.sendResult(webView: webView, callback: callback, success: false, error: "Calendar access denied")
                return
            }

            // Serialize upsert/delete on a dedicated queue to prevent concurrent
            // findEvent calls from both missing an existing event and creating duplicates
            self.syncQueue.async {
                let action = taskData["action"] as? String ?? "upsert"

                switch action {
                case "upsert":
                    self.upsertEvent(taskData: taskData, webView: webView, callback: callback)
                case "delete":
                    self.deleteEvent(taskData: taskData, webView: webView, callback: callback)
                case "purge":
                    self.purgeOrphanedEvents(taskData: taskData, webView: webView, callback: callback)
                case "reconcile":
                    self.reconcileEvents(taskData: taskData, webView: webView, callback: callback)
                default:
                    self.sendResult(webView: webView, callback: callback, success: false, error: "Unknown action: \(action)")
                }
            }
        }
    }

    // MARK: - Access Request

    private func requestAccess(completion: @escaping (Bool) -> Void) {
        if #available(macOS 14.0, *) {
            eventStore.requestFullAccessToEvents { granted, error in
                if let error = error {
                    log("Calendar access error: \(error)")
                }
                completion(granted)
            }
        } else {
            eventStore.requestAccess(to: .event) { granted, error in
                if let error = error {
                    log("Calendar access error: \(error)")
                }
                completion(granted)
            }
        }
    }

    // MARK: - Calendar

    /// Returns all calendars whose title starts with "Nomendex"
    private func getNomendexCalendars() -> [EKCalendar] {
        return eventStore.calendars(for: .event).filter { $0.title.hasPrefix(calendarPrefix) }
    }

    /// Get or create a calendar for a specific project, or the default "Nomendex Tasks" calendar
    private func getOrCreateCalendar(projectName: String? = nil) -> EKCalendar? {
        let title: String
        if let name = projectName, !name.isEmpty {
            title = "\(calendarPrefix) - \(name)"
        } else {
            title = defaultCalendarTitle
        }

        // Look for existing calendar
        let calendars = eventStore.calendars(for: .event)
        if let existing = calendars.first(where: { $0.title == title }) {
            return existing
        }

        // Create new calendar
        let calendar = EKCalendar(for: .event, eventStore: eventStore)
        calendar.title = title

        // Use the default calendar source or iCloud
        if let defaultSource = eventStore.defaultCalendarForNewEvents?.source {
            calendar.source = defaultSource
        } else if let localSource = eventStore.sources.first(where: { $0.sourceType == .local }) {
            calendar.source = localSource
        } else {
            log("No calendar source available")
            return nil
        }

        do {
            try eventStore.saveCalendar(calendar, commit: true)
            log("Created calendar: \(title)")
            return calendar
        } catch {
            log("Failed to create calendar: \(error)")
            return nil
        }
    }

    // MARK: - Upsert Event

    private func upsertEvent(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        let projectName = taskData["projectName"] as? String

        guard let calendar = getOrCreateCalendar(projectName: projectName) else {
            sendResult(webView: webView, callback: callback, success: false, error: "Cannot create calendar")
            return
        }

        guard let taskId = taskData["taskId"] as? String,
              let title = taskData["title"] as? String else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing taskId or title")
            return
        }

        // Find (and dedupe) existing events for this task. Multi-device iCloud
        // races or lost-URL round-trips can leave multiple events for one task
        // — clean them up opportunistically on every upsert.
        let existing = findAllEvents(taskId: taskId)
        var keeper: EKEvent? = nil
        if !existing.isEmpty {
            let picked = pickKeeper(existing)
            if existing.count > 1 {
                log("upsert: found \(existing.count) events for task \(taskId), removing \(existing.count - 1) duplicate(s)")
                for duplicate in existing where duplicate != picked {
                    ignoredTaskIDs.insert(taskId)
                    try? eventStore.remove(duplicate, span: .thisEvent)
                }
            }
            keeper = picked
        }

        // If the kept event lives in a different calendar than the target
        // (e.g. project assignment changed), recreate it. EKEvent.calendar
        // reassignment between sources (local ↔ iCloud) is unreliable.
        if let current = keeper, current.calendar != calendar {
            log("upsert: task \(taskId) moving calendar \(current.calendar?.title ?? "?") → \(calendar.title), recreating")
            ignoredTaskIDs.insert(taskId)
            try? eventStore.remove(current, span: .thisEvent)
            eventIdentifierCache.removeValue(forKey: taskId)
            keeper = nil
        }

        let event = keeper ?? EKEvent(eventStore: eventStore)
        event.calendar = calendar

        // Clear existing alarms to avoid duplicates
        event.alarms?.forEach { event.removeAlarm($0) }

        // Status prefix
        let status = taskData["status"] as? String
        if status == "done" {
            let cleanTitle = title.hasPrefix("✅ ") ? String(title.dropFirst(2)) : title
            event.title = "✅ " + cleanTitle
        } else {
            let cleanTitle = title.hasPrefix("✅ ") ? String(title.dropFirst(2)) : title
            event.title = cleanTitle
        }

        // Notes / description
        if let description = taskData["description"] as? String, !description.isEmpty {
            event.notes = description
        }

        // Parse dates (scheduled fields preferred)
        let scheduledStart = taskData["scheduledStart"] as? String
        let scheduledEnd = taskData["scheduledEnd"] as? String
        let duration = taskData["duration"] as? Int ?? 60

        var start: Date?
        var end: Date?
        var isAllDay = false

        if let scheduledStart = scheduledStart, let parsed = parseISO(scheduledStart) {
            start = parsed
            isAllDay = !scheduledStart.contains("T")
        }

        if let scheduledEnd = scheduledEnd, let parsed = parseISO(scheduledEnd) {
            end = parsed
            if start == nil {
                start = parsed
                isAllDay = !scheduledEnd.contains("T")
            }
        }

        if let start = start {
            event.startDate = start
            if let end = end {
                // EKEvent all-day events use exclusive end dates, so add 1 day to make
                // the range inclusive. E.g. Mar 15–17 needs endDate = Mar 18 midnight.
                event.endDate = isAllDay ? end.addingTimeInterval(86400) : end
            } else if isAllDay {
                event.endDate = start.addingTimeInterval(86400)
            } else {
                event.endDate = start.addingTimeInterval(TimeInterval(duration * 60))
            }
            event.isAllDay = isAllDay
        } else {
            // No dates — nothing to sync
            sendResult(webView: webView, callback: callback, success: true, error: nil)
            return
        }

        // Add reminder alarms based on preset (only for timed events)
        let reminderPreset = taskData["calendarReminderPreset"] as? String ?? "none"
        if reminderPreset == "30-15" && !isAllDay {
            event.addAlarm(EKAlarm(relativeOffset: -1800)) // 30 min before
            event.addAlarm(EKAlarm(relativeOffset: -900))  // 15 min before
        }

        // Store task ID in event URL for lookup
        event.url = URL(string: "nomendex://task/\(taskId)")

        // Prevent echo
        ignoredTaskIDs.insert(taskId)

        do {
            try eventStore.save(event, span: .thisEvent)
            // Cache the identifier for reliable lookups in subsequent syncs
            eventIdentifierCache[taskId] = event.eventIdentifier
            log("Saved calendar event for task: \(taskId)")
            sendResult(webView: webView, callback: callback, success: true, error: nil)
        } catch {
            log("Failed to save event: \(error)")
            sendResult(webView: webView, callback: callback, success: false, error: error.localizedDescription)
        }
    }

    // MARK: - Delete Event

    private func deleteEvent(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        guard let taskId = taskData["taskId"] as? String else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing taskId")
            return
        }

        if let event = findEvent(taskId: taskId) {
            // Prevent echo
            ignoredTaskIDs.insert(taskId)
            do {
                try eventStore.remove(event, span: .thisEvent)
                log("Deleted calendar event for task: \(taskId)")
            } catch {
                log("Failed to delete event: \(error)")
            }
        }

        sendResult(webView: webView, callback: callback, success: true, error: nil)
    }

    // MARK: - Purge Orphaned Events

    /// Removes ALL events from Nomendex calendars, preserving calendar colors.
    /// Called before a force sync to wipe the slate clean and recreate from scratch.
    private func purgeOrphanedEvents(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        let nomendexCalendars = getNomendexCalendars()

        guard !nomendexCalendars.isEmpty else {
            sendResult(webView: webView, callback: callback, success: true, error: nil)
            return
        }

        // Save calendar colors before deletion so we can restore them after recreate
        var savedColors: [String: CGColor] = [:]
        for calendar in nomendexCalendars {
            savedColors[calendar.title] = calendar.cgColor
        }

        // Delete entire Nomendex calendars — this removes all events cleanly.
        // The calendars will be recreated by upsertEvent -> getOrCreateCalendar.
        for calendar in nomendexCalendars {
            do {
                try eventStore.removeCalendar(calendar, commit: true)
            } catch {
                log("Failed to remove calendar \(calendar.title): \(error)")
            }
        }

        // Recreate calendars with their original colors
        for (title, color) in savedColors {
            // Extract project name from title (e.g. "Nomendex - MyProject" -> "MyProject")
            let projectName: String? = title.hasPrefix("\(calendarPrefix) - ")
                ? String(title.dropFirst("\(calendarPrefix) - ".count))
                : nil

            if let calendar = getOrCreateCalendar(projectName: projectName) {
                calendar.cgColor = color
                do {
                    try eventStore.saveCalendar(calendar, commit: true)
                } catch {
                    log("Failed to restore color for calendar \(title): \(error)")
                }
            }
        }

        // Clear caches
        eventIdentifierCache.removeAll()
        knownEventStates.removeAll()
        ignoredTaskIDs.removeAll()

        log("Purged \(nomendexCalendars.count) Nomendex calendars (colors preserved)")
        sendResult(webView: webView, callback: callback, success: true, error: nil)
    }

    // MARK: - Helpers

    private func findEvent(taskId: String) -> EKEvent? {
        // Try cached eventIdentifier first (fast, reliable)
        if let cachedId = eventIdentifierCache[taskId],
           let event = eventStore.event(withIdentifier: cachedId) {
            return event
        }

        // Fall back to URL-based search
        let nomendexCalendars = getNomendexCalendars()
        guard !nomendexCalendars.isEmpty else { return nil }
        let start = Date().addingTimeInterval(-5 * 365 * 24 * 3600)
        let end = Date().addingTimeInterval(5 * 365 * 24 * 3600)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nomendexCalendars)
        let events = eventStore.events(matching: predicate)

        let targetURL = URL(string: "nomendex://task/\(taskId)")
        let matches = events.filter { $0.url == targetURL }

        guard let keeper = matches.first else { return nil }

        // Cache the identifier for future lookups
        eventIdentifierCache[taskId] = keeper.eventIdentifier

        // Clean up duplicates if any exist
        if matches.count > 1 {
            log("Found \(matches.count) duplicate events for task \(taskId), cleaning up")
            for duplicate in matches.dropFirst() {
                try? eventStore.remove(duplicate, span: .thisEvent)
            }
        }

        return keeper
    }

    private func formatScheduledDate(_ date: Date?, isAllDay: Bool) -> String? {
        guard let date = date else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = isAllDay ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm"
        return formatter.string(from: date)
    }

    private func parseISO(_ string: String) -> Date? {
        if string.contains("T") {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone.current
            return formatter.date(from: string)
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone.current
            return formatter.date(from: string)
        }
    }

    private func sendResult(webView: WKWebView?, callback: String?, success: Bool, error: String?, data: [String: Any]? = nil) {
        guard let callback = callback, let wv = webView else { return }

        var payload: [String: Any] = ["success": success]
        payload["error"] = error ?? NSNull()
        if let data = data {
            for (k, v) in data { payload[k] = v }
        }

        DispatchQueue.main.async {
            let jsonString: String
            do {
                let bytes = try JSONSerialization.data(withJSONObject: payload)
                jsonString = String(data: bytes, encoding: .utf8) ?? "{\"success\":false,\"error\":\"encode failed\"}"
            } catch {
                jsonString = "{\"success\":false,\"error\":\"encode failed\"}"
            }
            let js = "window.\(callback)(\(jsonString))"
            wv.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: - Reconcile

    /// Scans all Nomendex calendars, removes duplicate events per taskId, and
    /// returns the list of taskIds that have at least one event. The frontend
    /// can then remove orphans (events whose task no longer exists) and upsert
    /// live todos to refresh stale metadata — without the destructive purge.
    private func reconcileEvents(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        eventStore.reset()
        let nomendexCalendars = getNomendexCalendars()
        guard !nomendexCalendars.isEmpty else {
            sendResult(webView: webView, callback: callback, success: true, error: nil, data: ["taskIds": [] as [String], "removed": 0])
            return
        }

        let start = Date().addingTimeInterval(-5 * 365 * 24 * 3600)
        let end = Date().addingTimeInterval(5 * 365 * 24 * 3600)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nomendexCalendars)
        let events = eventStore.events(matching: predicate)

        var grouped: [String: [EKEvent]] = [:]
        for event in events {
            if let url = event.url?.absoluteString, url.hasPrefix("nomendex://task/") {
                let taskId = String(url.dropFirst("nomendex://task/".count))
                grouped[taskId, default: []].append(event)
            }
        }

        var removed = 0
        var liveTaskIds: [String] = []
        for (taskId, matches) in grouped {
            let keeper = pickKeeper(matches)
            for duplicate in matches where duplicate != keeper {
                ignoredTaskIDs.insert(taskId)
                do {
                    try eventStore.remove(duplicate, span: .thisEvent)
                    removed += 1
                } catch {
                    log("reconcile: failed to remove duplicate for \(taskId): \(error)")
                }
            }
            eventIdentifierCache[taskId] = keeper.eventIdentifier
            liveTaskIds.append(taskId)
        }

        log("reconcile: \(liveTaskIds.count) tasks present, \(removed) duplicates removed")
        sendResult(webView: webView, callback: callback, success: true, error: nil, data: ["taskIds": liveTaskIds, "removed": removed])
    }
}
