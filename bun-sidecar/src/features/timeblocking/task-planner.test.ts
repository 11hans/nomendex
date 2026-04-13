import { describe, expect, test } from "bun:test";
import type { Todo } from "@/features/todos/todo-types";
import { applyTaskPlannerPlan, previewTaskPlannerPlan } from "./task-planner";

function makeTodo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: "todo-1",
        title: "Write docs",
        kind: "task",
        source: "user",
        status: "todo",
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-01T10:00:00.000Z",
        ...overrides,
    };
}

describe("task planner preview", () => {
    test("builds day-only updates for task todos", async () => {
        const todo = makeTodo();
        const preview = await previewTaskPlannerPlan(
            {
                weekStart: "2026-04-06",
                mode: "day_only",
                assignments: [{ todoId: todo.id, date: "2026-04-07" }],
            },
            {
                getTodoById: async () => todo,
                updateTodo: async () => {
                    throw new Error("not used in preview");
                },
            },
        );

        expect(preview.conflicts).toHaveLength(0);
        expect(preview.updates).toEqual([{
            todoId: todo.id,
            title: todo.title,
            previousScheduledStart: undefined,
            previousScheduledEnd: undefined,
            nextScheduledStart: "2026-04-07",
            nextScheduledEnd: "2026-04-07",
        }]);
    });

    test("detects overlap in exact-time mode", async () => {
        const first = makeTodo({ id: "todo-1", title: "Task A" });
        const second = makeTodo({ id: "todo-2", title: "Task B" });
        const preview = await previewTaskPlannerPlan(
            {
                weekStart: "2026-04-06",
                mode: "exact_time",
                assignments: [
                    { todoId: first.id, date: "2026-04-07", start: "09:00", end: "10:00" },
                    { todoId: second.id, date: "2026-04-07", start: "09:30", end: "10:30" },
                ],
            },
            {
                getTodoById: async ({ todoId }) => (todoId === first.id ? first : second),
                updateTodo: async () => {
                    throw new Error("not used in preview");
                },
            },
        );

        expect(preview.conflicts.some((conflict) => conflict.code === "overlap")).toBe(true);
    });

    test("rejects event todos", async () => {
        const eventTodo = makeTodo({ id: "event-1", kind: "event" });
        const preview = await previewTaskPlannerPlan(
            {
                weekStart: "2026-04-06",
                assignments: [{ todoId: eventTodo.id, date: "2026-04-08" }],
            },
            {
                getTodoById: async () => eventTodo,
                updateTodo: async () => {
                    throw new Error("not used in preview");
                },
            },
        );

        expect(preview.conflicts.some((conflict) => conflict.code === "not-task")).toBe(true);
    });
});

describe("task planner apply", () => {
    test("updates only targeted todos and never creates events", async () => {
        const todo = makeTodo({ id: "todo-apply-1", title: "Ship feature" });
        const updates: Array<{ todoId: string; scheduledStart?: string | null; scheduledEnd?: string | null }> = [];

        const result = await applyTaskPlannerPlan(
            {
                weekStart: "2026-04-06",
                mode: "exact_time",
                assignments: [{ todoId: todo.id, date: "2026-04-09", start: "08:30", end: "10:00" }],
            },
            {
                getTodoById: async () => todo,
                updateTodo: async ({ todoId, updates: patch }) => {
                    updates.push({
                        todoId,
                        scheduledStart: patch.scheduledStart,
                        scheduledEnd: patch.scheduledEnd,
                    });
                    return {
                        ...todo,
                        scheduledStart: patch.scheduledStart ?? undefined,
                        scheduledEnd: patch.scheduledEnd ?? undefined,
                    };
                },
            },
        );

        expect(result.conflicts).toHaveLength(0);
        expect(result.updatedTodos).toHaveLength(1);
        expect(result.updatedTodos[0]?.kind).toBe("task");
        expect(updates).toEqual([
            {
                todoId: todo.id,
                scheduledStart: "2026-04-09T08:30",
                scheduledEnd: "2026-04-09T10:00",
            },
        ]);
    });
});
