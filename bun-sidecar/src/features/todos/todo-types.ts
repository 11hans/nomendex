import { z } from "zod";
import { AttachmentSchema } from "@/types/attachments";

export const TodoSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(["todo", "in_progress", "done", "later"]),
    customColumnId: z.string().optional(), // ID sloupce z BoardConfig
    createdAt: z.string(),
    updatedAt: z.string(),
    archived: z.boolean().optional(),
    project: z.string().optional(),
    order: z.number().optional(),
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
