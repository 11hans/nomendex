import { describe, expect, test } from "bun:test";
import type { Todo } from "@/features/todos/todo-types";
import { formatDailyNoteDate, parseDailyNoteDate } from "@/features/notes/date-utils";
import { completedOn, extractPlan, inProgress, scheduledOn, startTimeOn } from "./daily-panel";

function makeTodo(overrides: Record<string, unknown> = {}): Todo {
    return {
        id: "todo-1",
        title: "Test",
        kind: "task",
        source: "user",
        status: "done",
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:00:00.000Z",
        ...overrides,
    } as Todo;
}

describe("extractPlan", () => {
    test("reads the zítra: line at the end of a free-form entry", () => {
        expect(extractPlan("Dneska jsem dopsal šablonu.\n\nzítra: panel včera/dnes\n")).toBe("panel včera/dnes");
    });

    test("ignores an empty template line and returns undefined when nothing is planned", () => {
        expect(extractPlan("\n\n\nzítra: \n")).toBeUndefined();
        expect(extractPlan("Jen text bez plánu.")).toBeUndefined();
        expect(extractPlan("")).toBeUndefined();
    });

    test("takes the last filled zítra: line, skipping an empty one below it", () => {
        expect(extractPlan("zítra: první\nnějaký text\nzítra: druhá\n\nzítra: ")).toBe("druhá");
    });

    test("accepts the variants people type on a phone or in Obsidian", () => {
        expect(extractPlan("zitra: bez diakritiky")).toBe("bez diakritiky");
        expect(extractPlan("Zítra: velké Z")).toBe("velké Z");
        expect(extractPlan("ZÍTRA: velké Í")).toBe("velké Í");
        expect(extractPlan("- zítra: v seznamu")).toBe("v seznamu");
        expect(extractPlan("**zítra:** tučně")).toBe("tučně");
        expect(extractPlan("**zítra**: tučně jinak")).toBe("tučně jinak");
        expect(extractPlan("text\r\nzítra: windows konce řádků\r\n")).toBe("windows konce řádků");
        expect(extractPlan("zítra: NFD z macOS")).toBe("NFD z macOS");
    });

    test("strips the rich editor's markdown escapes and hard-break backslash", () => {
        expect(extractPlan("zítra: opravit \\[sync\\] a 1\\. krok\\")).toBe("opravit [sync] a 1. krok");
    });

    test("does not match words that merely start with zítra", () => {
        expect(extractPlan("zítřek bude lepší")).toBeUndefined();
        expect(extractPlan("pozítra: ne")).toBeUndefined();
    });
});

describe("completedOn", () => {
    const day = new Date(2026, 9, 11);
    const at = (hours: number, dayOfMonth = 11) => new Date(2026, 9, dayOfMonth, hours, 30).toISOString();

    test("keeps done todos completed on the local day, oldest first", () => {
        const todos = [
            makeTodo({ id: "late", completedAt: at(21) }),
            makeTodo({ id: "early", completedAt: at(0) }),
            makeTodo({ id: "yesterday", completedAt: at(23, 10) }),
            makeTodo({ id: "tomorrow", completedAt: at(0, 12) }),
        ];
        expect(completedOn(todos, day).map((t) => t.id)).toEqual(["early", "late"]);
    });

    test("skips todos that are not done or have no completedAt", () => {
        const todos = [
            makeTodo({ id: "reopened", status: "todo", completedAt: at(10) }),
            makeTodo({ id: "legacy-done" }),
            makeTodo({ id: "broken", completedAt: "not a date" }),
        ];
        expect(completedOn(todos, day)).toEqual([]);
    });
});

describe("scheduledOn", () => {
    const day = new Date(2026, 9, 15);

    test("keeps open todos scheduled on the day, all-day first, then by start time", () => {
        const todos = [
            makeTodo({ id: "afternoon", status: "todo", scheduledStart: "2026-10-15T15:00" }),
            makeTodo({ id: "all-day", status: "todo", kind: "event", scheduledStart: "2026-10-15" }),
            makeTodo({ id: "morning", status: "planned", scheduledStart: "2026-10-15T08:30" }),
            makeTodo({ id: "other-day", status: "todo", scheduledStart: "2026-10-16T08:00" }),
            makeTodo({ id: "done", status: "done", scheduledStart: "2026-10-15T09:00" }),
            makeTodo({ id: "unscheduled", status: "todo" }),
        ];
        expect(scheduledOn(todos, day).map((t) => t.id)).toEqual(["all-day", "morning", "afternoon"]);
    });

    test("includes a multi-day range on every day it covers, without a start time after the first day", () => {
        const trip = makeTodo({ id: "trip", status: "todo", kind: "event", scheduledStart: "2026-10-14T18:00", scheduledEnd: "2026-10-17" });
        expect(scheduledOn([trip], day).map((t) => t.id)).toEqual(["trip"]);
        expect(scheduledOn([trip], new Date(2026, 9, 18))).toEqual([]);
        expect(startTimeOn(trip, day)).toBe("");
        expect(startTimeOn(trip, new Date(2026, 9, 14))).toBe("18:00");
    });
});

describe("inProgress", () => {
    test("lists in-progress todos not already shown as scheduled", () => {
        const scheduled = makeTodo({ id: "scheduled", status: "in_progress", scheduledStart: "2026-10-15" });
        const todos = [scheduled, makeTodo({ id: "working", status: "in_progress" }), makeTodo({ id: "waiting", status: "todo" })];
        expect(inProgress(todos, [scheduled]).map((t) => t.id)).toEqual(["working"]);
    });
});

describe("daily note date names", () => {
    test("round-trips M-D-YYYY without zero padding", () => {
        const date = new Date(2026, 9, 5);
        expect(formatDailyNoteDate(date)).toBe("10-5-2026");
        expect(parseDailyNoteDate("10-5-2026.md")?.getTime()).toBe(date.getTime());
    });

    test("rejects names that are not a real date", () => {
        expect(parseDailyNoteDate("2-30-2026.md")).toBeNull();
        expect(parseDailyNoteDate("Mapa používání Nomendexu.md")).toBeNull();
        expect(parseDailyNoteDate("3-30-2026 2.md")).toBeNull();
    });
});
