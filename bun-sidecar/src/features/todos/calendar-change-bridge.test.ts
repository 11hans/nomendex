import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initCalendarChangeListener } from "./calendar-change-bridge";

type TestWindow = {
    dispatchEvent: (event: Event) => boolean;
    __onCalendarChange?: (changes: unknown[]) => Promise<void>;
};

const originalWindow = globalThis.window;

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
        const deletes: string[] = [];
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            deleteTodo: async ({ todoId }) => {
                deletes.push(todoId);
            },
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

        await (globalThis as { window?: TestWindow }).window?.__onCalendarChange?.([{ taskId: "task-1", deleted: true }]);

        expect(deletes).toEqual([]);
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

    test("deleting an event removes the todo", async () => {
        const deletes: string[] = [];
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            deleteTodo: async ({ todoId }) => {
                deletes.push(todoId);
            },
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

        await (globalThis as { window?: TestWindow }).window?.__onCalendarChange?.([{ taskId: "event-1", deleted: true }]);

        expect(deletes).toEqual(["event-1"]);
        expect(updates).toEqual([]);
        expect(dispatchedEvents).toEqual(["calendar-sync-update"]);
    });

    test("calendar completion updates task status", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            deleteTodo: async () => undefined,
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

        await (globalThis as { window?: TestWindow }).window?.__onCalendarChange?.([{ taskId: "task-1", completed: true }]);

        expect(updates).toEqual([{
            todoId: "task-1",
            updates: { status: "done" },
        }]);
    });

    test("calendar completion is ignored for events", async () => {
        const updates: Array<{ todoId: string; updates: Record<string, unknown> }> = [];
        initCalendarChangeListener({
            deleteTodo: async () => undefined,
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

        await (globalThis as { window?: TestWindow }).window?.__onCalendarChange?.([{ taskId: "event-1", completed: true }]);

        expect(updates).toEqual([]);
        expect(dispatchedEvents).toEqual([]);
    });
});
