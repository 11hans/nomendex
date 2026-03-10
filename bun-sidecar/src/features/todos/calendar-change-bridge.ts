// Removed invalid import

interface CalendarChange {
    taskId: string;
    title?: string;
    startDate?: string | null;
    dueDate?: string | null;
    deleted?: boolean;
    completed?: boolean;
}

export function initCalendarChangeListener(todosAPI: any) {
    // Register the global handler that Swift will call
    (window as any).__onCalendarChange = async (changes: CalendarChange[]) => {
        let hasChangesToApply = false;

        for (const change of changes) {
            try {
                if (change.deleted) {
                    // Delete the task entirely from Nomendex
                    await todosAPI.deleteTodo({
                        todoId: change.taskId,
                    });
                    hasChangesToApply = true;
                } else {
                    const updates: Record<string, any> = {};
                    if (change.title !== undefined) updates.title = change.title;
                    if (change.startDate !== undefined) updates.startDate = change.startDate;
                    if (change.dueDate !== undefined) updates.dueDate = change.dueDate;
                    if (change.completed !== undefined) updates.status = change.completed ? "done" : "todo";

                    if (Object.keys(updates).length > 0) {
                        await todosAPI.updateTodo({
                            todoId: change.taskId,
                            updates
                        });
                        hasChangesToApply = true;
                    }
                }
            } catch (err) {
                console.error(`Failed to process calendar change for task ${change.taskId}:`, err);
            }
        }

        // Trigger generic custom event to refresh the UI
        if (hasChangesToApply) {
            window.dispatchEvent(new CustomEvent("calendar-sync-update"));
        }
    };
}
