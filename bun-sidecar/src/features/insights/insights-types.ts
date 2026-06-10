import { z } from "zod";

/**
 * Behavioral "perception" signals computed deterministically from the current
 * todo / goal / project state. Tier 0 (Patro 0): everything here is derivable
 * from data the workspace already stores — no behavioral-history substrate
 * required yet.
 *
 * Design rule (think-tank "skeptik"): signals state FACTS, never accusations.
 * `detail` carries the numbers; interpretation ("avoidance?") is left to the
 * agent's phrasing so a wrong reading can't be baked into the data layer.
 */

export const InsightSeveritySchema = z.enum(["info", "notice", "warning"]);
export type InsightSeverity = z.infer<typeof InsightSeveritySchema>;

export const InsightTypeSchema = z.enum([
    "effort_distribution",
    "low_throughput",
    "neglected_area",
    "goal_overload",
    "stale_todo",
    "overdue_high_priority",
]);
export type InsightType = z.infer<typeof InsightTypeSchema>;

export const InsightSignalSchema = z.object({
    type: InsightTypeSchema,
    severity: InsightSeveritySchema,
    /** Short factual headline. */
    title: z.string(),
    /** The fact, with numbers. No interpretation. */
    detail: z.string(),
    /** Referenced todos, if any (for the agent to render [[todo:id|..]] links). */
    todoIds: z.array(z.string()).optional(),
    /** Referenced goals, if any. */
    goalIds: z.array(z.string()).optional(),
    /** Goal area this signal concerns, if any. */
    area: z.string().optional(),
    /** Raw numbers behind the signal (e.g. counts per area). */
    metrics: z.record(z.string(), z.number()).optional(),
});
export type InsightSignal = z.infer<typeof InsightSignalSchema>;

export const InsightsReportSchema = z.object({
    generatedAt: z.string(),
    windowDays: z.number(),
    staleDays: z.number(),
    signalCount: z.number(),
    signals: z.array(InsightSignalSchema),
});
export type InsightsReport = z.infer<typeof InsightsReportSchema>;

export const ScanInsightsInputSchema = z.object({
    /** Rolling window for completion/effort signals. Default 7. */
    windowDays: z.number().int().positive().max(90).optional(),
    /** Age (days) at which an untouched open todo counts as stale. Default 14. */
    staleDays: z.number().int().positive().max(365).optional(),
    /**
     * Number of concurrent active, actionable (yearly/quarterly/monthly) goals
     * above which the portfolio counts as overloaded. Default 10.
     */
    goalOverloadThreshold: z.number().int().positive().max(100).optional(),
});
export type ScanInsightsInput = z.infer<typeof ScanInsightsInputSchema>;
