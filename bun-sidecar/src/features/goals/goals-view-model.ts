import type { GoalRecord } from "./goal-types";
import type { GoalForestNodeView } from "./goals-view-types";

export type GoalAttentionReason =
    | "without_project"
    | "without_next_action"
    | "stale"
    | "nearly_complete";

export type GoalBrowserRow = {
    goal: GoalRecord;
    computedProgress: number;
    linkedProjectCount: number;
    linkedTodoCount: number;
    openTodoCount: number;
    doneTodoCount: number;
    attentionReasons: GoalAttentionReason[];
    needsAttention: boolean;
};

export type GoalBrowserSummary = {
    active: number;
    needsAttention: number;
    withoutProject: number;
    withoutNextAction: number;
};

export type GoalBrowserGroup = {
    horizon: GoalRecord["horizon"];
    label: string;
    rows: GoalBrowserRow[];
};

export type GoalBrowserViewModel = {
    allRows: GoalBrowserRow[];
    filteredRows: GoalBrowserRow[];
    attentionRows: GoalBrowserRow[];
    groups: GoalBrowserGroup[];
    summary: GoalBrowserSummary;
};

const HORIZON_ORDER: GoalRecord["horizon"][] = ["vision", "yearly", "quarterly", "monthly"];
const ATTENTION_SUMMARY_REASONS: GoalAttentionReason[] = ["without_project", "without_next_action", "stale"];

export function statusLabel(status: GoalRecord["status"]): string {
    switch (status) {
        case "active":
            return "Active";
        case "completed":
            return "Completed";
        case "paused":
            return "Paused";
        case "dropped":
            return "Dropped";
        default:
            return status;
    }
}

export function getHorizonLabel(horizon: GoalRecord["horizon"]): string {
    switch (horizon) {
        case "vision":
            return "Vision";
        case "yearly":
            return "Yearly";
        case "quarterly":
            return "Quarterly";
        case "monthly":
            return "Monthly";
        default:
            return horizon;
    }
}

export function flattenGoalForest(forest: GoalForestNodeView[]): GoalForestNodeView[] {
    const flattened: GoalForestNodeView[] = [];

    function visit(node: GoalForestNodeView) {
        flattened.push(node);
        for (const child of node.children) {
            visit(child);
        }
    }

    for (const root of forest) {
        visit(root);
    }

    return flattened;
}

export function computeAttentionReasons(
    row: Pick<GoalBrowserRow, "goal" | "computedProgress" | "linkedProjectCount" | "openTodoCount">,
    now: Date = new Date(),
): GoalAttentionReason[] {
    if (row.goal.status !== "active") {
        return [];
    }

    const reasons: GoalAttentionReason[] = [];
    if (row.linkedProjectCount === 0) {
        reasons.push("without_project");
    }
    if (row.openTodoCount === 0) {
        reasons.push("without_next_action");
    }

    const updatedAt = Date.parse(row.goal.updatedAt);
    if (!Number.isNaN(updatedAt)) {
        const staleThresholdMs = 14 * 24 * 60 * 60 * 1000;
        if (now.getTime() - updatedAt >= staleThresholdMs) {
            reasons.push("stale");
        }
    }

    if (row.computedProgress >= 80 && row.computedProgress < 100) {
        reasons.push("nearly_complete");
    }

    return reasons;
}

function buildSummary(rows: GoalBrowserRow[]): GoalBrowserSummary {
    const activeRows = rows.filter((row) => row.goal.status === "active");

    const withoutProject = activeRows.filter((row) => row.attentionReasons.includes("without_project")).length;
    const withoutNextAction = activeRows.filter((row) => row.attentionReasons.includes("without_next_action")).length;
    const needsAttention = activeRows.filter((row) =>
        ATTENTION_SUMMARY_REASONS.some((reason) => row.attentionReasons.includes(reason))
    ).length;

    return {
        active: activeRows.length,
        needsAttention,
        withoutProject,
        withoutNextAction,
    };
}

export type GoalBrowserFilterMode = "all" | "needs_attention" | "without_project" | "without_next_action";

export function goalMatchesSearch(row: GoalBrowserRow, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;

    return (
        row.goal.title.toLowerCase().includes(normalized)
        || row.goal.area.toLowerCase().includes(normalized)
    );
}

function goalMatchesFilterMode(row: GoalBrowserRow, mode: GoalBrowserFilterMode): boolean {
    if (mode === "all") return true;
    if (mode === "needs_attention") return row.needsAttention;
    if (mode === "without_project") return row.attentionReasons.includes("without_project");
    if (mode === "without_next_action") return row.attentionReasons.includes("without_next_action");
    return true;
}

export function todoStatusColor(status: string, theme: { semanticSuccess: string; contentAccent: string; contentTertiary: string }): string {
    switch (status) {
        case "done":
            return theme.semanticSuccess;
        case "in_progress":
            return theme.contentAccent;
        default:
            return theme.contentTertiary;
    }
}

export function buildGoalsBrowserViewModel(
    forest: GoalForestNodeView[],
    searchQuery: string,
    filterMode: GoalBrowserFilterMode = "all",
    now: Date = new Date(),
): GoalBrowserViewModel {
    const allRows = flattenGoalForest(forest)
        .map((node) => {
            const partial = {
                goal: node.goal,
                computedProgress: node.computedProgress,
                linkedProjectCount: node.linkedProjectCount,
                openTodoCount: node.openTodoCount,
            };
            const attentionReasons = computeAttentionReasons(partial, now);
            const row: GoalBrowserRow = {
                goal: node.goal,
                computedProgress: node.computedProgress,
                linkedProjectCount: node.linkedProjectCount,
                linkedTodoCount: node.linkedTodoCount,
                openTodoCount: node.openTodoCount,
                doneTodoCount: node.doneTodoCount,
                attentionReasons,
                needsAttention: ATTENTION_SUMMARY_REASONS.some((reason) => attentionReasons.includes(reason)),
            };
            return row;
        })
        .sort((a, b) => {
            const horizonDiff = HORIZON_ORDER.indexOf(a.goal.horizon) - HORIZON_ORDER.indexOf(b.goal.horizon);
            if (horizonDiff !== 0) return horizonDiff;
            const areaDiff = a.goal.area.localeCompare(b.goal.area);
            if (areaDiff !== 0) return areaDiff;
            return a.goal.title.localeCompare(b.goal.title);
        });

    const summary = buildSummary(allRows);
    const filteredRows = allRows
        .filter((row) => goalMatchesSearch(row, searchQuery))
        .filter((row) => goalMatchesFilterMode(row, filterMode));
    const attentionRows = filteredRows.filter((row) => row.needsAttention);

    const groups: GoalBrowserGroup[] = HORIZON_ORDER
        .map((horizon) => ({
            horizon,
            label: getHorizonLabel(horizon),
            rows: filteredRows.filter((row) => row.goal.horizon === horizon),
        }))
        .filter((group) => group.rows.length > 0);

    return {
        allRows,
        filteredRows,
        attentionRows,
        groups,
        summary,
    };
}
