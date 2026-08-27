import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initCalendarChangeListener } from "./calendar-change-bridge";

type TestWindow = {
    dispatchEvent: (event: Event) => boolean;
    __onCalendarChange?: (changes: unknown[]) => Promise<void>;
    __onCalendarBulkDeletionSuspected?: (taskIds: string[]) => void;
};

const originalWindow = globalThis.window;

function testWindow(): TestWindow | undefined {
    return (globalThis as { window?: TestWindow }).window;
}

describe("calendar change bridge", () => {
    const dispatchedEvents: string[] = [];

    beforeEach(() => {
        dispatchedEvents.length = 0;
        (globalThis as { window?: TestWindow }).window = {
            dispatchEvent: (event: Event) => {
                dispatchedEvents.push(event.type);
                return true;
            },
        };
    });

    afterEach(() => {
        (globalThis as { window?: unknown }).window = originalWindow;
    });

    test("deleting a scheduled task only unschedules it", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            getTodoById: async () => ({
                id: "task-1",
                kind: "task",
                source: "user",
                status: "todo",
                tags: [],
                scheduledStart: "2026-04-08T10:00",
                scheduledEnd: "2026-04-08T11:00",
                calendarReminderPreset: "30-15",
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        });

        await testWindow()?.__onCalendarChange?.([{ taskId: "task-1", deleted: true }]);

        expect(updates).toEqual([{
            todoId: "task-1",
            updates: {
                scheduledStart: null,
                scheduledEnd: null,
                calendarReminderPreset: "none",
            },
        }]);
        expect(dispatchedEvents).toEqual(["calendar-sync-update"]);
    });

    test("deleting an event archives the todo instead of destroying it", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            getTodoById: async () => ({
                id: "event-1",
                kind: "event",
                source: "user",
                status: "todo",
                tags: [],
                scheduledStart: "2026-04-08T10:00",
                scheduledEnd: "2026-04-08T11:00",
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        });

        await testWindow()?.__onCalendarChange?.([{ taskId: "event-1", deleted: true }]);

        expect(updates).toEqual([{
            todoId: "event-1",
            updates: { archived: true },
        }]);
        expect(dispatchedEvents).toEqual(["calendar-sync-update"]);
    });

    test("a batch of many deletions is held back and warned about", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        const warnings: string[] = [];
        initCalendarChangeListener({
            getTodoById: async ({ todoId }) => ({
                id: todoId,
                kind: "event",
                source: "timeblock-generator",
                status: "todo",
                tags: [],
                scheduledStart: "2026-04-08T10:00",
                scheduledEnd: "2026-04-08T11:00",
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        }, { onWarning: (message) => warnings.push(message) });

        const deletions = Array.from({ length: 12 }, (_, index) => ({ taskId: `event-${index}`, deleted: true }));
        await testWindow()?.__onCalendarChange?.(deletions);

        expect(updates).toEqual([]);
        expect(dispatchedEvents).toEqual([]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("12 events");
    });

    test("held-back deletions do not block other changes in the same batch", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            getTodoById: async ({ todoId }) => ({
                id: todoId,
                kind: "event",
                source: "user",
                status: "todo",
                tags: [],
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        });

        await testWindow()?.__onCalendarChange?.([
            ...Array.from({ length: 4 }, (_, index) => ({ taskId: `event-${index}`, deleted: true })),
            { taskId: "event-moved", scheduledStart: "2026-04-09T09:00", scheduledEnd: "2026-04-09T10:00" },
        ]);

        expect(updates).toEqual([{
            todoId: "event-moved",
            updates: { scheduledStart: "2026-04-09T09:00", scheduledEnd: "2026-04-09T10:00" },
        }]);
    });

    test("host-confirmed deletions are applied even in a large batch", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        const warnings: string[] = [];
        initCalendarChangeListener({
            getTodoById: async ({ todoId }) => ({
                id: todoId,
                kind: "event",
                source: "timeblock-generator",
                status: "todo",
                tags: [],
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        }, { onWarning: (message) => warnings.push(message) });

        await testWindow()?.__onCalendarChange?.(
            Array.from({ length: 8 }, (_, index) => ({ taskId: `event-${index}`, deleted: true, confirmed: true })),
        );

        expect(updates).toHaveLength(8);
        expect(updates.every((update) => update.updates.archived === true)).toBe(true);
        expect(warnings).toEqual([]);
    });

    test("a batch at the cap is still applied", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        const warnings: string[] = [];
        initCalendarChangeListener({
            getTodoById: async ({ todoId }) => ({
                id: todoId,
                kind: "event",
                source: "user",
                status: "todo",
                tags: [],
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        }, { onWarning: (message) => warnings.push(message) });

        await testWindow()?.__onCalendarChange?.(
            Array.from({ length: 3 }, (_, index) => ({ taskId: `event-${index}`, deleted: true })),
        );

        expect(updates.map((update) => update.todoId)).toEqual(["event-0", "event-1", "event-2"]);
        expect(warnings).toEqual([]);
    });

    test("a native bulk-deletion suspicion surfaces as a warning", () => {
        const warnings: string[] = [];
        initCalendarChangeListener({
            getTodoById: async () => null,
            updateTodo: async () => undefined,
        }, { onWarning: (message) => warnings.push(message) });

        testWindow()?.__onCalendarBulkDeletionSuspected?.(["event-1", "event-2", "event-3", "event-4"]);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("4 events");
    });

    test("calendar completion updates task status", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            getTodoById: async () => ({
                id: "task-1",
                kind: "task",
                source: "user",
                status: "todo",
                tags: [],
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        });

        await testWindow()?.__onCalendarChange?.([{ taskId: "task-1", completed: true }]);

        expect(updates).toEqual([{
            todoId: "task-1",
            updates: { status: "done" },
        }]);
    });

    test("calendar completion is ignored for events", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            getTodoById: async () => ({
                id: "event-1",
                kind: "event",
                source: "timeblock-generator",
                status: "todo",
                tags: ["movement"],
            }),
            updateTodo: async (payload) => {
                updates.push(payload);
            },
        });

        await testWindow()?.__onCalendarChange?.([{ taskId: "event-1", completed: true }]);

        expect(updates).toEqual([]);
        expect(dispatchedEvents).toEqual([]);
    });

    test("dispose unregisters both native handlers", () => {
        const dispose = initCalendarChangeListener({
            getTodoById: async () => null,
            updateTodo: async () => undefined,
        });

        expect(testWindow()?.__onCalendarChange).toBeDefined();
        expect(testWindow()?.__onCalendarBulkDeletionSuspected).toBeDefined();

        dispose();

        expect(testWindow()?.__onCalendarChange).toBeUndefined();
        expect(testWindow()?.__onCalendarBulkDeletionSuspected).toBeUndefined();
    });
});
