import { describe, expect, test } from "bun:test";
import { computeGoalProgress } from "./fx";
import type { GoalRecord } from "./goal-types";
import type { Todo } from "@/features/todos/todo-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<GoalRecord> & Pick<GoalRecord, "progressMode">): GoalRecord {
    return {
        id: "goal-test",
        title: "Test Goal",
        area: "Test",
        horizon: "yearly",
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...overrides,
    } as GoalRecord;
}

function makeTodo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: `todo-${Math.random().toString(36).slice(2, 6)}`,
        title: "Test Todo",
        status: "todo",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...overrides,
    } as Todo;
}

// ---------------------------------------------------------------------------
// Rollup mode
// ---------------------------------------------------------------------------

describe("computeGoalProgress — rollup", () => {
    test("leaf goal with no todos → 0%", () => {
        const goal = makeGoal({ progressMode: "rollup" });
        expect(computeGoalProgress(goal, [], [])).toBe(0);
    });

    test("leaf goal completed with no todos → 100%", () => {
        const goal = makeGoal({ progressMode: "rollup", status: "completed" });
        expect(computeGoalProgress(goal, [], [])).toBe(100);
    });

    test("leaf goal with 1/3 done todos → 33%", () => {
        const goal = makeGoal({ progressMode: "rollup" });
        const todos = [
            makeTodo({ status: "done" }),
            makeTodo({ status: "todo" }),
            makeTodo({ status: "todo" }),
        ];
        expect(computeGoalProgress(goal, [], todos)).toBe(33);
    });

    test("leaf goal with 2/4 done todos → 50%", () => {
        const goal = makeGoal({ progressMode: "rollup" });
        const todos = [
            makeTodo({ status: "done" }),
            makeTodo({ status: "done" }),
            makeTodo({ status: "todo" }),
            makeTodo({ status: "in_progress" }),
        ];
        expect(computeGoalProgress(goal, [], todos)).toBe(50);
    });

    test("leaf goal with all done → 100%", () => {
        const goal = makeGoal({ progressMode: "rollup" });
        const todos = [makeTodo({ status: "done" }), makeTodo({ status: "done" })];
        expect(computeGoalProgress(goal, [], todos)).toBe(100);
    });

    test("parent with children → average of children progress (leaf-only rule)", () => {
        const parent = makeGoal({ id: "parent", progressMode: "rollup" });
        const child1 = makeGoal({ id: "child1", progressMode: "rollup", parentGoalId: "parent", status: "completed" });
        const child2 = makeGoal({ id: "child2", progressMode: "rollup", parentGoalId: "parent" });
        // child1 = completed with no todos → 100% (via status)
        // child2 = active with no todos → 0%
        // average = 50%
        expect(computeGoalProgress(parent, [child1, child2], [])).toBe(50);
    });

    test("parent with children ignores direct todos (leaf-only)", () => {
        const parent = makeGoal({ id: "parent", progressMode: "rollup" });
        const child = makeGoal({ id: "child", progressMode: "rollup", parentGoalId: "parent" });
        const directTodos = [makeTodo({ status: "done" }), makeTodo({ status: "done" })];
        // Child has no todos → 0%, direct todos are ignored because parent has children
        expect(computeGoalProgress(parent, [child], directTodos)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Metric mode
// ---------------------------------------------------------------------------

describe("computeGoalProgress — metric", () => {
    test("5/10 → 50%", () => {
        const goal = makeGoal({ progressMode: "metric", progressCurrent: 5, progressTarget: 10 });
        expect(computeGoalProgress(goal, [], [])).toBe(50);
    });

    test("0/10 → 0%", () => {
        const goal = makeGoal({ progressMode: "metric", progressCurrent: 0, progressTarget: 10 });
        expect(computeGoalProgress(goal, [], [])).toBe(0);
    });

    test("capped at 100%", () => {
        const goal = makeGoal({ progressMode: "metric", progressCurrent: 15, progressTarget: 10 });
        expect(computeGoalProgress(goal, [], [])).toBe(100);
    });

    test("target 0 → 0% (no division by zero)", () => {
        const goal = makeGoal({ progressMode: "metric", progressCurrent: 5, progressTarget: 0 });
        expect(computeGoalProgress(goal, [], [])).toBe(0);
    });

    test("rounds correctly — 1/3 → 33%", () => {
        const goal = makeGoal({ progressMode: "metric", progressCurrent: 1, progressTarget: 3 });
        expect(computeGoalProgress(goal, [], [])).toBe(33);
    });
});

// ---------------------------------------------------------------------------
// Manual mode
// ---------------------------------------------------------------------------

describe("computeGoalProgress — manual", () => {
    test("returns progressValue directly", () => {
        const goal = makeGoal({ progressMode: "manual", progressValue: 75 });
        expect(computeGoalProgress(goal, [], [])).toBe(75);
    });

    test("rounds to nearest integer", () => {
        const goal = makeGoal({ progressMode: "manual", progressValue: 33.7 });
        expect(computeGoalProgress(goal, [], [])).toBe(34);
    });
});

// ---------------------------------------------------------------------------
// Milestone mode
// ---------------------------------------------------------------------------

describe("computeGoalProgress — milestone", () => {
    test("no children, active → 0%", () => {
        const goal = makeGoal({ progressMode: "milestone" });
        expect(computeGoalProgress(goal, [], [])).toBe(0);
    });

    test("no children, completed → 100%", () => {
        const goal = makeGoal({ progressMode: "milestone", status: "completed" });
        expect(computeGoalProgress(goal, [], [])).toBe(100);
    });

    test("1/2 children completed → 50%", () => {
        const goal = makeGoal({ id: "parent", progressMode: "milestone" });
        const children = [
            makeGoal({ id: "c1", progressMode: "rollup", parentGoalId: "parent", status: "completed" }),
            makeGoal({ id: "c2", progressMode: "rollup", parentGoalId: "parent", status: "active" }),
        ];
        expect(computeGoalProgress(goal, children, [])).toBe(50);
    });

    test("3/3 children completed → 100%", () => {
        const goal = makeGoal({ id: "parent", progressMode: "milestone" });
        const children = [
            makeGoal({ id: "c1", progressMode: "rollup", parentGoalId: "parent", status: "completed" }),
            makeGoal({ id: "c2", progressMode: "rollup", parentGoalId: "parent", status: "completed" }),
            makeGoal({ id: "c3", progressMode: "rollup", parentGoalId: "parent", status: "completed" }),
        ];
        expect(computeGoalProgress(goal, children, [])).toBe(100);
    });

    test("dropped children are excluded from count", () => {
        const goal = makeGoal({ id: "parent", progressMode: "milestone" });
        const children = [
            makeGoal({ id: "c1", progressMode: "rollup", parentGoalId: "parent", status: "completed" }),
            makeGoal({ id: "c2", progressMode: "rollup", parentGoalId: "parent", status: "dropped" }),
        ];
        // Only 1 active child (completed), dropped is excluded → 100%
        expect(computeGoalProgress(goal, children, [])).toBe(100);
    });
});
