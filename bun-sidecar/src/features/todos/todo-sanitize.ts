import type { Todo } from "./todo-types";

const TODO_STATUSES = new Set(["todo", "in_progress", "done", "later"]);
const TODO_PRIORITIES = new Set(["high", "medium", "low", "none"]);
const TODO_CALENDAR_PRESETS = new Set(["30-15", "none"]);

function toOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function toOptionalStringArray(value: unknown, keepExplicitEmpty = false): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const stringValues = value.filter((item): item is string => typeof item === "string");
    if (stringValues.length > 0) return stringValues;
    if (keepExplicitEmpty && value.length === 0) return [];
    return undefined;
}

export function sanitizeTodoForClient(todo: Todo): Todo {
    const raw = todo as unknown as Record<string, unknown>;

    const maybeStatus = raw.status;
    const maybePriority = raw.priority;
    const maybeReminder = raw.calendarReminderPreset;

    const status = typeof maybeStatus === "string" && TODO_STATUSES.has(maybeStatus)
        ? maybeStatus as Todo["status"]
        : "todo";
    const priority = typeof maybePriority === "string" && TODO_PRIORITIES.has(maybePriority)
        ? maybePriority as Todo["priority"]
        : undefined;
    const calendarReminderPreset = typeof maybeReminder === "string" && TODO_CALENDAR_PRESETS.has(maybeReminder)
        ? maybeReminder as Todo["calendarReminderPreset"]
        : undefined;

    return {
        ...todo,
        status,
        description: toOptionalString(raw.description),
        project: toOptionalString(raw.project),
        tags: toOptionalStringArray(raw.tags),
        scheduledStart: toOptionalString(raw.scheduledStart),
        scheduledEnd: toOptionalString(raw.scheduledEnd),
        dueDate: toOptionalString(raw.dueDate),
        priority,
        duration: typeof raw.duration === "number" && Number.isFinite(raw.duration) && raw.duration > 0
            ? Math.round(raw.duration)
            : undefined,
        attachments: Array.isArray(raw.attachments)
            ? raw.attachments.filter((item) => item != null && typeof item === "object") as Todo["attachments"]
            : undefined,
        customColumnId: toOptionalString(raw.customColumnId),
        calendarReminderPreset,
        goalRefs: toOptionalStringArray(raw.goalRefs, true),
        resolvedGoalRefs: toOptionalStringArray(raw.resolvedGoalRefs),
    };
}

export function sanitizeTodoListForClient(todos: Todo[]): Todo[] {
    return todos.map(sanitizeTodoForClient);
}

export function stripUnexpectedNulls<T extends object>(input: T, nullableKeys: ReadonlySet<string>): Partial<T> {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (value === undefined) continue;
        if (value === null && !nullableKeys.has(key)) continue;
        output[key] = value;
    }
    return output as Partial<T>;
}
