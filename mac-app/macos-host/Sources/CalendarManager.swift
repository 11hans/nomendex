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

    // MARK: - Deletion Confirmation
    //
    // EventKit has no deletion callback, so "the event is gone" can only ever be
    // inferred from its absence in a scan — and a scan lies: it returns partial
    // or empty results while an iCloud source is resyncing, and it cannot see
    // events outside the lookup window at all. A false absence used to delete the
    // matching event-todo permanently (incident 2026-08-27, 12 todos lost), so a
    // deletion now has to survive a per-event lookup, a window check, a grace
    // period, and a blast-radius cap before it reaches the app.

    private var missingSince: [String: Date] = [:]  // taskId -> first pass that missed it
    private var recheckScheduled = false
    private var lastBulkSuspects: Set<String> = []

    /// How long a task must stay unresolvable before its deletion is believed.
    private let deletionGraceInterval: TimeInterval = 120
    /// Deletions per pass that are always plausible as deliberate user action.
    private let bulkDeletionFloor = 3

    struct EventState {
        let title: String
        let startDate: Date?
        let endDate: Date?
        let isAllDay: Bool

        init(title: String, startDate: Date?, endDate: Date?, isAllDay: Bool) {
            self.title = title
            self.startDate = startDate
            self.endDate = endDate
            self.isAllDay = isAllDay
        }

        init(_ event: EKEvent) {
            self.init(
                title: event.title ?? "",
                startDate: event.startDate,
                endDate: event.endDate,
                isAllDay: event.isAllDay
            )
        }
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
            self?.missingSince.removeAll()
            self?.lastBulkSuspects.removeAll()
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
            guard let predicate = self.nomendexEventsPredicate() else { return }
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
                newState[taskId] = EventState(keeper)
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
        guard let predicate = nomendexEventsPredicate() else { return [] }
        let events = eventStore.events(matching: predicate)
        let targetURL = URL(string: "nomendex://task/\(taskId)")
        return events.filter { $0.url == targetURL }
    }

    private func detectChanges() {
        guard let webView = webViewRef else { return }
        // Reset store to ensure we get fresh data after EKEventStoreChanged
        eventStore.reset()
        guard let predicate = nomendexEventsPredicate() else { return }
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
            currentMap[taskId] = (keeper, EventState(keeper))
            eventIdentifierCache[taskId] = keeper.eventIdentifier
        }

        var changesToSend: [[String: Any]] = []
        var deletionCandidates: [String] = []
        // Tracked events that this scan didn't return but that must stay tracked —
        // dropping them would silently stop syncing them (and lose the pending
        // deletion evidence for the next pass).
        var survivors: [String: EventState] = [:]
        let now = Date()

        // Check for modified or deleted events
        for (taskId, oldState) in knownEventStates {
            if ignoredTaskIDs.contains(taskId) {
                ignoredTaskIDs.remove(taskId)
                missingSince.removeValue(forKey: taskId)
                continue
            }

            // Resolve the event: this scan first, then an authoritative per-event
            // lookup. `event(withIdentifier:)` is bound neither by the predicate
            // window nor by which calendars the scan happened to see, so it is the
            // tie-breaker whenever a tracked task is missing from the scan.
            var newState: EventState? = currentMap[taskId]?.1
            if newState == nil, let live = liveEvent(taskId: taskId) {
                log("detectChanges: task \(taskId) missing from scan but still resolves by identifier — keeping it")
                let recovered = EventState(live)
                survivors[taskId] = recovered
                newState = recovered
            }

            guard let newState = newState else {
                // --- The event is genuinely unresolvable in this pass. ---

                // Events that aged out of the lookup window, or were moved beyond
                // it in Calendar.app, are simply unreachable — not deleted.
                if !isWithinLookupWindow(oldState) {
                    survivors[taskId] = oldState
                    missingSince.removeValue(forKey: taskId)
                    continue
                }

                // Require the absence to persist across passes and a grace period,
                // so a partial read resolves itself on the next store change.
                let firstMissed = missingSince[taskId] ?? now
                missingSince[taskId] = firstMissed
                if now.timeIntervalSince(firstMissed) < deletionGraceInterval {
                    log("detectChanges: task \(taskId) missing — waiting for confirmation before propagating a deletion")
                    survivors[taskId] = oldState
                    continue
                }

                deletionCandidates.append(taskId)
                continue
            }

            missingSince.removeValue(forKey: taskId)

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

                if let formattedEnd = formatScheduledEnd(newState.endDate, isAllDay: newState.isAllDay) {
                    syncPayload["scheduledEnd"] = formattedEnd
                } else {
                    syncPayload["scheduledEnd"] = NSNull()
                }
            }

            if hasChanges {
                changesToSend.append(syncPayload)
            }
        }

        // Blast-radius cap. Deleting a handful of events in Calendar.app is normal;
        // half the tracked set vanishing at once is far more likely to be a bad read
        // than intent, and the app-side consequence is irreversible. Hold those back
        // and let the user decide instead of applying them silently.
        let bulkThreshold = max(bulkDeletionFloor, knownEventStates.count / 2)
        if deletionCandidates.count > bulkThreshold {
            log("detectChanges: suspected bulk loss — \(deletionCandidates.count) of \(knownEventStates.count) tracked events vanished (threshold \(bulkThreshold)); not propagating")
            for taskId in deletionCandidates {
                if let oldState = knownEventStates[taskId] {
                    survivors[taskId] = oldState
                }
            }
            reportSuspectedBulkDeletion(taskIds: deletionCandidates, webView: webView)
        } else {
            lastBulkSuspects.removeAll()
            for taskId in deletionCandidates {
                log("detectChanges: confirmed deletion of task \(taskId) — propagating")
                // `confirmed` tells the web layer this deletion cleared the gates
                // above, so its own (necessarily blunter) cap can stand down. A host
                // without this fix sends bare deletions and stays capped there.
                changesToSend.append([
                    "taskId": taskId,
                    "deleted": true,
                    "confirmed": true
                ])
                missingSince.removeValue(forKey: taskId)
                eventIdentifierCache.removeValue(forKey: taskId)
            }
        }

        // Update snapshot
        var nextState: [String: EventState] = survivors
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
        missingSince = missingSince.filter { knownEventStates[$0.key] != nil }

        // A pending deletion only converges if something looks again after the grace
        // period — EKEventStoreChanged may never fire a second time. Candidates the
        // bulk cap already held back (grace long elapsed) are not rescheduled: they
        // stay held until the user acts, and re-polling them forever buys nothing.
        let hasUnconfirmedPending = missingSince.values.contains { now.timeIntervalSince($0) < deletionGraceInterval }
        if hasUnconfirmedPending {
            scheduleDeletionRecheck()
        }

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

    // MARK: - Deletion Confirmation Helpers

    /// Authoritative single-event lookup by cached identifier, used to second-guess
    /// a scan that didn't return a tracked task. Unlike `events(matching:)` this is
    /// limited neither by the lookup window nor by calendar visibility, so it is the
    /// one call that can distinguish "really deleted" from "this read was bad".
    private func liveEvent(taskId: String) -> EKEvent? {
        guard let cachedId = eventIdentifierCache[taskId],
              let event = eventStore.event(withIdentifier: cachedId),
              event.url?.absoluteString == "nomendex://task/\(taskId)" else { return nil }
        return event
    }

    /// Re-runs detection once the grace period has elapsed. EKEventStoreChanged may
    /// never fire again after the change that hid the events, so without this a
    /// genuine deletion would sit pending until the next unrelated calendar change.
    private func scheduleDeletionRecheck() {
        guard !recheckScheduled else { return }
        recheckScheduled = true
        syncQueue.asyncAfter(deadline: .now() + deletionGraceInterval + 5) { [weak self] in
            guard let self = self else { return }
            self.recheckScheduled = false
            self.detectChanges()
        }
    }

    /// Tells the app that an implausible number of events vanished at once, so it can
    /// warn the user instead of destroying data. Re-sent only when the suspected set
    /// changes — every calendar change re-runs detection and would otherwise re-warn.
    private func reportSuspectedBulkDeletion(taskIds: [String], webView: WKWebView) {
        let suspects = Set(taskIds)
        guard suspects != lastBulkSuspects else { return }
        lastBulkSuspects = suspects

        guard let data = try? JSONSerialization.data(withJSONObject: taskIds),
              let jsonString = String(data: data, encoding: .utf8) else { return }

        DispatchQueue.main.async {
            let js = "if (window.__onCalendarBulkDeletionSuspected) { window.__onCalendarBulkDeletionSuspected(\(jsonString)); }"
            webView.evaluateJavaScript(js, completionHandler: nil)
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
                case "upsertBatch":
                    self.upsertEventBatch(taskData: taskData, webView: webView, callback: callback)
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

    /// Shared lookup window for all event queries. EventKit silently truncates
    /// `predicateForEvents` ranges longer than four years to the FIRST four years,
    /// so a ±5y window used to evaluate as [now-5y, now-1y] and missed every
    /// current event. 365 + 1095 = 1460 days stays under the limit.
    private func lookupWindow() -> (start: Date, end: Date) {
        let now = Date()
        return (now.addingTimeInterval(-365 * 24 * 3600), now.addingTimeInterval(1095 * 24 * 3600))
    }

    private func nomendexEventsPredicate() -> NSPredicate? {
        let nomendexCalendars = getNomendexCalendars()
        guard !nomendexCalendars.isEmpty else { return nil }
        let window = lookupWindow()
        return eventStore.predicateForEvents(withStart: window.start, end: window.end, calendars: nomendexCalendars)
    }

    /// True when a known event's dates sit far enough inside the lookup window that
    /// its absence from a scan can actually mean deletion. Events near or past the
    /// edges (aged out of the past bound, dragged years into the future) are simply
    /// unreachable by the predicate — treating those as deletions destroys todos on
    /// a calendar boundary crossing rather than on anything the user did.
    private func isWithinLookupWindow(_ state: EventState) -> Bool {
        guard let start = state.startDate else { return false }
        let window = lookupWindow()
        let margin: TimeInterval = 24 * 3600
        let end = state.endDate ?? start
        return start >= window.start.addingTimeInterval(margin)
            && end <= window.end.addingTimeInterval(-margin)
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
        let result = applyUpsert(taskData: taskData, commit: true)
        if let event = result.event, let taskId = taskData["taskId"] as? String {
            eventIdentifierCache[taskId] = event.eventIdentifier
        }
        sendResult(webView: webView, callback: callback, success: result.error == nil, error: result.error)
    }

    /// Batch upsert used by Force Sync / Reconcile: applies all events with the
    /// commit deferred, then commits once. One EventKit commit instead of N keeps
    /// bulk syncs fast and avoids N separate iCloud round-trips.
    private func upsertEventBatch(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        guard let tasks = taskData["tasks"] as? [[String: Any]] else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing tasks")
            return
        }

        var savedEvents: [(taskId: String, event: EKEvent)] = []
        var failed = 0
        var firstError: String? = nil

        for task in tasks {
            let result = applyUpsert(taskData: task, commit: false)
            if let error = result.error {
                failed += 1
                if firstError == nil { firstError = error }
            } else if let event = result.event, let taskId = task["taskId"] as? String {
                savedEvents.append((taskId, event))
            }
        }

        do {
            try eventStore.commit()
        } catch {
            log("Batch commit failed: \(error)")
            sendResult(webView: webView, callback: callback, success: false, error: error.localizedDescription)
            return
        }

        // Identifiers are only stable after the commit.
        for (taskId, event) in savedEvents {
            eventIdentifierCache[taskId] = event.eventIdentifier
        }

        log("Batch upsert: \(savedEvents.count) saved, \(failed) failed")
        sendResult(webView: webView, callback: callback, success: failed == 0, error: firstError,
                   data: ["synced": savedEvents.count, "failed": failed])
    }

    /// Core upsert shared by the single and batch paths. Returns the saved event
    /// (identifier caching is the caller's responsibility — identifiers are not
    /// stable until commit) or an error message. (nil, nil) means "nothing to sync".
    private func applyUpsert(taskData: [String: Any], commit: Bool) -> (event: EKEvent?, error: String?) {
        let projectName = taskData["projectName"] as? String

        guard let calendar = getOrCreateCalendar(projectName: projectName) else {
            return (nil, "Cannot create calendar")
        }

        guard let taskId = taskData["taskId"] as? String,
              let title = taskData["title"] as? String else {
            return (nil, "Missing taskId or title")
        }

        // Fast path: cached identifier avoids a full calendar scan. Duplicate
        // cleanup is skipped here — snapshot/detectChanges/reconcile cover it.
        var keeper: EKEvent? = nil
        if let cachedId = eventIdentifierCache[taskId],
           let cached = eventStore.event(withIdentifier: cachedId),
           cached.url?.absoluteString == "nomendex://task/\(taskId)" {
            keeper = cached
        } else {
            // Find (and dedupe) existing events for this task. Multi-device iCloud
            // races or lost-URL round-trips can leave multiple events for one task
            // — clean them up opportunistically on every upsert.
            let existing = findAllEvents(taskId: taskId)
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
        let cleanTitle = title.hasPrefix("✅ ") ? String(title.dropFirst(2)) : title
        event.title = status == "done" ? "✅ " + cleanTitle : cleanTitle

        // Notes / description — clear when emptied in Nomendex, otherwise a
        // reused event keeps its stale text forever.
        let description = taskData["description"] as? String
        event.notes = (description?.isEmpty == false) ? description : nil

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
                // Calendar day-add (not +86400s) keeps midnight across DST changes.
                event.endDate = isAllDay ? Calendar.current.date(byAdding: .day, value: 1, to: end) ?? end : end
            } else if isAllDay {
                event.endDate = Calendar.current.date(byAdding: .day, value: 1, to: start) ?? start
            } else {
                event.endDate = start.addingTimeInterval(TimeInterval(duration * 60))
            }
            event.isAllDay = isAllDay
        } else {
            // No dates — nothing to sync
            return (nil, nil)
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
            try eventStore.save(event, span: .thisEvent, commit: commit)
            log("Saved calendar event for task: \(taskId)")
            return (event, nil)
        } catch {
            log("Failed to save event: \(error)")
            return (nil, error.localizedDescription)
        }
    }

    // MARK: - Delete Event

    private func deleteEvent(taskData: [String: Any], webView: WKWebView?, callback: String?) {
        guard let taskId = taskData["taskId"] as? String else {
            sendResult(webView: webView, callback: callback, success: false, error: "Missing taskId")
            return
        }

        // Fast path: the startup snapshot and change observer keep the cache and
        // knownEventStates covering the same window findEvent searches, so a task
        // in neither has no event to remove. Every update of a todo without
        // scheduled dates lands here — skip the calendar scan.
        if eventIdentifierCache[taskId] == nil && knownEventStates[taskId] == nil {
            sendResult(webView: webView, callback: callback, success: true, error: nil)
            return
        }

        if let event = findEvent(taskId: taskId) {
            // Prevent echo
            ignoredTaskIDs.insert(taskId)
            do {
                try eventStore.remove(event, span: .thisEvent)
                eventIdentifierCache.removeValue(forKey: taskId)
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
        guard let predicate = nomendexEventsPredicate() else { return nil }
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

    /// Formats an event's end for Nomendex. All-day `EKEvent` end dates are
    /// exclusive (upsert adds a day), so the day has to come back off on the way in
    /// — otherwise every external edit of an all-day event stretched the todo by
    /// another day on each round-trip.
    private func formatScheduledEnd(_ date: Date?, isAllDay: Bool) -> String? {
        guard let date = date else { return nil }
        guard isAllDay else { return formatScheduledDate(date, isAllDay: false) }
        let inclusiveEnd = Calendar.current.date(byAdding: .day, value: -1, to: date) ?? date
        return formatScheduledDate(inclusiveEnd, isAllDay: true)
    }

    private func parseISO(_ string: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current

        if string.contains("T") {
            // The Nomendex UI writes "yyyy-MM-dd'T'HH:mm", but agent/imported todos
            // may carry seconds (or fractional seconds). A strict single-format parse
            // silently returned nil for those, dropping the event. Try the most
            // specific format first, then fall back.
            let timedFormats = [
                "yyyy-MM-dd'T'HH:mm:ss.SSS",
                "yyyy-MM-dd'T'HH:mm:ss",
                "yyyy-MM-dd'T'HH:mm",
            ]
            for format in timedFormats {
                formatter.dateFormat = format
                if let date = formatter.date(from: string) {
                    return date
                }
            }
            // Last resort: strings carrying a timezone designator (trailing Z / offset).
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = iso.date(from: string) {
                return date
            }
            iso.formatOptions = [.withInternetDateTime]
            return iso.date(from: string)
        } else {
            formatter.dateFormat = "yyyy-MM-dd"
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
            // The JS bridge deletes the callback after its 5s timeout — guard so a
            // late reply (e.g. first-run permission dialog) doesn't throw.
            let js = "if (typeof window.\(callback) === 'function') { window.\(callback)(\(jsonString)); }"
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
        guard let predicate = nomendexEventsPredicate() else {
            sendResult(webView: webView, callback: callback, success: true, error: nil, data: ["taskIds": [] as [String], "removed": 0])
            return
        }
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
