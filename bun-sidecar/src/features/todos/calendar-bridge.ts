import type { Todo } from "@/features/todos/todo-types";

interface CalendarSyncResult {
    success: boolean;
    error: string | null;
}

function isCalendarAvailable(): boolean {
    return !!window.webkit?.messageHandlers?.calendarSync;
}

export function isCalendarSyncAvailable(): boolean {
    return isCalendarAvailable();
}

// Serialize calendar sync calls to prevent duplicate events from concurrent upserts
let calendarSyncQueue: Promise<boolean> = Promise.resolve(true);

export async function syncTaskToCalendar(task: Todo): Promise<boolean> {
    if (!isCalendarAvailable()) return false;

    // If both scheduled fields are cleared, remove from calendar
    if (!task.scheduledStart && !task.scheduledEnd) {
        return removeTaskFromCalendar(task.id);
    }

    // Chain onto queue to prevent concurrent upserts creating duplicates
    const op = calendarSyncQueue.then(() => doSyncTaskToCalendar(task));
    calendarSyncQueue = op.catch(() => false);
    return op;
}

function doSyncTaskToCalendar(task: Todo): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const callbackName = `__calendarSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        (window as unknown as Record<string, unknown>)[callbackName] = (result: CalendarSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[calendar-bridge] sync error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve(result.success);
        };

        window.webkit!.messageHandlers!.calendarSync!.postMessage({
            action: "upsert",
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
            callback: callbackName,
        });

        // Timeout to prevent dangling promises
        setTimeout(() => {
            if ((window as unknown as Record<string, unknown>)[callbackName]) {
                delete (window as unknown as Record<string, unknown>)[callbackName];
                resolve(false);
            }
        }, 5000);
    });
}

export async function removeTaskFromCalendar(taskId: string): Promise<boolean> {
    if (!isCalendarAvailable()) return false;

    // Chain onto queue to prevent racing with concurrent upserts
    const op = calendarSyncQueue.then(() => doRemoveTaskFromCalendar(taskId));
    calendarSyncQueue = op.catch(() => false);
    return op;
}

/** Deletes all Nomendex calendars (wipe before force sync). Calendars are recreated by upsert. */
export async function purgeCalendarEvents(): Promise<boolean> {
    if (!isCalendarAvailable()) return false;

    const op = calendarSyncQueue.then(() => doPurgeCalendarEvents());
    calendarSyncQueue = op.catch(() => false);
    return op;
}

function doPurgeCalendarEvents(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const callbackName = `__calendarSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        (window as unknown as Record<string, unknown>)[callbackName] = (result: CalendarSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[calendar-bridge] purge error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve(result.success);
        };

        window.webkit!.messageHandlers!.calendarSync!.postMessage({
            action: "purge",
            callback: callbackName,
        });

        setTimeout(() => {
            if ((window as unknown as Record<string, unknown>)[callbackName]) {
                delete (window as unknown as Record<string, unknown>)[callbackName];
                resolve(false);
            }
        }, 5000);
    });
}

function doRemoveTaskFromCalendar(taskId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const callbackName = `__calendarSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        (window as unknown as Record<string, unknown>)[callbackName] = (result: CalendarSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[calendar-bridge] delete error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve(result.success);
        };

        window.webkit!.messageHandlers!.calendarSync!.postMessage({
            action: "delete",
            taskId: taskId,
            callback: callbackName,
        });

        setTimeout(() => {
            if ((window as unknown as Record<string, unknown>)[callbackName]) {
                delete (window as unknown as Record<string, unknown>)[callbackName];
                resolve(false);
            }
        }, 5000);
    });
}
