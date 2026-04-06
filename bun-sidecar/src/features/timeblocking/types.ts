import { z } from "zod";

export const DayTypeSchema = z.enum(["work_full", "work_early", "pohotovost", "free"]);
export type DayType = z.infer<typeof DayTypeSchema>;

export const TimeblockingTemplateEntrySchema = z.object({
    blockType: z.string().min(1),
    start: z.string().min(1), // "HH:mm" or "workEnd+NNmin"
});

export const TimeblockingBlockTypeSchema = z.object({
    title: z.string().min(1),
    durationMin: z.number().int().positive(),
    project: z.string().min(1),
    tags: z.array(z.string()),
    descriptionTemplate: z.string().optional(),
});

export const CoverageRuleSchema = z.object({
    id: z.string().min(1),
    blockType: z.string().min(1),
    minPerWeek: z.number().int().nonnegative(),
    label: z.string().min(1),
});

export const TimeblockingConfigSchema = z.object({
    version: z.literal(1),
    defaults: z.object({
        defaultDayType: DayTypeSchema,
    }),
    blockTypes: z.record(z.string(), TimeblockingBlockTypeSchema),
    dayTemplates: z.object({
        work_full: z.array(TimeblockingTemplateEntrySchema),
        work_early: z.array(TimeblockingTemplateEntrySchema),
        pohotovost: z.array(TimeblockingTemplateEntrySchema),
        free: z.array(TimeblockingTemplateEntrySchema),
    }),
    coverageRules: z.array(CoverageRuleSchema),
});

export type TimeblockingConfig = z.infer<typeof TimeblockingConfigSchema>;
export type CoverageRule = z.infer<typeof CoverageRuleSchema>;
export type TimeblockingTemplateEntry = z.infer<typeof TimeblockingTemplateEntrySchema>;

export interface DayConfig {
    type: DayType;
    workEnd?: string;
}

export interface GeneratedTimeblock {
    blockType: string;
    title: string;
    project: string;
    tags: string[];
    kind: "event";
    source: "timeblock-generator";
    scheduledStart: string;
    scheduledEnd: string;
    status: "todo";
    description: string;
}

export interface TimeblockingConflict {
    code:
        | "unknown-block-type"
        | "missing-work-end"
        | "invalid-time-expression"
        | "invalid-range"
        | "crosses-midnight"
        | "overlap"
        | "missing-project";
    message: string;
    blockType?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    day?: string;
    details?: string;
}

export interface CoverageResult {
    id: string;
    blockType: string;
    label: string;
    minPerWeek: number;
    actual: number;
    status: "ok" | "warning";
}

export interface TimeblockingPreview {
    blocks: GeneratedTimeblock[];
    conflicts: TimeblockingConflict[];
    coverage: CoverageResult[];
}
