import { describe, expect, test } from "bun:test";
import type { GoalRecord } from "./goal-types";
import type { GoalForestNodeView } from "./goals-view-types";
import { buildGoalsBrowserViewModel, computeAttentionReasons, goalMatchesSearch } from "./goals-view-model";

function makeGoal(overrides: Partial<GoalRecord> & Pick<GoalRecord, "id">): GoalRecord {
    const { id, ...rest } = overrides;
    return {
        id,
        title: "Goal",
        area: "Area",
        horizon: "monthly",
        status: "active",
        progressMode: "rollup",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...rest,
    } as GoalRecord;
}

function makeNode(
    goal: GoalRecord,
    overrides: Partial<Omit<GoalForestNodeView, "goal" | "children">> = {},
): GoalForestNodeView {
    return {
        goal,
        children: [],
        linkedProjects: [],
        linkedProjectCount: 0,
        linkedTodoCount: 0,
        openTodoCount: 0,
        doneTodoCount: 0,
        computedProgress: 0,
        isProgressPaused: false,
        ...overrides,
    };
}

describe("goals-view-model", () => {
    test("computes attention reasons for active monthly goal", () => {
        const now = new Date("2026-04-01T00:00:00Z");
        // updatedAt 22 days ago — exceeds monthly stale threshold (10 days)
        const goal = makeGoal({
            id: "goal-1",
            horizon: "monthly",
            updatedAt: "2026-03-10T00:00:00Z",
            status: "active",
        });

        const reasons = computeAttentionReasons(
            {
                goal,
                computedProgress: 85,
                openTodoCount: 0,
            },
            now,
        );

        expect(reasons).toContain("without_next_action");
        expect(reasons).toContain("stale");
        expect(reasons).toContain("nearly_complete");
    });

    test("does not compute attention reasons for non-active goals", () => {
        const goal = makeGoal({
            id: "goal-2",
            status: "completed",
            updatedAt: "2025-01-01T00:00:00Z",
        });

        const reasons = computeAttentionReasons({
            goal,
            computedProgress: 90,
            openTodoCount: 0,
        });

        expect(reasons).toEqual([]);
    });

    test("vision goals never get attention regardless of state", () => {
        const now = new Date("2026-04-01T00:00:00Z");
        const goal = makeGoal({
            id: "goal-vision",
            horizon: "vision",
            updatedAt: "2025-01-01T00:00:00Z", // very old
            status: "active",
        });

        const reasons = computeAttentionReasons(
            { goal, computedProgress: 85, openTodoCount: 0 },
            now,
        );

        expect(reasons).toEqual([]);
    });

    test("yearly goals only get stale after 60 days", () => {
        const now = new Date("2026-04-01T00:00:00Z");
        const goalFresh = makeGoal({ id: "g-year-fresh", horizon: "yearly", updatedAt: "2026-03-01T00:00:00Z", status: "active" });
        const goalStale = makeGoal({ id: "g-year-stale", horizon: "yearly", updatedAt: "2026-01-01T00:00:00Z", status: "active" });

        const reasonsFresh = computeAttentionReasons({ goal: goalFresh, computedProgress: 0, openTodoCount: 0 }, now);
        const reasonsStale = computeAttentionReasons({ goal: goalStale, computedProgress: 0, openTodoCount: 0 }, now);

        expect(reasonsFresh).toEqual([]);
        expect(reasonsStale).toContain("stale");
        expect(reasonsStale).not.toContain("without_next_action");
    });

    test("quarterly goals get stale after 21 days", () => {
        const now = new Date("2026-04-01T00:00:00Z");
        // 22 days ago
        const goal = makeGoal({ id: "g-q-stale", horizon: "quarterly", updatedAt: "2026-03-10T00:00:00Z", status: "active" });

        const reasons = computeAttentionReasons({ goal, computedProgress: 0, openTodoCount: 1 }, now);

        expect(reasons).toContain("stale");
    });

    test("quarterly goals within 21 days are not stale", () => {
        const now = new Date("2026-04-01T00:00:00Z");
        // 2 days ago
        const goal = makeGoal({ id: "g-q-fresh", horizon: "quarterly", updatedAt: "2026-03-30T00:00:00Z", status: "active" });

        const reasons = computeAttentionReasons({ goal, computedProgress: 0, openTodoCount: 1 }, now);

        expect(reasons).not.toContain("stale");
    });

    test("builds summary and groups in horizon order", () => {
        const visionGoal = makeGoal({
            id: "g-vision",
            title: "Vision",
            horizon: "vision",
            area: "A",
            updatedAt: "2026-02-01T00:00:00Z",
        });
        const forest = [
            makeNode(makeGoal({ id: "g-month", title: "Monthly", horizon: "monthly", area: "B", updatedAt: "2026-03-30T00:00:00Z" }), {
                openTodoCount: 1,
            }),
            makeNode(visionGoal, {
                openTodoCount: 0,
                computedProgress: 82,
            }),
            makeNode(makeGoal({ id: "g-quarter", title: "Quarter", horizon: "quarterly", area: "A", updatedAt: "2026-03-30T00:00:00Z" }), {
                openTodoCount: 0,
            }),
            makeNode(makeGoal({ id: "g-year", title: "Year", horizon: "yearly", area: "A", updatedAt: "2026-03-30T00:00:00Z" }), {
                openTodoCount: 1,
            }),
        ];

        const viewModel = buildGoalsBrowserViewModel(forest, "", "all", new Date("2026-04-01T00:00:00Z"));

        // g-quarter: openTodoCount=0 → without_next_action
        // vision/yearly: exempt from execution signals
        // g-month: openTodoCount=1 → no attention
        expect(viewModel.groups.map((group) => group.label)).toEqual(["Vision", "Yearly", "Quarterly", "Monthly"]);
        expect(viewModel.summary.active).toBe(4);
        expect(viewModel.summary.withoutNextAction).toBe(1);
        expect(viewModel.summary.needsAttention).toBe(1);
    });

    test("search matches title and area case-insensitively", () => {
        const goalCareer = makeGoal({ id: "career", title: "Launch Nomendex", area: "Career", horizon: "yearly" });
        const goalHealth = makeGoal({ id: "health", title: "Train Daily", area: "Health", horizon: "monthly" });
        const forest = [
            makeNode(goalCareer, { openTodoCount: 1 }),
            makeNode(goalHealth, { openTodoCount: 1 }),
        ];

        const byTitle = buildGoalsBrowserViewModel(forest, "nomendex");
        const byArea = buildGoalsBrowserViewModel(forest, "HEALTH");

        expect(byTitle.filteredRows.map((row) => row.goal.id)).toEqual(["career"]);
        expect(byArea.filteredRows.map((row) => row.goal.id)).toEqual(["health"]);
        expect(goalMatchesSearch(byArea.filteredRows[0]!, "health")).toBe(true);
    });
});
