import EventKit
import WebKit
import Foundation

class CalendarManager {
    static let shared = CalendarManager()
    
    private let eventStore = EKEventStore()
    private let calendarTitle = "Nomendex Tasks"
    
    private init() {}
    
    // MARK: - Change Observation
    
    private weak var webViewRef: WKWebView?
    private var changeObserver: NSObjectProtocol?
    private var knownEventStates: [String: EventState] = [:]  // taskId -> snapshot
    private var ignoreNextChangeForTaskID: String? = nil
    
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
        
        // Initial snapshot
        snapshotCurrentEvents()
        
        changeObserver = NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: .main
        ) { [weak self] _ in
            self?.detectChanges()
        }
        
        log("Started observing calendar changes")
    }
    
    private func snapshotCurrentEvents() {
        guard let calendar = getOrCreateCalendar() else { return }
        let start = Date().addingTimeInterval(-365 * 24 * 3600)
        let end = Date().addingTimeInterval(365 * 24 * 3600)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: [calendar])
        let events = eventStore.events(matching: predicate)
        
        var newState: [String: EventState] = [:]
        for event in events {
            if let url = event.url?.absoluteString, url.hasPrefix("nomendex://task/") {
                let taskId = String(url.dropFirst("nomendex://task/".count))
                newState[taskId] = EventState(
                    title: event.title ?? "",
                    startDate: event.startDate,
                    endDate: event.endDate,
                    isAllDay: event.isAllDay
                )
            }
        }
        knownEventStates = newState
    }
    
    private func detectChanges() {
        guard let calendar = getOrCreateCalendar(), let webView = webViewRef else { return }
        
        let start = Date().addingTimeInterval(-365 * 24 * 3600)
        let end = Date().addingTimeInterval(365 * 24 * 3600)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: [calendar])
        let currentEvents = eventStore.events(matching: predicate)
        
        var currentMap: [String: (EKEvent, EventState)] = [:]
        for event in currentEvents {
            if let url = event.url?.absoluteString, url.hasPrefix("nomendex://task/") {
                let taskId = String(url.dropFirst("nomendex://task/".count))
                currentMap[taskId] = (event, EventState(
                    title: event.title ?? "",
                    startDate: event.startDate,
                    endDate: event.endDate,
                    isAllDay: event.isAllDay
                ))
            }
        }
        
        var changesToSend: [[String: Any]] = []
        
        // Check for modified or deleted events
        for (taskId, oldState) in knownEventStates {
            // Skip detection if we just updated this task from Nomendex
            if taskId == ignoreNextChangeForTaskID {
                ignoreNextChangeForTaskID = nil
                continue
            }
            
            if let current = currentMap[taskId] {
                let newState = current.1
                let event = current.0
                
                var hasChanges = false
                var syncPayload: [String: Any] = ["taskId": taskId]
                
                if oldState.title != newState.title {
                    hasChanges = true
                    let cleanTitle = newState.title.hasPrefix("✅ ") ? String(newState.title.dropFirst(2)) : newState.title
                    syncPayload["title"] = cleanTitle
                }
                
                if oldState.startDate != newState.startDate || oldState.endDate != newState.endDate || oldState.isAllDay != newState.isAllDay {
                    hasChanges = true
                    
                    let formatter = DateFormatter()
                    formatter.locale = Locale(identifier: "en_US_POSIX")
                    formatter.timeZone = TimeZone.current // Added timezone
                    
                    if let date = newState.startDate {
                        formatter.dateFormat = newState.isAllDay ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm"
                        syncPayload["startDate"] = formatter.string(from: date)
                    } else {
                        syncPayload["startDate"] = NSNull()
                    }
                    
                    if let date = newState.endDate {
                        formatter.dateFormat = newState.isAllDay ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm"
                        syncPayload["dueDate"] = formatter.string(from: date)
                    } else {
                        syncPayload["dueDate"] = NSNull()
                    }
                }
                
                if hasChanges {
                    changesToSend.append(syncPayload)
                }
            } else {
                // Event was deleted
                if taskId == ignoreNextChangeForTaskID {
                    ignoreNextChangeForTaskID = nil
                    continue
                }
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
            
            let action = taskData["action"] as? String ?? "upsert"
            
            switch action {
            case "upsert":
                self.upsertEvent(taskData: taskData, webView: webView, callback: callback)
            case "delete":
                self.deleteEvent(taskData: taskData, webView: webView, callback: callback)
            default:
                self.sendResult(webView: webView, callback: callback, success: false, error: "Unknown action: \(action)")
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
    
    private func getOrCreateCalendar() -> EKCalendar? {
        // Look for existing calendar
        let calendars = eventStore.calendars(for: .event)
        if let existing = calendars.first(where: { $0.title == calendarTitle }) {
            return existing
        }
        
        // Create new calendar
        let calendar = EKCalendar(for: .event, eventStore: eventStore)
        calendar.title = calendarTitle
        calendar.cgColor = NSColor.systemBlue.cgColor
        
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
            log("Created calendar: \(calendarTitle)")
            return calendar
        } catch {
            log("Failed to create calendar: \(error)")
            return nil
        }
    }
    
    // MARK: - Upsert Event
    
    private func upsertEvent(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        guard let calendar = getOrCreateCalendar() else {
            sendResult(webView: webView, callback: callback, success: false, error: "Cannot create calendar")
            return
        }
        
        guard let taskId = taskData["taskId"] as? String,
              let title = taskData["title"] as? String else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing taskId or title")
            return
        }
        
        // Find existing event or create new one
        let event = findEvent(taskId: taskId, in: calendar) ?? EKEvent(eventStore: eventStore)
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
        
        // Parse dates
        let dueDate = taskData["dueDate"] as? String
        let startDate = taskData["startDate"] as? String
        let duration = taskData["duration"] as? Int ?? 60
        
        if let startDateStr = startDate, let start = parseISO(startDateStr) {
            event.startDate = start
            if let dueDateStr = dueDate, let end = parseISO(dueDateStr) {
                event.endDate = end
            } else {
                event.endDate = start.addingTimeInterval(TimeInterval(duration * 60))
            }
            event.isAllDay = !startDateStr.contains("T")
        } else if let dueDateStr = dueDate, let due = parseISO(dueDateStr) {
            if dueDateStr.contains("T") {
                // Time-specific: use due as end, calculate start from duration
                event.endDate = due
                event.startDate = due.addingTimeInterval(TimeInterval(-duration * 60))
                event.isAllDay = false
            } else {
                // All-day event
                event.startDate = due
                event.endDate = due
                event.isAllDay = true
            }
        } else {
            // No dates — nothing to sync
            sendResult(webView: webView, callback: callback, success: true, error: nil)
            return
        }
        
        // Priority → Calendar alarm (Disabled per user feedback)
        // if let priority = taskData["priority"] as? String { ... }
        
        // Store task ID in event URL for lookup
        event.url = URL(string: "nomendex://task/\(taskId)")
        
        // Prevent echo
        ignoreNextChangeForTaskID = taskId
        
        do {
            try eventStore.save(event, span: .thisEvent)
            log("Saved calendar event for task: \(taskId)")
            sendResult(webView: webView, callback: callback, success: true, error: nil)
        } catch {
            log("Failed to save event: \(error)")
            sendResult(webView: webView, callback: callback, success: false, error: error.localizedDescription)
        }
    }
    
    // MARK: - Delete Event
    
    private func deleteEvent(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        guard let calendar = getOrCreateCalendar() else {
            sendResult(webView: webView, callback: callback, success: true, error: nil)
            return
        }
        
        guard let taskId = taskData["taskId"] as? String else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing taskId")
            return
        }
        
        if let event = findEvent(taskId: taskId, in: calendar) {
            // Prevent echo
            ignoreNextChangeForTaskID = taskId
            do {
                try eventStore.remove(event, span: .thisEvent)
                log("Deleted calendar event for task: \(taskId)")
            } catch {
                log("Failed to delete event: \(error)")
            }
        }
        
        sendResult(webView: webView, callback: callback, success: true, error: nil)
    }
    
    // MARK: - Helpers
    
    private func findEvent(taskId: String, in calendar: EKCalendar) -> EKEvent? {
        let start = Date().addingTimeInterval(-365 * 24 * 3600)
        let end = Date().addingTimeInterval(365 * 24 * 3600)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: [calendar])
        let events = eventStore.events(matching: predicate)
        
        let targetURL = URL(string: "nomendex://task/\(taskId)")
        return events.first { $0.url == targetURL }
    }
    
    private func parseISO(_ string: String) -> Date? {
        if string.contains("T") {
            // "2025-02-16T14:00" → add seconds for ISO8601
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone.current
            return formatter.date(from: string)
        } else {
            // "2025-02-16"
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone.current
            return formatter.date(from: string)
        }
    }
    
    private func sendResult(webView: WKWebView?, callback: String?, success: Bool, error: String?) {
        guard let callback = callback, let wv = webView else { return }
        
        DispatchQueue.main.async {
            let errorStr = error.map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" } ?? "null"
            let js = "window.\(callback)({success: \(success), error: \(errorStr)})"
            wv.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
