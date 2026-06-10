import { getTodos, getArchivedTodos } from "@/features/todos/fx";
import { listProjects } from "@/features/projects/fx";
import { getGoals } from "@/features/goals/fx";
import { createServiceLogger } from "@/lib/logger";
import { computeInsights } from "./insights";
import type { InsightsReport, ScanInsightsInput } from "./insights-types";

const insightsLogger = createServiceLogger("INSIGHTS");

/**
 * Fetch current workspace state and compute Tier-0 behavioral signals.
 * Thin I/O wrapper around the pure `computeInsights`.
 */
export async function scanInsights(input: ScanInsightsInput = {}): Promise<InsightsReport> {
    const [todos, archivedTodos, projects, goals] = await Promise.all([
        getTodos({ includeSubtasks: true }),
        getArchivedTodos({}),
        listProjects({ includeArchived: true }),
        getGoals({}),
    ]);

    const report = computeInsights({
        todos,
        archivedTodos,
        projects: projects.map((p) => ({ name: p.name, goalRef: p.goalRef })),
        goals,
        windowDays: input.windowDays,
        staleDays: input.staleDays,
        goalOverloadThreshold: input.goalOverloadThreshold,
    });

    insightsLogger.info(`Produced ${report.signalCount} signals`, {
        windowDays: report.windowDays,
        staleDays: report.staleDays,
    });
    return report;
}
