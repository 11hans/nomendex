import { z } from "zod";

const GoalBaseSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    area: z.string(), // e.g., "Career & Professional", "Health & Wellness"
    horizon: z.enum(["vision", "yearly", "quarterly", "monthly"]),
    status: z.enum(["active", "completed", "paused", "dropped"]),
    parentGoalId: z.string().optional(),
    targetDate: z.string().optional(), // YYYY-MM-DD
    tags: z.array(z.string()).optional(),
    mirrorNoteFile: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// Discriminated union for progress mode
const RollupProgressSchema = z.object({ progressMode: z.literal("rollup") });
const MetricProgressSchema = z.object({
    progressMode: z.literal("metric"),
    progressCurrent: z.number(),
    progressTarget: z.number(),
});
const ManualProgressSchema = z.object({
    progressMode: z.literal("manual"),
    progressValue: z.number().min(0).max(100),
});
const MilestoneProgressSchema = z.object({ progressMode: z.literal("milestone") });

const GoalProgressSchema = z.discriminatedUnion("progressMode", [
    RollupProgressSchema,
    MetricProgressSchema,
    ManualProgressSchema,
    MilestoneProgressSchema,
]);

// Full GoalRecord = base + progress
export const GoalRecordSchema = GoalBaseSchema.and(GoalProgressSchema);
export type GoalRecord = z.infer<typeof GoalRecordSchema>;

// Export sub-schemas for reuse
export type GoalProgress = z.infer<typeof GoalProgressSchema>;
export { GoalBaseSchema, GoalProgressSchema };
