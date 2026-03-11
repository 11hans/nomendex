import type { Todo } from "@/features/todos/todo-types";

interface CalendarSyncResult {
    success: boolean;
    error: string | null;
}

function isCalendarAvailable(): boolean {
    return !!window.webkit?.messageHandlers?.calendarSync;
}

// Serialize calendar sync calls to prevent duplicate events from concurrent upserts
let calendarSyncQueue: Promise<void> = Promise.resolve();

export async function syncTaskToCalendar(task: Todo): Promise<void> {
    if (!isCalendarAvailable()) return;

    // If both dates are cleared, we should remove it from the calendar
    if (!task.dueDate && !task.startDate) {
        return removeTaskFromCalendar(task.id);
    }

    // Chain onto queue to prevent concurrent upserts creating duplicates
    const op = calendarSyncQueue.then(() => doSyncTaskToCalendar(task));
    calendarSyncQueue = op.catch(() => { /* swallow to keep chain alive */ });
    return op;
}

function doSyncTaskToCalendar(task: Todo): Promise<void> {
    return new Promise<void>((resolve) => {
        const callbackName = `__calendarSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        (window as unknown as Record<string, unknown>)[callbackName] = (result: CalendarSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[calendar-bridge] sync error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve();
        };

        window.webkit!.messageHandlers!.calendarSync!.postMessage({
            action: "upsert",
            taskId: task.id,
            title: task.title,
            description: task.description || "",
            dueDate: task.dueDate,
            startDate: task.startDate,
            duration: task.duration || 60,
            priority: task.priority || "none",
            status: task.status,
            projectName: task.project || null,
            callback: callbackName,
        });

        // Timeout to prevent dangling promises
        setTimeout(() => {
            if ((window as unknown as Record<string, unknown>)[callbackName]) {
                delete (window as unknown as Record<string, unknown>)[callbackName];
                resolve();
            }
        }, 5000);
    });
}

export async function removeTaskFromCalendar(taskId: string): Promise<void> {
    if (!isCalendarAvailable()) return;

    return new Promise<void>((resolve) => {
        const callbackName = `__calendarSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        (window as unknown as Record<string, unknown>)[callbackName] = (result: CalendarSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[calendar-bridge] delete error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve();
        };

        window.webkit!.messageHandlers!.calendarSync!.postMessage({
            action: "delete",
            taskId: taskId,
            callback: callbackName,
        });

        setTimeout(() => {
            if ((window as unknown as Record<string, unknown>)[callbackName]) {
                delete (window as unknown as Record<string, unknown>)[callbackName];
                resolve();
            }
        }, 5000);
    });
}
