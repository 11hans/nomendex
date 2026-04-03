import { describe, expect, test } from "bun:test";
import type { Todo } from "./todo-types";
import { sanitizeTodoForClient, stripUnexpectedNulls } from "./todo-sanitize";

function makeTodo(overrides: Record<string, unknown> = {}): Todo {
    return {
        id: "todo-1",
        title: "Test",
        status: "todo",
        createdAt: "2026-04-02T10:00:00.000Z",
        updatedAt: "2026-04-02T10:00:00.000Z",
        ...overrides,
    } as Todo;
}

describe("sanitizeTodoForClient", () => {
    test("converts legacy null optional fields to undefined", () => {
        const sanitized = sanitizeTodoForClient(makeTodo({
            description: null,
            project: null,
            tags: null,
            goalRefs: null,
            resolvedGoalRefs: null,
            dueDate: null,
            scheduledStart: null,
            scheduledEnd: null,
            calendarReminderPreset: null,
            customColumnId: null,
        }));

        expect(sanitized.description).toBeUndefined();
        expect(sanitized.project).toBeUndefined();
        expect(sanitized.tags).toBeUndefined();
        expect(sanitized.goalRefs).toBeUndefined();
        expect(sanitized.resolvedGoalRefs).toBeUndefined();
        expect(sanitized.dueDate).toBeUndefined();
        expect(sanitized.scheduledStart).toBeUndefined();
        expect(sanitized.scheduledEnd).toBeUndefined();
        expect(sanitized.calendarReminderPreset).toBeUndefined();
        expect(sanitized.customColumnId).toBeUndefined();
    });

    test("preserves explicit empty goalRefs as no-goal signal", () => {
        const sanitized = sanitizeTodoForClient(makeTodo({ goalRefs: [] }));
        expect(sanitized.goalRefs).toEqual([]);
    });

    test("filters malformed string arrays defensively", () => {
        const sanitized = sanitizeTodoForClient(makeTodo({
            tags: ["work", 1, null, "focus"],
            goalRefs: ["goal-1", 2],
            resolvedGoalRefs: [true, "goal-2"],
        }));

        expect(sanitized.tags).toEqual(["work", "focus"]);
        expect(sanitized.goalRefs).toEqual(["goal-1"]);
        expect(sanitized.resolvedGoalRefs).toEqual(["goal-2"]);
    });
});

describe("stripUnexpectedNulls", () => {
    test("removes undefined and unexpected null values but keeps allowed null", () => {
        const sanitized = stripUnexpectedNulls(
            {
                title: "Task",
                description: null,
                dueDate: null,
                scheduledStart: null,
                tags: undefined,
            },
            new Set(["dueDate", "scheduledStart"])
        );

        expect(sanitized).toEqual({
            title: "Task",
            dueDate: null,
            scheduledStart: null,
        });
    });
});
