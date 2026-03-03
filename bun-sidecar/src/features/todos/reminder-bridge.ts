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

export async function syncTaskToReminders(task: Todo): Promise<void> {
    if (!isRemindersAvailable()) return;
    
    // Only high and medium priority tasks go to Reminders
    if (task.priority !== "high" && task.priority !== "medium") {
        // If it was previously in reminders but priority dropped, delete it
        return removeTaskFromReminders(task.id);
    }

    return new Promise<void>((resolve) => {
        const callbackName = `__reminderSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        (window as unknown as Record<string, unknown>)[callbackName] = (result: ReminderSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[reminder-bridge] sync error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve();
        };

        window.webkit!.messageHandlers!.reminderSync!.postMessage({
            action: "upsert",
            taskId: task.id,
            title: task.title,
            description: task.description || "",
            dueDate: task.dueDate,
            startDate: task.startDate,
            priority: task.priority,
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

export async function removeTaskFromReminders(taskId: string): Promise<void> {
    if (!isRemindersAvailable()) return;

    return new Promise<void>((resolve) => {
        const callbackName = `__reminderSyncCallback_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        (window as unknown as Record<string, unknown>)[callbackName] = (result: ReminderSyncResult) => {
            if (!result.success && result.error) {
                console.warn("[reminder-bridge] delete error:", result.error);
            }
            delete (window as unknown as Record<string, unknown>)[callbackName];
            resolve();
        };

        window.webkit!.messageHandlers!.reminderSync!.postMessage({
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
