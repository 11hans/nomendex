import EventKit
import WebKit
import Foundation

class ReminderManager {
    static let shared = ReminderManager()

    private let eventStore = EKEventStore()
    private let listTitle = "Nomendex Tasks"

    private init() {}

    // MARK: - Change Observation

    private weak var webViewRef: WKWebView?
    private var changeObserver: NSObjectProtocol?
    private var knownReminderStates: [String: ReminderState] = [:]
    private var ignoredTaskIDs: Set<String> = []
    private var isFetchingReminders = false

    struct ReminderState {
        let title: String
        let dueDateComponents: DateComponents?
        let isCompleted: Bool
    }

    func startObserving(webView: WKWebView) {
        self.webViewRef = webView

        // Remove existing observer if any
        if let existing = changeObserver {
            NotificationCenter.default.removeObserver(existing)
        }

        snapshotCurrentReminders()

        changeObserver = NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: .main
        ) { [weak self] _ in
            self?.detectChanges()
        }

        log("Started observing reminder changes")
    }

    private func snapshotCurrentReminders() {
        guard let list = getOrCreateList() else { return }

        let predicate = eventStore.predicateForReminders(in: [list])
        eventStore.fetchReminders(matching: predicate) { [weak self] reminders in
            guard let self = self, let reminders = reminders else { return }

            var newState: [String: ReminderState] = [:]
            for reminder in reminders {
                if let url = reminder.url?.absoluteString, url.hasPrefix("nomendex://task/") {
                    let taskId = String(url.dropFirst("nomendex://task/".count))
                    newState[taskId] = ReminderState(
                        title: reminder.title ?? "",
                        dueDateComponents: reminder.dueDateComponents,
                        isCompleted: reminder.isCompleted
                    )
                }
            }

            DispatchQueue.main.async {
                self.knownReminderStates = newState
            }
        }
    }

    private func detectChanges() {
        guard let list = getOrCreateList(), let webView = webViewRef else { return }

        // Prevent concurrent fetches
        if isFetchingReminders { return }
        isFetchingReminders = true

        let predicate = eventStore.predicateForReminders(in: [list])
        eventStore.fetchReminders(matching: predicate) { [weak self] currentReminders in
            guard let self = self else { return }

            defer {
                DispatchQueue.main.async {
                    self.isFetchingReminders = false
                }
            }

            guard let currentReminders = currentReminders else { return }

            var currentMap: [String: (EKReminder, ReminderState)] = [:]
            for reminder in currentReminders {
                if let url = reminder.url?.absoluteString, url.hasPrefix("nomendex://task/") {
                    let taskId = String(url.dropFirst("nomendex://task/".count))
                    currentMap[taskId] = (reminder, ReminderState(
                        title: reminder.title ?? "",
                        dueDateComponents: reminder.dueDateComponents,
                        isCompleted: reminder.isCompleted
                    ))
                }
            }

            var changesToSend: [[String: Any]] = []

            DispatchQueue.main.sync {
                for (taskId, oldState) in self.knownReminderStates {
                    if self.ignoredTaskIDs.contains(taskId) {
                        self.ignoredTaskIDs.remove(taskId)
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

                        if oldState.isCompleted != newState.isCompleted {
                            hasChanges = true
                            syncPayload["completed"] = newState.isCompleted
                        }

                        if oldState.dueDateComponents != newState.dueDateComponents {
                            hasChanges = true
                            let formatter = DateFormatter()
                            formatter.locale = Locale(identifier: "en_US_POSIX")

                            if let dc = newState.dueDateComponents, let date = dc.date {
                                if dc.hour == nil {
                                    formatter.dateFormat = "yyyy-MM-dd"
                                    formatter.timeZone = TimeZone.current
                                    syncPayload["dueDate"] = formatter.string(from: date)
                                } else {
                                    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
                                    formatter.timeZone = TimeZone.current
                                    syncPayload["dueDate"] = formatter.string(from: date)
                                }
                            }
                        }

                        if hasChanges {
                            changesToSend.append(syncPayload)
                        }
                    } else {
                        // Reminder was deleted
                        changesToSend.append([
                            "taskId": taskId,
                            "deleted": true
                        ])
                    }
                }

                // Update state
                var nextState: [String: ReminderState] = [:]
                for (taskId, current) in currentMap {
                    nextState[taskId] = current.1
                }
                self.knownReminderStates = nextState

                // Send to JS
                if !changesToSend.isEmpty {
                    log("Detected reminder changes for \(changesToSend.count) tasks")
                    do {
                        let data = try JSONSerialization.data(withJSONObject: changesToSend)
                        if let jsonString = String(data: data, encoding: .utf8) {
                            let js = "if (window.__onCalendarChange) { window.__onCalendarChange(\(jsonString)); }"
                            webView.evaluateJavaScript(js, completionHandler: nil)
                        }
                    } catch {
                        log("Failed to serialize reminder changes: \(error)")
                    }
                }
            }
        }
    }

    // MARK: - Public API

    func syncTask(_ taskData: [String: Any], webView: WKWebView?, callback: String?) {
        requestAccess { granted in
            guard granted else {
                self.sendResult(webView: webView, callback: callback, success: false, error: "Reminders access denied")
                return
            }

            let action = taskData["action"] as? String ?? "upsert"

            switch action {
            case "upsert":
                self.upsertReminder(taskData: taskData, webView: webView, callback: callback)
            case "delete":
                self.deleteReminder(taskData: taskData, webView: webView, callback: callback)
            default:
                self.sendResult(webView: webView, callback: callback, success: false, error: "Unknown action: \(action)")
            }
        }
    }

    // MARK: - Access Request

    private func requestAccess(completion: @escaping (Bool) -> Void) {
        if #available(macOS 14.0, *) {
            eventStore.requestFullAccessToReminders { granted, error in
                if let error = error {
                    log("Reminders access error: \(error)")
                }
                completion(granted)
            }
        } else {
            eventStore.requestAccess(to: .reminder) { granted, error in
                if let error = error {
                    log("Reminders access error: \(error)")
                }
                completion(granted)
            }
        }
    }

    // MARK: - Reminders List

    private func getOrCreateList() -> EKCalendar? {
        // Look for existing reminders list
        let calendars = eventStore.calendars(for: .reminder)
        if let existing = calendars.first(where: { $0.title == listTitle }) {
            return existing
        }

        // Create new list
        let calendar = EKCalendar(for: .reminder, eventStore: eventStore)
        calendar.title = listTitle
        calendar.cgColor = NSColor.systemBlue.cgColor

        if let defaultSource = eventStore.defaultCalendarForNewReminders()?.source {
            calendar.source = defaultSource
        } else if let localSource = eventStore.sources.first(where: { $0.sourceType == .local }) {
            calendar.source = localSource
        } else {
            log("No reminders source available")
            return nil
        }

        do {
            try eventStore.saveCalendar(calendar, commit: true)
            log("Created reminders list: \(listTitle)")
            return calendar
        } catch {
            log("Failed to create reminders list: \(error)")
            return nil
        }
    }

    // MARK: - Upsert Reminder

    private func upsertReminder(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        guard let list = getOrCreateList() else {
            sendResult(webView: webView, callback: callback, success: false, error: "Cannot create reminders list")
            return
        }

        guard let taskId = taskData["taskId"] as? String,
              let title = taskData["title"] as? String else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing taskId or title")
            return
        }

        findReminderAsync(taskId: taskId, in: list) { [weak self] existingReminder in
            guard let self = self else { return }

            let reminder = existingReminder ?? EKReminder(eventStore: self.eventStore)
            reminder.calendar = list

            // Clear existing alarms to avoid duplicates
            reminder.alarms?.forEach { reminder.removeAlarm($0) }

            // Apply status (done prefix)
            let status = taskData["status"] as? String
            let isDone = status == "done"
            reminder.isCompleted = isDone
            if isDone {
                let cleanTitle = title.hasPrefix("✅ ") ? String(title.dropFirst(2)) : title
                reminder.title = "✅ " + cleanTitle
                if reminder.completionDate == nil {
                    reminder.completionDate = Date()
                }
            } else {
                let cleanTitle = title.hasPrefix("✅ ") ? String(title.dropFirst(2)) : title
                reminder.title = cleanTitle
                reminder.completionDate = nil
            }

            // Notes / description
            if let description = taskData["description"] as? String, !description.isEmpty {
                reminder.notes = description
            } else {
                reminder.notes = ""
            }

            // Due Date logic
            let dueDateStr = taskData["dueDate"] as? String
            let startDateStr = taskData["startDate"] as? String
            var targetDateStr: String? = nil

            // Prefer dueDate, fallback to startDate if needed for reminders
            if let due = dueDateStr, !due.isEmpty {
                targetDateStr = due
            } else if let start = startDateStr, !start.isEmpty {
                targetDateStr = start
            }

            if let dateStr = targetDateStr, let parsedDate = self.parseISO(dateStr) {
                let components: Set<Calendar.Component> = dateStr.contains("T") ?
                    [.year, .month, .day, .hour, .minute] :
                    [.year, .month, .day]
                let dateComponents = Calendar.current.dateComponents(components, from: parsedDate)
                reminder.dueDateComponents = dateComponents

                // Re-apply correct alarm based on priority
                if let priority = taskData["priority"] as? String {
                    if let alarm = self.alarmForPriority(priority) {
                        reminder.addAlarm(alarm)
                    }
                }
            } else {
                // No date
                reminder.dueDateComponents = nil
            }

            // Store task ID in reminder URL for lookup
            reminder.url = URL(string: "nomendex://task/\(taskId)")

            // Prevent echo
            DispatchQueue.main.async {
                self.ignoredTaskIDs.insert(taskId)
            }

            do {
                try self.eventStore.save(reminder, commit: true)
                log("Saved reminder for task: \(taskId)")
                self.sendResult(webView: webView, callback: callback, success: true, error: nil)
            } catch {
                log("Failed to save reminder: \(error)")
                self.sendResult(webView: webView, callback: callback, success: false, error: error.localizedDescription)
            }
        }
    }

    // MARK: - Delete Reminder

    private func deleteReminder(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        guard let list = getOrCreateList() else {
            sendResult(webView: webView, callback: callback, success: true, error: nil)
            return
        }

        guard let taskId = taskData["taskId"] as? String else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing taskId")
            return
        }

        findReminderAsync(taskId: taskId, in: list) { [weak self] reminder in
            guard let self = self else { return }

            guard let reminder = reminder else {
                log("No reminder found to delete for task: \(taskId)")
                self.sendResult(webView: webView, callback: callback, success: true, error: nil)
                return
            }

            // Prevent echo
            DispatchQueue.main.async {
                self.ignoredTaskIDs.insert(taskId)
            }

            do {
                try self.eventStore.remove(reminder, commit: true)
                log("Deleted reminder for task: \(taskId)")
                self.sendResult(webView: webView, callback: callback, success: true, error: nil)
            } catch {
                log("Failed to delete reminder: \(error)")
                self.sendResult(webView: webView, callback: callback, success: false, error: error.localizedDescription)
            }
        }
    }

    // MARK: - Helpers

    private func findReminderAsync(taskId: String, in list: EKCalendar, completion: @escaping (EKReminder?) -> Void) {
        let predicate = eventStore.predicateForReminders(in: [list])
        let targetURL = URL(string: "nomendex://task/\(taskId)")

        eventStore.fetchReminders(matching: predicate) { reminders in
            let found = reminders?.first { $0.url == targetURL }
            completion(found)
        }
    }

    private func alarmForPriority(_ priority: String) -> EKAlarm? {
        switch priority {
        case "high":
            return EKAlarm(relativeOffset: -15 * 60)   // 15 min before
        case "medium":
            return EKAlarm(relativeOffset: -30 * 60)   // 30 min before
        default:
            return nil
        }
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

    private func sendResult(webView: WKWebView?, callback: String?, success: Bool, error: String?) {
        guard let callback = callback, let wv = webView else { return }

        DispatchQueue.main.async {
            let errorStr = error.map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" } ?? "null"
            let js = "window.\(callback)({success: \(success), error: \(errorStr)})"
            wv.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
