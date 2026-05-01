import { describe, expect, test } from "bun:test";
import type { GoalRecord } from "./goal-types";
import type { GoalForestNodeView } from "./goals-view-types";
import { buildGoalsBrowserViewModel, buildThisQuarterPredicate, computeAttentionReasons, goalMatchesSearch } from "./goals-view-model";

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

    test("hideCompleted toggle excludes completed and dropped goals", () => {
        const forest = [
            makeNode(makeGoal({ id: "g-active", status: "active", horizon: "monthly" }), { openTodoCount: 1 }),
            makeNode(makeGoal({ id: "g-completed", status: "completed", horizon: "monthly" })),
            makeNode(makeGoal({ id: "g-dropped", status: "dropped", horizon: "monthly" })),
            makeNode(makeGoal({ id: "g-paused", status: "paused", horizon: "monthly" })),
        ];

        const visible = buildGoalsBrowserViewModel(forest, "", "all", new Date("2026-05-01T00:00:00Z"), false);
        const hidden = buildGoalsBrowserViewModel(forest, "", "all", new Date("2026-05-01T00:00:00Z"), true);

        expect(visible.filteredRows.map((r) => r.goal.id).sort()).toEqual(["g-active", "g-completed", "g-dropped", "g-paused"]);
        // Paused is intentionally still shown — only completed/dropped get hidden.
        expect(hidden.filteredRows.map((r) => r.goal.id).sort()).toEqual(["g-active", "g-paused"]);
    });

    describe("this_quarter filter", () => {
        const now = new Date("2026-05-01T00:00:00Z"); // Q2 2026

        test("includes active quarterly/monthly goals targeted in current quarter", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-now", horizon: "quarterly", targetDate: "2026-06-30", status: "active" })),
                makeNode(makeGoal({ id: "m-now", horizon: "monthly", targetDate: "2026-05-15", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "this_quarter", now);
            expect(vm.filteredRows.map((r) => r.goal.id).sort()).toEqual(["m-now", "q-now"]);
        });

        test("includes ongoing (no targetDate) quarterly/monthly goals", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-ongoing", horizon: "quarterly", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "this_quarter", now);
            expect(vm.filteredRows.map((r) => r.goal.id)).toEqual(["q-ongoing"]);
        });

        test("excludes overdue goals from prior quarters", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-overdue", horizon: "quarterly", targetDate: "2025-12-31", status: "active" })),
                makeNode(makeGoal({ id: "q-prior-this-year", horizon: "quarterly", targetDate: "2026-03-15", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "this_quarter", now);
            expect(vm.filteredRows).toEqual([]);
        });

        test("excludes vision and yearly goals even when targetDate is in window", () => {
            const forest = [
                makeNode(makeGoal({ id: "y-this-quarter", horizon: "yearly", targetDate: "2026-06-30", status: "active" })),
                makeNode(makeGoal({ id: "v-this-quarter", horizon: "vision", targetDate: "2026-06-30", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "this_quarter", now);
            expect(vm.filteredRows).toEqual([]);
        });

        test("excludes non-active goals", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-paused", horizon: "quarterly", targetDate: "2026-06-30", status: "paused" })),
                makeNode(makeGoal({ id: "q-completed", horizon: "quarterly", targetDate: "2026-06-30", status: "completed" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "this_quarter", now);
            expect(vm.filteredRows).toEqual([]);
        });

        test("count card and filter agree on the same predicate", () => {
            // Spans every relevant case so any drift between the card count and
            // the filter shows up here.
            const forest = [
                makeNode(makeGoal({ id: "q-now", horizon: "quarterly", targetDate: "2026-06-30", status: "active" })),
                makeNode(makeGoal({ id: "m-ongoing", horizon: "monthly", status: "active" })),
                makeNode(makeGoal({ id: "q-overdue", horizon: "quarterly", targetDate: "2025-12-31", status: "active" })),
                makeNode(makeGoal({ id: "y-now", horizon: "yearly", targetDate: "2026-06-30", status: "active" })),
                makeNode(makeGoal({ id: "q-paused", horizon: "quarterly", targetDate: "2026-06-30", status: "paused" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "this_quarter", now);
            const predicate = buildThisQuarterPredicate(now);
            const count = vm.allRows.filter(predicate).length;

            expect(count).toBe(vm.filteredRows.length);
            expect(count).toBe(2);
        });
    });

    describe("future quarter badge", () => {
        const now = new Date("2026-05-01T00:00:00Z"); // Q2 2026

        test("flags strictly-future quarter in same year with bare Q label", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-future-q3", horizon: "quarterly", targetDate: "2026-09-30", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "all", now);
            const row = vm.allRows.find((r) => r.goal.id === "q-future-q3")!;
            expect(row.isFutureQuarter).toBe(true);
            expect(row.quarterBadge).toBe("Q3");
        });

        test("appends year suffix on cross-year future quarters", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-next-year-q1", horizon: "quarterly", targetDate: "2027-03-31", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "all", now);
            const row = vm.allRows.find((r) => r.goal.id === "q-next-year-q1")!;
            expect(row.isFutureQuarter).toBe(true);
            expect(row.quarterBadge).toBe("Q1 '27");
        });

        test("does not flag past quarters", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-past", horizon: "quarterly", targetDate: "2025-12-31", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "all", now);
            const row = vm.allRows.find((r) => r.goal.id === "q-past")!;
            expect(row.isFutureQuarter).toBe(false);
            expect(row.quarterBadge).toBe(null);
        });

        test("does not flag current quarter", () => {
            const forest = [
                makeNode(makeGoal({ id: "q-current", horizon: "quarterly", targetDate: "2026-06-30", status: "active" })),
            ];

            const vm = buildGoalsBrowserViewModel(forest, "", "all", now);
            const row = vm.allRows.find((r) => r.goal.id === "q-current")!;
            expect(row.isFutureQuarter).toBe(false);
            expect(row.quarterBadge).toBe(null);
        });
    });
});
