import type { Todo } from "@/features/todos/todo-types";

interface CalendarSyncResult {
    success: boolean;
    error: string | null;
}

interface ReconcileResult extends CalendarSyncResult {
    taskIds?: string[];
    removed?: number;
}

interface BatchResult extends CalendarSyncResult {
    synced?: number;
    failed?: number;
}

function isCalendarAvailable(): boolean {
    return !!window.webkit?.messageHandlers?.calendarSync;
}

export function isCalendarSyncAvailable(): boolean {
    return isCalendarAvailable();
}

// Serialize calendar sync calls to prevent duplicate events from concurrent upserts
let calendarSyncQueue: Promise<boolean> = Promise.resolve(true);

/** Posts a message to the native calendar bridge and resolves with the callback
 *  result, or null when the callback doesn't arrive within timeoutMs. */
function postCalendarMessage<T extends CalendarSyncResult = CalendarSyncResult>(
    message: Record<string, unknown>,
    label: string,
    timeoutMs: number,
): Promise<T | null> {
    return new Promise((resolve) => {
        const callbackName = `__calendarSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const win = window as unknown as Record<string, unknown>;
        win[callbackName] = (result: T) => {
            if (!result.success && result.error) {
                console.warn(`[calendar-bridge] ${label} error:`, result.error);
            }
            delete win[callbackName];
            resolve(result);
        };

        window.webkit!.messageHandlers!.calendarSync!.postMessage({ ...message, callback: callbackName });

        // Timeout to prevent dangling promises
        setTimeout(() => {
            if (win[callbackName]) {
                delete win[callbackName];
                resolve(null);
            }
        }, timeoutMs);
    });
}

function buildTaskPayload(task: Todo): Record<string, unknown> {
    return {
        taskId: task.id,
        title: task.title,
        description: task.description || "",
        scheduledStart: task.scheduledStart ?? null,
        scheduledEnd: task.scheduledEnd ?? null,
        dueDate: task.dueDate,
        duration: task.duration || 60,
        priority: task.priority || "none",
        status: task.status,
        projectName: task.project || null,
        calendarReminderPreset: task.calendarReminderPreset || "none",
    };
}

export async function syncTaskToCalendar(task: Todo): Promise<boolean> {
    if (!isCalendarAvailable()) return false;

    // Archived todos and todos with both scheduled fields cleared don't belong on
    // the calendar. Archiving in particular must remove rather than upsert — it is
    // how an event deleted in Calendar.app is retired, and re-creating the event
    // would undo the very deletion that triggered it.
    if (task.archived || (!task.scheduledStart && !task.scheduledEnd)) {
        return removeTaskFromCalendar(task.id);
    }

    // Chain onto queue to prevent concurrent upserts creating duplicates
    const op = calendarSyncQueue.then(async () => {
        const result = await postCalendarMessage({ action: "upsert", ...buildTaskPayload(task) }, "sync", 5000);
        return result?.success ?? false;
    });
    calendarSyncQueue = op.catch(() => false);
    return op;
}

/** Upserts many tasks in one native call with a single EventKit commit.
 *  Used by Force Sync / Reconcile instead of per-task round-trips. */
export async function syncTasksToCalendarBatch(tasks: Todo[]): Promise<{ synced: number; failed: number } | null> {
    if (!isCalendarAvailable()) return null;
    const withDates = tasks.filter((t) => !t.archived && (t.scheduledStart || t.scheduledEnd));
    if (withDates.length === 0) return { synced: 0, failed: 0 };

    const op = calendarSyncQueue.then(async () => {
        const result = await postCalendarMessage<BatchResult>(
            { action: "upsertBatch", tasks: withDates.map(buildTaskPayload) },
            "batch sync",
            Math.max(30000, withDates.length * 100),
        );
        if (!result) return null;
        return { synced: result.synced ?? 0, failed: result.failed ?? 0 };
    });
    calendarSyncQueue = op.then((r) => r !== null).catch(() => false);
    return op;
}

export async function removeTaskFromCalendar(taskId: string): Promise<boolean> {
    if (!isCalendarAvailable()) return false;

    // Chain onto queue to prevent racing with concurrent upserts
    const op = calendarSyncQueue.then(async () => {
        const result = await postCalendarMessage({ action: "delete", taskId }, "delete", 5000);
        return result?.success ?? false;
    });
    calendarSyncQueue = op.catch(() => false);
    return op;
}

/** Deduplicates events per taskId across Nomendex calendars and returns the set of taskIds
 *  that still have at least one event. Non-destructive — does not wipe calendars. */
export async function reconcileCalendar(): Promise<{ taskIds: string[]; removed: number } | null> {
    if (!isCalendarAvailable()) return null;
    const op = calendarSyncQueue.then(async () => {
        const result = await postCalendarMessage<ReconcileResult>({ action: "reconcile" }, "reconcile", 10000);
        if (!result?.success) return null;
        return { taskIds: result.taskIds ?? [], removed: result.removed ?? 0 };
    });
    calendarSyncQueue = op.then((r) => r !== null).catch(() => false);
    return op;
}

/** Deletes all Nomendex calendars (wipe before force sync). Calendars are recreated by upsert. */
export async function purgeCalendarEvents(): Promise<boolean> {
    if (!isCalendarAvailable()) return false;

    const op = calendarSyncQueue.then(async () => {
        const result = await postCalendarMessage({ action: "purge" }, "purge", 5000);
        return result?.success ?? false;
    });
    calendarSyncQueue = op.catch(() => false);
    return op;
}
