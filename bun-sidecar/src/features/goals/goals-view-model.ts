import type { GoalRecord } from "./goal-types";
import type { GoalForestNodeView } from "./goals-view-types";

export type GoalAttentionReason =
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
    isProgressPaused: boolean;
    isFutureQuarter: boolean;
    quarterBadge: string | null;
};

export type GoalBrowserSummary = {
    active: number;
    focus: number;
    needsAttention: number;
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
const ATTENTION_SUMMARY_REASONS: GoalAttentionReason[] = ["without_next_action", "stale"];

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

function getQuarterEnd(year: number, quarter: number): string {
    const lastDay: Record<number, string> = {
        1: "03-31",
        2: "06-30",
        3: "09-30",
        4: "12-31",
    };
    return `${year}-${lastDay[quarter] || "12-31"}`;
}

function getQuarterFromDate(dateStr: string): number {
    const month = parseInt(dateStr.substring(5, 7), 10);
    if (month <= 3) return 1;
    if (month <= 6) return 2;
    if (month <= 9) return 3;
    return 4;
}

function getCurrentQuarter(now: Date): number {
    const month = now.getMonth() + 1;
    if (month <= 3) return 1;
    if (month <= 6) return 2;
    if (month <= 9) return 3;
    return 4;
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

// Stale threshold per horizon. null = never stale (aspirational goals).
const HORIZON_STALE_DAYS: Record<GoalRecord["horizon"], number | null> = {
    vision: null,
    yearly: 60,
    quarterly: 21,
    monthly: 10,
};

// Whether a horizon tracks execution signals (without_next_action, nearly_complete).
// Vision and Yearly goals are strategic — they drive child goals, not direct todos.
const HORIZON_TRACK_EXECUTION: Record<GoalRecord["horizon"], boolean> = {
    vision: false,
    yearly: false,
    quarterly: true,
    monthly: true,
};

export function computeAttentionReasons(
    row: Pick<GoalBrowserRow, "goal" | "computedProgress" | "openTodoCount">,
    now: Date = new Date(),
): GoalAttentionReason[] {
    if (row.goal.status !== "active") {
        return [];
    }

    const { horizon } = row.goal;
    const reasons: GoalAttentionReason[] = [];

    if (HORIZON_TRACK_EXECUTION[horizon]) {
        if (row.openTodoCount === 0) {
            reasons.push("without_next_action");
        }
        if (row.computedProgress >= 80 && row.computedProgress < 100) {
            reasons.push("nearly_complete");
        }
    }

    const staleDays = HORIZON_STALE_DAYS[horizon];
    if (staleDays !== null) {
        const updatedAt = Date.parse(row.goal.updatedAt);
        if (!Number.isNaN(updatedAt)) {
            const staleThresholdMs = staleDays * 24 * 60 * 60 * 1000;
            if (now.getTime() - updatedAt >= staleThresholdMs) {
                reasons.push("stale");
            }
        }
    }

    return reasons;
}

function buildSummary(rows: GoalBrowserRow[]): GoalBrowserSummary {
    const activeRows = rows.filter((row) => row.goal.status === "active");

    const withoutNextAction = activeRows.filter((row) => row.attentionReasons.includes("without_next_action")).length;
    const needsAttention = activeRows.filter((row) =>
        ATTENTION_SUMMARY_REASONS.some((reason) => row.attentionReasons.includes(reason))
    ).length;
    const focus = activeRows.filter((row) => row.goal.focus === true).length;

    return {
        active: activeRows.length,
        focus,
        needsAttention,
        withoutNextAction,
    };
}

export type GoalBrowserFilterMode = "all" | "needs_attention" | "without_next_action" | "focus" | "this_quarter";

export function goalMatchesSearch(row: GoalBrowserRow, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;

    return (
        row.goal.title.toLowerCase().includes(normalized)
        || row.goal.area.toLowerCase().includes(normalized)
    );
}

function goalMatchesFilterMode(row: GoalBrowserRow, mode: GoalBrowserFilterMode, currentQuarterEnd: string): boolean {
    if (mode === "all") return true;
    if (mode === "needs_attention") return row.needsAttention;
    if (mode === "without_next_action") return row.attentionReasons.includes("without_next_action");
    if (mode === "focus") return row.goal.focus === true;
    if (mode === "this_quarter") {
        if (row.goal.status !== "active") return false;
        if (!row.goal.targetDate) return true; // ongoing, no specific date
        return row.goal.targetDate <= currentQuarterEnd;
    }
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
    hideCompleted = false,
): GoalBrowserViewModel {
    const currentQuarter = getCurrentQuarter(now);
    const currentYear = now.getFullYear();
    const currentQuarterEnd = getQuarterEnd(currentYear, currentQuarter);

    const allRows = flattenGoalForest(forest)
        .map((node) => {
            const partial = {
                goal: node.goal,
                computedProgress: node.computedProgress,
                openTodoCount: node.openTodoCount,
            };
            const attentionReasons = computeAttentionReasons(partial, now);

            let isFutureQuarter = false;
            let quarterBadge: string | null = null;
            if (node.goal.horizon === "quarterly" && node.goal.targetDate) {
                const targetQuarter = getQuarterFromDate(node.goal.targetDate);
                if (targetQuarter > currentQuarter || (node.goal.targetDate.substring(0, 4) > String(currentYear))) {
                    isFutureQuarter = true;
                    quarterBadge = `Q${targetQuarter}`;
                }
            }

            const row: GoalBrowserRow = {
                goal: node.goal,
                computedProgress: node.computedProgress,
                linkedProjectCount: node.linkedProjectCount,
                linkedTodoCount: node.linkedTodoCount,
                openTodoCount: node.openTodoCount,
                doneTodoCount: node.doneTodoCount,
                attentionReasons,
                needsAttention: ATTENTION_SUMMARY_REASONS.some((reason) => attentionReasons.includes(reason)),
                isProgressPaused: node.isProgressPaused,
                isFutureQuarter,
                quarterBadge,
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
        .filter((row) => !hideCompleted || (row.goal.status !== "completed" && row.goal.status !== "dropped"))
        .filter((row) => goalMatchesSearch(row, searchQuery))
        .filter((row) => goalMatchesFilterMode(row, filterMode, currentQuarterEnd));
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
