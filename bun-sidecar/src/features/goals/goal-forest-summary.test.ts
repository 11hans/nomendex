import { describe, expect, test } from "bun:test";
import type { GoalRecord } from "./goal-types";
import type { ProjectConfig } from "@/features/projects/project-types";
import type { Todo } from "@/features/todos/todo-types";
import { buildGoalForestNodes } from "./fx";

function makeGoal(overrides: Partial<GoalRecord> & Pick<GoalRecord, "id" | "progressMode">): GoalRecord {
    const { id, ...rest } = overrides;
    return {
        id,
        title: "Goal",
        area: "Area",
        horizon: "yearly",
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...rest,
    } as GoalRecord;
}

function makeProject(overrides: Partial<ProjectConfig> & Pick<ProjectConfig, "id" | "name">): ProjectConfig {
    const { id, name, ...rest } = overrides;
    return {
        id,
        name,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...rest,
    } as ProjectConfig;
}

function makeTodo(overrides: Partial<Todo> & Pick<Todo, "id" | "status">): Todo {
    const { id, status, ...rest } = overrides;
    return {
        id,
        title: "Todo",
        kind: "task",
        source: "user",
        status,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        ...rest,
    } as Todo;
}

describe("buildGoalForestNodes", () => {
    test("computes summary counts without N+1-style filtering assumptions", () => {
        const rootGoal = makeGoal({ id: "goal-root", progressMode: "rollup" });
        const childGoal = makeGoal({ id: "goal-child", parentGoalId: "goal-root", progressMode: "rollup" });

        const linkedProject = makeProject({ id: "project-1", name: "Project 1", goalRef: "goal-root" });

        const todos = [
            makeTodo({ id: "todo-open-task", status: "todo", goalRefs: ["goal-root"] }),
            makeTodo({ id: "todo-done-task", status: "done", goalRefs: ["goal-root"] }),
            makeTodo({ id: "todo-event", status: "todo", kind: "event", goalRefs: ["goal-root"] }),
            makeTodo({ id: "todo-child", status: "in_progress", goalRefs: ["goal-child"] }),
        ];

        const forest = buildGoalForestNodes({
            allGoals: [rootGoal, childGoal],
            allProjects: [linkedProject],
            allTodos: todos,
        });

        expect(forest).toHaveLength(1);
        const rootNode = forest[0]!;
        const childNode = rootNode.children[0]!;

        expect(rootNode.linkedProjectCount).toBe(1);
        expect(rootNode.linkedTodoCount).toBe(3);
        expect(rootNode.openTodoCount).toBe(1); // task only (event excluded)
        expect(rootNode.doneTodoCount).toBe(1);

        expect(childNode.linkedProjectCount).toBe(0);
        expect(childNode.linkedTodoCount).toBe(1);
        expect(childNode.openTodoCount).toBe(1);
        expect(childNode.doneTodoCount).toBe(0);
    });

    test("returns zeroed counts when goal has no linked entities", () => {
        const loneGoal = makeGoal({ id: "goal-alone", progressMode: "manual", progressValue: 30 });

        const forest = buildGoalForestNodes({
            allGoals: [loneGoal],
            allProjects: [],
            allTodos: [],
        });

        expect(forest).toHaveLength(1);
        expect(forest[0]!.linkedProjectCount).toBe(0);
        expect(forest[0]!.linkedTodoCount).toBe(0);
        expect(forest[0]!.openTodoCount).toBe(0);
        expect(forest[0]!.doneTodoCount).toBe(0);
    });

    describe("isProgressPaused", () => {
        test("flags rollup goal whose only children are paused/dropped and which has no open todos", () => {
            const root = makeGoal({ id: "goal-root", progressMode: "rollup" });
            const pausedChild = makeGoal({ id: "goal-paused", parentGoalId: "goal-root", progressMode: "rollup", status: "paused" });
            const droppedChild = makeGoal({ id: "goal-dropped", parentGoalId: "goal-root", progressMode: "rollup", status: "dropped" });

            const forest = buildGoalForestNodes({
                allGoals: [root, pausedChild, droppedChild],
                allProjects: [],
                allTodos: [],
            });

            expect(forest[0]!.isProgressPaused).toBe(true);
        });

        test("does NOT flag when goal has open task todos even if all child goals are paused", () => {
            const root = makeGoal({ id: "goal-root", progressMode: "rollup" });
            const pausedChild = makeGoal({ id: "goal-paused", parentGoalId: "goal-root", progressMode: "rollup", status: "paused" });

            const forest = buildGoalForestNodes({
                allGoals: [root, pausedChild],
                allProjects: [],
                allTodos: [
                    makeTodo({ id: "todo-open", status: "in_progress", goalRefs: ["goal-root"] }),
                ],
            });

            expect(forest[0]!.isProgressPaused).toBe(false);
        });

        test("does NOT flag when at least one child goal is active", () => {
            const root = makeGoal({ id: "goal-root", progressMode: "rollup" });
            const activeChild = makeGoal({ id: "goal-active", parentGoalId: "goal-root", progressMode: "rollup", status: "active" });
            const pausedChild = makeGoal({ id: "goal-paused", parentGoalId: "goal-root", progressMode: "rollup", status: "paused" });

            const forest = buildGoalForestNodes({
                allGoals: [root, activeChild, pausedChild],
                allProjects: [],
                allTodos: [],
            });

            expect(forest[0]!.isProgressPaused).toBe(false);
        });

        test("does NOT flag non-rollup progress modes", () => {
            const root = makeGoal({ id: "goal-root", progressMode: "manual", progressValue: 50 });
            const pausedChild = makeGoal({ id: "goal-paused", parentGoalId: "goal-root", progressMode: "rollup", status: "paused" });

            const forest = buildGoalForestNodes({
                allGoals: [root, pausedChild],
                allProjects: [],
                allTodos: [],
            });

            expect(forest[0]!.isProgressPaused).toBe(false);
        });

        test("does NOT flag leaf goals (no children)", () => {
            const lone = makeGoal({ id: "goal-lone", progressMode: "rollup", status: "active" });

            const forest = buildGoalForestNodes({
                allGoals: [lone],
                allProjects: [],
                allTodos: [],
            });

            expect(forest[0]!.isProgressPaused).toBe(false);
        });
    });
});
