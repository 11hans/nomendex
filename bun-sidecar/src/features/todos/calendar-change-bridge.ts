import { isTaskTodo } from "./todo-kind-utils";
import type { Todo } from "./todo-types";

interface CalendarChange {
    taskId: string;
    title?: string;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    deleted?: boolean;
    completed?: boolean;
}

type CalendarTodoSnapshot = Pick<
    Todo,
    "id" | "kind" | "source" | "status" | "tags" | "scheduledStart" | "scheduledEnd" | "calendarReminderPreset"
>;

interface CalendarTodosAPI {
    deleteTodo(args: { todoId: string }): Promise<unknown>;
    getTodoById(args: { todoId: string }): Promise<CalendarTodoSnapshot | null>;
    updateTodo(args: { todoId: string; updates: Record<string, unknown> }): Promise<unknown>;
}

export function initCalendarChangeListener(todosAPI: CalendarTodosAPI) {
    (window as typeof window & { __onCalendarChange?: (changes: CalendarChange[]) => Promise<void> }).__onCalendarChange = async (changes: CalendarChange[]) => {
        let hasChangesToApply = false;

        for (const change of changes) {
            try {
                const currentTodo = await todosAPI.getTodoById({
                    todoId: change.taskId,
                }).catch(() => null);

                if (!currentTodo) {
                    continue;
                }

                if (change.deleted) {
                    if (isTaskTodo(currentTodo)) {
                        await todosAPI.updateTodo({
                            todoId: change.taskId,
                            updates: {
                                scheduledStart: null,
                                scheduledEnd: null,
                                calendarReminderPreset: "none",
                            },
                        });
                    } else {
                        await todosAPI.deleteTodo({
                            todoId: change.taskId,
                        });
                    }
                    hasChangesToApply = true;
                    continue;
                }

                const updates: Record<string, unknown> = {};
                if (change.title !== undefined) updates.title = change.title;
                if (change.scheduledStart !== undefined) updates.scheduledStart = change.scheduledStart;
                if (change.scheduledEnd !== undefined) updates.scheduledEnd = change.scheduledEnd;
                if (change.completed !== undefined && isTaskTodo(currentTodo)) {
                    updates.status = change.completed ? "done" : "todo";
                }

                if (Object.keys(updates).length > 0) {
                    await todosAPI.updateTodo({
                        todoId: change.taskId,
                        updates,
                    });
                    hasChangesToApply = true;
                }
            } catch (err) {
                console.error(`Failed to process calendar change for task ${change.taskId}:`, err);
            }
        }

        if (hasChangesToApply) {
            window.dispatchEvent(new CustomEvent("calendar-sync-update"));
        }
    };
}
