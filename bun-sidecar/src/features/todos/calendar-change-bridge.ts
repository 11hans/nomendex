// Removed invalid import

interface CalendarChange {
    taskId: string;
    title?: string;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    deleted?: boolean;
    completed?: boolean;
}

interface CalendarTodosAPI {
    deleteTodo(args: { todoId: string }): Promise<unknown>;
    getTodoById(args: { todoId: string }): Promise<{ tags?: string[] } | null>;
    updateTodo(args: { todoId: string; updates: Record<string, unknown> }): Promise<unknown>;
}

export function initCalendarChangeListener(todosAPI: CalendarTodosAPI) {
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
                    const currentTodo = await todosAPI.getTodoById({
                        todoId: change.taskId,
                    }).catch(() => null);
                    const updates: Record<string, any> = {};
                    if (change.title !== undefined) updates.title = change.title;
                    if (change.scheduledStart !== undefined) updates.scheduledStart = change.scheduledStart;
                    if (change.scheduledEnd !== undefined) updates.scheduledEnd = change.scheduledEnd;
                    if (change.completed !== undefined && !(currentTodo?.tags?.includes("timeblock"))) {
                        updates.status = change.completed ? "done" : "todo";
                    }

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
