import type { Todo } from "@/features/todos/todo-types";

// Bridge to native macOS Reminders via EventKit
// Uses WKScriptMessageHandler to communicate with Swift ReminderManager

interface ReminderSyncResult {
    success: boolean;
    error: string | null;
}

function isRemindersAvailable(): boolean {
    return !!window.webkit?.messageHandlers?.reminderSync;
}

export function isRemindersSyncAvailable(): boolean {
    return isRemindersAvailable();
}

// Serialize reminder sync calls to avoid duplicate reminders from concurrent upserts
let reminderSyncQueue: Promise<boolean> = Promise.resolve(true);

export async function syncTaskToReminders(task: Todo): Promise<boolean> {
    if (!isRemindersAvailable()) return false;

    // Only high and medium priority tasks go to Reminders
    if (task.priority !== "high" && task.priority !== "medium") {
        // If it was previously in reminders but priority dropped, delete it
        return removeTaskFromReminders(task.id);
    }

    // Need at least a schedule or deadline to create a reminder
    const hasDate = Boolean(task.scheduledStart || task.scheduledEnd || task.dueDate);
    if (!hasDate) {
        return removeTaskFromReminders(task.id);
    }

    const op = reminderSyncQueue.then(() => doSyncTaskToReminders(task));
    reminderSyncQueue = op.catch(() => false);
    return op;
}

function doSyncTaskToReminders(task: Todo): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const callbackName = `__reminderSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        (window as unknown as Record<string, unknown>)[callbackName] = (result: ReminderSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[reminder-bridge] sync error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve(result.success);
        };

        window.webkit!.messageHandlers!.reminderSync!.postMessage({
            action: "upsert",
            taskId: task.id,
            title: task.title,
            description: task.description || "",
            scheduledStart: task.scheduledStart ?? task.dueDate ?? null,
            scheduledEnd: task.scheduledEnd ?? null,
            priority: task.priority,
            status: task.status,
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

export async function removeTaskFromReminders(taskId: string): Promise<boolean> {
    if (!isRemindersAvailable()) return false;

    const op = reminderSyncQueue.then(() => doRemoveTaskFromReminders(taskId));
    reminderSyncQueue = op.catch(() => false);
    return op;
}

function doRemoveTaskFromReminders(taskId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const callbackName = `__reminderSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        (window as unknown as Record<string, unknown>)[callbackName] = (result: ReminderSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[reminder-bridge] delete error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve(result.success);
        };

        window.webkit!.messageHandlers!.reminderSync!.postMessage({
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
