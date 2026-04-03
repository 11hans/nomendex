import { describe, expect, test } from "bun:test";
import {
    getExpiredTimeblockIds,
    matchesScheduledOverlap,
    shouldRejectTimeblockCompletionChange,
} from "./fx";
import type { Todo } from "./todo-types";

function makeTodo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: "todo-1",
        title: "Test todo",
        status: "todo",
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-01T10:00:00.000Z",
        archived: false,
        order: 1,
        ...overrides,
    };
}

describe("matchesScheduledOverlap", () => {
    test("matches timed blocks that intersect the requested range", () => {
        const todo = makeTodo({
            scheduledStart: "2026-04-06T18:00",
            scheduledEnd: "2026-04-06T19:00",
        });

        expect(matchesScheduledOverlap(todo, {
            start: "2026-04-06T18:30",
            end: "2026-04-06T20:00",
        })).toBe(true);
    });

    test("treats a todo without scheduledEnd as a point in time", () => {
        const todo = makeTodo({
            scheduledStart: "2026-04-06T09:00",
        });

        expect(matchesScheduledOverlap(todo, {
            start: "2026-04-06T08:30",
            end: "2026-04-06T09:00",
        })).toBe(true);
    });

    test("returns false for unscheduled todos", () => {
        expect(matchesScheduledOverlap(makeTodo(), {
            start: "2026-04-06T08:30",
            end: "2026-04-06T09:00",
        })).toBe(false);
    });
});

describe("shouldRejectTimeblockCompletionChange", () => {
    test("rejects completion when the todo remains a timeblock", () => {
        expect(shouldRejectTimeblockCompletionChange({
            currentTags: ["timeblock", "movement"],
            nextTags: ["timeblock", "movement"],
            status: "done",
            completedAtProvided: false,
        })).toBe(true);
    });

    test("allows completion when the same update removes the timeblock tag", () => {
        expect(shouldRejectTimeblockCompletionChange({
            currentTags: ["timeblock", "movement"],
            nextTags: ["movement"],
            status: "done",
            completedAtProvided: false,
        })).toBe(false);
    });
});

describe("getExpiredTimeblockIds", () => {
    test("selects only past active timeblocks for housekeeping", () => {
        const now = new Date(2026, 3, 7, 8, 0, 0, 0);
        const ids = getExpiredTimeblockIds([
            makeTodo({
                id: "expired",
                tags: ["timeblock"],
                scheduledStart: "2026-04-06T18:00",
                scheduledEnd: "2026-04-06T19:00",
            }),
            makeTodo({
                id: "today",
                tags: ["timeblock"],
                scheduledStart: "2026-04-07T07:00",
                scheduledEnd: "2026-04-07T07:15",
            }),
            makeTodo({
                id: "future",
                tags: ["timeblock"],
                scheduledStart: "2026-04-08T19:30",
                scheduledEnd: "2026-04-08T21:30",
            }),
            makeTodo({
                id: "archived",
                archived: true,
                tags: ["timeblock"],
                scheduledStart: "2026-04-06T09:00",
                scheduledEnd: "2026-04-06T10:00",
            }),
            makeTodo({
                id: "normal-todo",
                tags: ["movement"],
                scheduledStart: "2026-04-06T09:00",
                scheduledEnd: "2026-04-06T10:00",
            }),
        ], now);

        expect(ids).toEqual(["expired"]);
    });
});
