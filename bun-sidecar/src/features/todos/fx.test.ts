import { describe, expect, test } from "bun:test";
import {
    collectRequestedKinds,
    collectRequestedSources,
    collectRequestedStatuses,
    getExpiredTimeblockIds,
    getLegacyTimeblockBackfillUpdates,
    matchesScheduledOverlap,
    shouldRejectEventLifecycleChange,
} from "./fx";
import type { Todo } from "./todo-types";

function makeTodo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: "todo-1",
        title: "Test todo",
        kind: "task",
        source: "user",
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

describe("collectRequestedStatuses", () => {
    test("returns empty set when no filters are provided", () => {
        const statuses = collectRequestedStatuses({});
        expect(statuses.size).toBe(0);
    });

    test("merges status and statuses into a de-duplicated set", () => {
        const statuses = collectRequestedStatuses({
            status: "in_progress",
            statuses: ["todo", "in_progress", "done"],
        });

        expect(Array.from(statuses).sort()).toEqual(["done", "in_progress", "todo"]);
    });
});

describe("collectRequestedKinds", () => {
    test("returns empty set when no kind filters are provided", () => {
        const kinds = collectRequestedKinds({});
        expect(kinds.size).toBe(0);
    });

    test("merges kind and kinds into a de-duplicated set", () => {
        const kinds = collectRequestedKinds({
            kind: "task",
            kinds: ["event", "task"],
        });

        expect(Array.from(kinds).sort()).toEqual(["event", "task"]);
    });
});

describe("collectRequestedSources", () => {
    test("returns empty set when no source filters are provided", () => {
        const sources = collectRequestedSources({});
        expect(sources.size).toBe(0);
    });

    test("merges source and sources into a de-duplicated set", () => {
        const sources = collectRequestedSources({
            source: "user",
            sources: ["timeblock-generator", "user"],
        });

        expect(Array.from(sources).sort()).toEqual(["timeblock-generator", "user"]);
    });
});

describe("shouldRejectEventLifecycleChange", () => {
    test("rejects completion when an event is moved to done", () => {
        expect(shouldRejectEventLifecycleChange({
            currentKind: "event",
            nextKind: "event",
            currentStatus: "todo",
            nextStatus: "done",
            completedAtProvided: false,
            kindChanged: false,
            statusChanged: true,
        })).toBe(true);
    });

    test("rejects converting a done task into an event without resetting status", () => {
        expect(shouldRejectEventLifecycleChange({
            currentKind: "task",
            nextKind: "event",
            currentStatus: "done",
            nextStatus: undefined,
            completedAtProvided: false,
            kindChanged: true,
            statusChanged: false,
        })).toBe(true);
    });

    test("allows active event updates that keep status todo", () => {
        expect(shouldRejectEventLifecycleChange({
            currentKind: "event",
            nextKind: "event",
            currentStatus: "todo",
            nextStatus: "todo",
            completedAtProvided: false,
            kindChanged: false,
            statusChanged: true,
        })).toBe(false);
    });
});

describe("getExpiredTimeblockIds", () => {
    test("selects only past active timeblocks for housekeeping", () => {
        const now = new Date(2026, 3, 7, 8, 0, 0, 0);
        const ids = getExpiredTimeblockIds([
            makeTodo({
                id: "expired",
                kind: "event",
                tags: ["timeblock"],
                scheduledStart: "2026-04-06T18:00",
                scheduledEnd: "2026-04-06T19:00",
            }),
            makeTodo({
                id: "today",
                kind: "event",
                tags: ["timeblock"],
                scheduledStart: "2026-04-07T07:00",
                scheduledEnd: "2026-04-07T07:15",
            }),
            makeTodo({
                id: "future",
                kind: "event",
                tags: ["timeblock"],
                scheduledStart: "2026-04-08T19:30",
                scheduledEnd: "2026-04-08T21:30",
            }),
            makeTodo({
                id: "archived",
                archived: true,
                kind: "event",
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

    test("detects generated events by source without legacy timeblock tag", () => {
        const now = new Date(2026, 3, 7, 8, 0, 0, 0);
        const ids = getExpiredTimeblockIds([
            makeTodo({
                id: "expired-by-source",
                kind: "event",
                source: "timeblock-generator",
                tags: [],
                scheduledStart: "2026-04-06T14:00",
                scheduledEnd: "2026-04-06T15:00",
            }),
            makeTodo({
                id: "future-by-source",
                kind: "event",
                source: "timeblock-generator",
                tags: [],
                scheduledStart: "2026-04-08T10:00",
                scheduledEnd: "2026-04-08T11:00",
            }),
            makeTodo({
                id: "user-event",
                kind: "event",
                source: "user",
                tags: [],
                scheduledStart: "2026-04-06T14:00",
                scheduledEnd: "2026-04-06T15:00",
            }),
        ], now);

        expect(ids).toEqual(["expired-by-source"]);
    });

    test("keeps legacy tag fallback even when a legacy item still says task/user", () => {
        const now = new Date(2026, 3, 7, 8, 0, 0, 0);
        const ids = getExpiredTimeblockIds([
            makeTodo({
                id: "legacy-task-tag",
                kind: "task",
                source: "user",
                tags: ["timeblock"],
                scheduledStart: "2026-04-06T07:00",
                scheduledEnd: "2026-04-06T07:30",
            }),
        ], now);

        expect(ids).toEqual(["legacy-task-tag"]);
    });
});

describe("getLegacyTimeblockBackfillUpdates", () => {
    test("returns null for non-timeblock todos", () => {
        expect(getLegacyTimeblockBackfillUpdates({
            kind: "task",
            source: "user",
            status: "todo",
            tags: ["movement"],
        })).toBeNull();
    });

    test("backfills legacy tagged items to canonical generated event semantics", () => {
        expect(getLegacyTimeblockBackfillUpdates({
            kind: "task",
            source: "user",
            status: "in_progress",
            completedAt: "2026-04-01T10:00:00.000Z",
            tags: ["timeblock", "movement"],
        })).toEqual({
            kind: "event",
            source: "timeblock-generator",
            status: "todo",
            completedAt: undefined,
        });
    });

    test("skips already canonical generated timeblock events", () => {
        expect(getLegacyTimeblockBackfillUpdates({
            kind: "event",
            source: "timeblock-generator",
            status: "todo",
            tags: ["timeblock"],
        })).toBeNull();
    });
});
