import { z } from "zod";
import { TodoSchema } from "@/features/todos/todo-types";

export const DailyPanelInputSchema = z.object({
    fileName: z.string(),
});

const PanelTodoSchema = TodoSchema.pick({ id: true, title: true, project: true });

/**
 * Read-only context shown above a daily note: the plan (previous day's "zítra:" line,
 * todos scheduled for the note's day, todos in progress when it is today) and the
 * todos completed on the note's day.
 */
export const DailyPanelSchema = z.object({
    plan: z.string().optional(),
    scheduledTodos: z.array(PanelTodoSchema.extend({ time: z.string().optional() })),
    inProgressTodos: z.array(PanelTodoSchema),
    completedTodos: z.array(PanelTodoSchema),
});

export type DailyPanel = z.infer<typeof DailyPanelSchema>;
