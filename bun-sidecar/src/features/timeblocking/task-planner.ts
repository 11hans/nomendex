import { getTodoById, updateTodo } from "@/features/todos/fx";
import type { Todo } from "@/features/todos/todo-types";
import { isTaskTodo } from "@/features/todos/todo-kind-utils";
import type {
    TaskPlannerAssignment,
    TaskPlannerConflict,
    TaskPlannerMode,
    TaskPlannerTodoUpdatePreview,
} from "./types";

export interface TaskPlannerPlanInput {
    weekStart: string;
    mode?: TaskPlannerMode;
    assignments: TaskPlannerAssignment[];
}

export interface TaskPlannerPreviewResult {
    weekStart: string;
    mode: TaskPlannerMode;
    updates: TaskPlannerTodoUpdatePreview[];
    conflicts: TaskPlannerConflict[];
    warnings: string[];
}

export interface TaskPlannerApplyResult extends TaskPlannerPreviewResult {
    updatedTodos: Todo[];
    rollback: {
        attempted: number;
        restored: number;
    };
}

interface TaskPlannerDeps {
    getTodoById: typeof getTodoById;
    updateTodo: typeof updateTodo;
}

const defaultDeps: TaskPlannerDeps = {
    getTodoById,
    updateTodo,
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function parseIsoDate(value: string): Date | null {
    const match = value.match(ISO_DATE_RE);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (
        Number.isNaN(parsed.getTime())
        || parsed.getFullYear() !== year
        || parsed.getMonth() !== month - 1
        || parsed.getDate() !== day
    ) {
        return null;
    }
    return parsed;
}

function isMonday(date: Date): boolean {
    return date.getDay() === 1;
}

function formatIsoDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isWithinWeek(date: Date, weekStart: Date): boolean {
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function parseTimeToMinutes(value: string): number | null {
    const match = value.match(TIME_RE);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return (hours * 60) + minutes;
}

function resolveScheduleRange(
    assignment: TaskPlannerAssignment,
    mode: TaskPlannerMode,
): { start: string; end: string; startMinutes?: number; endMinutes?: number } | null {
    if (mode === "day_only") {
        return {
            start: assignment.date,
            end: assignment.date,
        };
    }

    if (!assignment.start || !assignment.end) {
        return null;
    }

    const startMinutes = parseTimeToMinutes(assignment.start);
    const endMinutes = parseTimeToMinutes(assignment.end);
    if (startMinutes === null || endMinutes === null) {
        return null;
    }
    if (endMinutes <= startMinutes) {
        return null;
    }

    return {
        start: `${assignment.date}T${assignment.start}`,
        end: `${assignment.date}T${assignment.end}`,
        startMinutes,
        endMinutes,
    };
}

function detectOverlaps(
    updates: Array<TaskPlannerTodoUpdatePreview & { day: string; startMinutes?: number; endMinutes?: number }>,
): TaskPlannerConflict[] {
    const conflicts: TaskPlannerConflict[] = [];
    const byDay = new Map<string, Array<TaskPlannerTodoUpdatePreview & { day: string; startMinutes?: number; endMinutes?: number }>>();

    for (const update of updates) {
        if (typeof update.startMinutes !== "number" || typeof update.endMinutes !== "number") {
            continue;
        }
        const bucket = byDay.get(update.day) ?? [];
        bucket.push(update);
        byDay.set(update.day, bucket);
    }

    for (const [day, dayUpdates] of byDay.entries()) {
        const sorted = [...dayUpdates].sort((left, right) => (left.startMinutes ?? 0) - (right.startMinutes ?? 0));
        for (let index = 1; index < sorted.length; index += 1) {
            const previous = sorted[index - 1];
            const current = sorted[index];
            if ((previous.endMinutes ?? 0) > (current.startMinutes ?? Number.MAX_SAFE_INTEGER)) {
                conflicts.push({
                    code: "overlap",
                    todoId: current.todoId,
                    message: `Task assignments overlap on ${day}`,
                    details: `${previous.title} overlaps ${current.title}`,
                });
            }
        }
    }

    return conflicts;
}

export async function previewTaskPlannerPlan(
    input: TaskPlannerPlanInput,
    deps: TaskPlannerDeps = defaultDeps,
): Promise<TaskPlannerPreviewResult> {
    if (!Array.isArray(input.assignments) || input.assignments.length === 0) {
        throw new Error("Task planner preview requires at least one assignment.");
    }

    const mode: TaskPlannerMode = input.mode ?? "day_only";
    const weekStart = parseIsoDate(input.weekStart);
    if (!weekStart) {
        throw new Error("weekStart must use YYYY-MM-DD format.");
    }
    if (!isMonday(weekStart)) {
        throw new Error("weekStart must be a Monday.");
    }

    const conflicts: TaskPlannerConflict[] = [];
    const warnings: string[] = [];
    const updates: Array<TaskPlannerTodoUpdatePreview & { day: string; startMinutes?: number; endMinutes?: number }> = [];
    const seenTodoIds = new Set<string>();

    for (const assignment of input.assignments) {
        if (seenTodoIds.has(assignment.todoId)) {
            conflicts.push({
                code: "duplicate-assignment",
                todoId: assignment.todoId,
                message: "Each todo can be assigned only once per request.",
            });
            continue;
        }
        seenTodoIds.add(assignment.todoId);

        const day = parseIsoDate(assignment.date);
        if (!day) {
            conflicts.push({
                code: "invalid-date",
                todoId: assignment.todoId,
                message: `Invalid date '${assignment.date}'. Expected YYYY-MM-DD.`,
            });
            continue;
        }

        if (!isWithinWeek(day, weekStart)) {
            conflicts.push({
                code: "outside-week",
                todoId: assignment.todoId,
                message: `Assignment date ${assignment.date} is outside week ${formatIsoDate(weekStart)}.`,
            });
            continue;
        }

        const schedule = resolveScheduleRange(assignment, mode);
        if (!schedule) {
            conflicts.push({
                code: mode === "exact_time" ? "invalid-range" : "invalid-time",
                todoId: assignment.todoId,
                message: mode === "exact_time"
                    ? "Exact-time mode requires valid start/end and end must be after start."
                    : "Invalid scheduling values.",
            });
            continue;
        }

        let todo: Todo;
        try {
            todo = await deps.getTodoById({ todoId: assignment.todoId });
        } catch {
            conflicts.push({
                code: "missing-todo",
                todoId: assignment.todoId,
                message: `Todo '${assignment.todoId}' was not found.`,
            });
            continue;
        }

        if (!isTaskTodo(todo)) {
            conflicts.push({
                code: "not-task",
                todoId: assignment.todoId,
                message: "Only actionable todos (kind: task) can be scheduled by task planner.",
            });
            continue;
        }

        if (todo.source === "timeblock-generator") {
            warnings.push(`Todo '${todo.title}' uses source 'timeblock-generator'; scheduling continues in task-first mode.`);
        }

        updates.push({
            todoId: todo.id,
            title: todo.title,
            previousScheduledStart: todo.scheduledStart,
            previousScheduledEnd: todo.scheduledEnd,
            nextScheduledStart: schedule.start,
            nextScheduledEnd: schedule.end,
            day: assignment.date,
            startMinutes: schedule.startMinutes,
            endMinutes: schedule.endMinutes,
        });
    }

    if (mode === "exact_time") {
        conflicts.push(...detectOverlaps(updates));
    }

    return {
        weekStart: formatIsoDate(weekStart),
        mode,
        updates: updates.map(({ day: _day, startMinutes: _startMinutes, endMinutes: _endMinutes, ...rest }) => rest),
        conflicts,
        warnings,
    };
}

export async function applyTaskPlannerPlan(
    input: TaskPlannerPlanInput,
    deps: TaskPlannerDeps = defaultDeps,
): Promise<TaskPlannerApplyResult> {
    const preview = await previewTaskPlannerPlan(input, deps);
    if (preview.conflicts.length > 0) {
        throw new Error("Cannot apply task planner plan while conflicts are present.");
    }

    const previousSnapshots = new Map<string, { scheduledStart?: string; scheduledEnd?: string }>();
    const updatedTodos: Todo[] = [];

    for (const update of preview.updates) {
        previousSnapshots.set(update.todoId, {
            scheduledStart: update.previousScheduledStart,
            scheduledEnd: update.previousScheduledEnd,
        });
    }

    try {
        for (const update of preview.updates) {
            const updated = await deps.updateTodo({
                todoId: update.todoId,
                updates: {
                    scheduledStart: update.nextScheduledStart,
                    scheduledEnd: update.nextScheduledEnd,
                },
            });
            updatedTodos.push(updated);
        }
    } catch (error) {
        let restored = 0;
        for (const [todoId, snapshot] of previousSnapshots.entries()) {
            try {
                await deps.updateTodo({
                    todoId,
                    updates: {
                        scheduledStart: snapshot.scheduledStart ?? null,
                        scheduledEnd: snapshot.scheduledEnd ?? null,
                    },
                });
                restored += 1;
            } catch {
                // Best effort rollback.
            }
        }
        throw Object.assign(
            error instanceof Error ? error : new Error(String(error)),
            { rollbackRestored: restored },
        );
    }

    return {
        ...preview,
        updatedTodos,
        rollback: {
            attempted: preview.updates.length,
            restored: 0,
        },
    };
}
