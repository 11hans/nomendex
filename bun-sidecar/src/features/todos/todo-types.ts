import { z } from "zod";
import { AttachmentSchema } from "@/types/attachments";

export const TodoKindSchema = z.enum(["task", "event"]);
export const TodoSourceSchema = z.enum(["user", "timeblock-generator"]);

export const RecurrenceFrequencySchema = z.enum(["daily", "weekly", "monthly"]);
export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequencySchema>;

export const RecurrenceSchema = z.object({
    frequency: RecurrenceFrequencySchema,
    interval: z.number().int().min(1).max(99).default(1),
    // Canonical day-of-month for monthly recurrence; preserved across spawns so
    // a "31st" task doesn't permanently drift to 28 after passing through February.
    originDay: z.number().int().min(1).max(31).optional(),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export function formatRecurrence(recurrence: Recurrence): string {
    const n = recurrence.interval;
    const unit = recurrence.frequency === "daily" ? "day"
        : recurrence.frequency === "weekly" ? "week"
        : "month";
    if (n === 1) {
        // Capitalize single-unit labels: Daily/Weekly/Monthly
        return recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1);
    }
    return `Every ${n} ${unit}s`;
}

export type TodoKind = z.infer<typeof TodoKindSchema>;
export type TodoSource = z.infer<typeof TodoSourceSchema>;

export const TodoSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    kind: TodoKindSchema,
    source: TodoSourceSchema,
    status: z.enum(["todo", "planned", "in_progress", "done", "later"]),
    customColumnId: z.string().optional(), // ID sloupce z BoardConfig
    createdAt: z.string(),
    updatedAt: z.string(),
    archived: z.boolean().optional(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
    scheduledStart: z.string().optional(),
    scheduledEnd: z.string().optional(),
    // Semantic note:
    // `dueDate` now means deadline only.
    // Historical data used this field as schedule; startup migrations move that schedule
    // data into `scheduledStart`/`scheduledEnd` and clear `dueDate`.
    dueDate: z.string().optional(),
    priority: z.enum(["high", "medium", "low", "none"]).optional(),
    completedAt: z.string().optional(),
    duration: z.number().optional(),
    attachments: z.array(AttachmentSchema).optional(),
    calendarReminderPreset: z.enum(["30-15", "none"]).optional(),
    goalRefs: z.array(z.string()).optional(), // user/agent editable input
    resolvedGoalRefs: z.array(z.string()).optional(), // frozen snapshot for reporting
    // First-class subtask support (max 1 level deep)
    parentTodoId: z.string().optional(), // set on subtasks; absent on top-level todos
    recurrence: RecurrenceSchema.optional(),
});

export type Todo = z.infer<typeof TodoSchema>;

// Canonical priority config — single source of truth for labels & colors
export const PRIORITY_CONFIG = [
    { value: "high", label: "High", color: "#ef4444" },
    { value: "medium", label: "Medium", color: "#f59e0b" },
    { value: "low", label: "Low", color: "#3b82f6" },
    { value: "none", label: "None", color: undefined },
] as const;

export type PriorityValue = (typeof PRIORITY_CONFIG)[number]["value"];
