import type { Todo } from "@/features/todos/todo-types";

// Bridge to native macOS Calendar via EventKit
// Uses WKScriptMessageHandler to communicate with Swift CalendarManager

interface CalendarSyncResult {
    success: boolean;
    error: string | null;
}

function isCalendarAvailable(): boolean {
    return !!window.webkit?.messageHandlers?.calendarSync;
}

export async function syncTaskToCalendar(task: Todo): Promise<void> {
    if (!isCalendarAvailable()) return;
    if (!task.dueDate && !task.startDate) return; // Nothing to sync without dates

    return new Promise<void>((resolve) => {
        const callbackName = `__calendarSyncCallback`;
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
        const callbackName = `__calendarSyncCallback`;
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
