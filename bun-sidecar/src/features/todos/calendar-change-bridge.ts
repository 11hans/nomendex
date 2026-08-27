import { isTaskTodo } from "./todo-kind-utils";
import type { Todo } from "./todo-types";

interface CalendarChange {
    taskId: string;
    title?: string;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    deleted?: boolean;
    /** Set by a native host that vets deletions before sending them. */
    confirmed?: boolean;
    completed?: boolean;
}

type CalendarTodoSnapshot = Pick<
    Todo,
    "id" | "kind" | "source" | "status" | "tags" | "scheduledStart" | "scheduledEnd" | "calendarReminderPreset"
>;

/** Deliberately has no delete: nothing arriving from Apple Calendar may destroy a
 *  todo. Task deletions unschedule, event deletions archive. */
interface CalendarTodosAPI {
    getTodoById(args: { todoId: string }): Promise<CalendarTodoSnapshot | null>;
    updateTodo(args: { todoId: string; updates: Record<string, unknown> }): Promise<unknown>;
}

export interface CalendarChangeListenerOptions {
    /** Called when incoming deletions are held back, so the UI can warn the user. */
    onWarning?: (message: string) => void;
}

/** Deleting a handful of events in Calendar.app at once is ordinary; a larger
 *  batch is more likely a bad EventKit read than intent. Incoming deletions are
 *  inferred from an event's *absence* in a scan, and that inference has been
 *  wrong before — a single false-empty scan removed 12 event todos on
 *  2026-08-27. The native side confirms deletions before sending them, but this
 *  cap is deliberately duplicated here: the web layer ships with every app
 *  update, the native host only with a rebuild. */
const MAX_DELETIONS_PER_BATCH = 3;

type CalendarChangeWindow = typeof window & {
    __onCalendarChange?: (changes: CalendarChange[]) => Promise<void>;
    __onCalendarBulkDeletionSuspected?: (taskIds: string[]) => void;
};

function bulkDeletionWarning(count: number): string {
    return `Apple Calendar reported ${count} events as deleted at once. Nomendex kept those todos — delete them here if that was intentional, or run "Reconcile Calendar" to put the events back.`;
}

/** Registers the incoming-sync handlers. Returns a dispose fn that unregisters them
 *  (used when Apple Calendar sync is toggled off without a reload). */
export function initCalendarChangeListener(
    todosAPI: CalendarTodosAPI,
    options: CalendarChangeListenerOptions = {},
): () => void {
    const win = window as CalendarChangeWindow;
    const handler = async (changes: CalendarChange[]) => {
        let hasChangesToApply = false;

        // Blast-radius cap: hold back a suspicious bulk deletion rather than apply
        // it. Non-deletion changes in the same batch still go through. Deletions a
        // vetting host already confirmed are exempt — it applies a proportional cap
        // of its own, and double-capping would block legitimate cleanups.
        const unvettedDeletions = changes.filter((change) => change.deleted && !change.confirmed);
        const holdDeletions = unvettedDeletions.length > MAX_DELETIONS_PER_BATCH;
        if (holdDeletions) {
            console.warn(
                `[calendar-sync] holding back ${unvettedDeletions.length} unconfirmed incoming deletions in one batch:`,
                unvettedDeletions.map((change) => change.taskId),
            );
            options.onWarning?.(bulkDeletionWarning(unvettedDeletions.length));
        }

        for (const change of changes) {
            try {
                if (change.deleted && !change.confirmed && holdDeletions) {
                    continue;
                }

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
                        // Retire the event instead of destroying it — archiving is
                        // the app's own way to close an event (its status can't be
                        // changed), and it keeps the todo recoverable if the
                        // deletion turns out to have been a bad calendar read.
                        // Scheduled dates stay: outgoing sync skips archived todos,
                        // so nothing re-creates the event the user just deleted.
                        console.warn(`[calendar-sync] archiving event todo ${change.taskId} — deleted in Apple Calendar`);
                        await todosAPI.updateTodo({
                            todoId: change.taskId,
                            updates: { archived: true },
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

    // Native-side counterpart of the cap above: the host detected an implausible
    // number of vanished events and sent nothing to apply, only this warning.
    const bulkHandler = (taskIds: string[]) => {
        console.warn("[calendar-sync] native host suppressed a suspected bulk deletion:", taskIds);
        options.onWarning?.(bulkDeletionWarning(taskIds.length));
    };

    win.__onCalendarChange = handler;
    win.__onCalendarBulkDeletionSuspected = bulkHandler;
    return () => {
        if (win.__onCalendarChange === handler) {
            delete win.__onCalendarChange;
        }
        if (win.__onCalendarBulkDeletionSuspected === bulkHandler) {
            delete win.__onCalendarBulkDeletionSuspected;
        }
    };
}
