import { describe, expect, test } from "bun:test";
import type { Todo } from "./todo-types";
import {
    classifyDueBucket,
    getEffectiveDate,
    urgencyComparator,
    needsAttention,
    matchesDueFilter,
    applyQuickPreset,
    fuzzyMatch,
    filterAndSortTodos,
} from "./todo-filter-utils";
import { applyTodoKindToDraft, isEventTodo, isTaskTodo, isTimeblockTodo } from "./todo-kind-utils";
import { createDefaultFilterState } from "./todo-filter-types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTodo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: "t-" + Math.random().toString(36).slice(2, 8),
        title: "Test todo",
        kind: "task",
        source: "user",
        status: "todo",
        createdAt: "2026-01-01T00:00",
        updatedAt: "2026-01-01T00:00",
        ...overrides,
    };
}

function daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function todayStr(): string {
    return daysFromNow(0);
}

// ─── classifyDueBucket ──────────────────────────────────────────────────────

describe("classifyDueBucket", () => {
    test("undefined returns no_due", () => {
        expect(classifyDueBucket(undefined)).toBe("no_due");
    });

    test("invalid date returns no_due", () => {
        expect(classifyDueBucket("not-a-date")).toBe("no_due");
    });

    test("yesterday is overdue", () => {
        expect(classifyDueBucket(daysFromNow(-1))).toBe("overdue");
    });

    test("today is today", () => {
        expect(classifyDueBucket(todayStr())).toBe("today");
    });

    test("tomorrow is next_7_days", () => {
        expect(classifyDueBucket(daysFromNow(1))).toBe("next_7_days");
    });

    test("7 days from now is next_7_days", () => {
        expect(classifyDueBucket(daysFromNow(7))).toBe("next_7_days");
    });

    test("9 days from now is no_due (beyond window)", () => {
        expect(classifyDueBucket(daysFromNow(9))).toBe("no_due");
    });

    test("far past is overdue", () => {
        expect(classifyDueBucket("2020-01-01")).toBe("overdue");
    });
});

// ─── getEffectiveDate ───────────────────────────────────────────────────────

describe("getEffectiveDate", () => {
    test("prefers dueDate", () => {
        const todo = makeTodo({ dueDate: "2026-03-01", scheduledStart: "2026-03-02", scheduledEnd: "2026-03-03" });
        expect(getEffectiveDate(todo)).toBe("2026-03-01");
    });

    test("falls back to scheduledStart", () => {
        const todo = makeTodo({ scheduledStart: "2026-03-02", scheduledEnd: "2026-03-03" });
        expect(getEffectiveDate(todo)).toBe("2026-03-02");
    });

    test("falls back to scheduledEnd", () => {
        const todo = makeTodo({ scheduledEnd: "2026-03-03" });
        expect(getEffectiveDate(todo)).toBe("2026-03-03");
    });

    test("returns undefined when no dates", () => {
        expect(getEffectiveDate(makeTodo())).toBeUndefined();
    });
});

// ─── urgencyComparator ──────────────────────────────────────────────────────

describe("urgencyComparator", () => {
    test("overdue before today", () => {
        const a = makeTodo({ dueDate: daysFromNow(-1) });
        const b = makeTodo({ dueDate: todayStr() });
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });

    test("today before next_7_days", () => {
        const a = makeTodo({ dueDate: todayStr() });
        const b = makeTodo({ dueDate: daysFromNow(3) });
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });

    test("next_7_days before no_due", () => {
        const a = makeTodo({ dueDate: daysFromNow(2) });
        const b = makeTodo(); // no date
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });

    test("within same bucket: earlier date first", () => {
        const a = makeTodo({ dueDate: daysFromNow(-3) });
        const b = makeTodo({ dueDate: daysFromNow(-1) });
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });

    test("same bucket/date: high priority before low", () => {
        const a = makeTodo({ dueDate: todayStr(), priority: "high" });
        const b = makeTodo({ dueDate: todayStr(), priority: "low" });
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });

    test("same bucket/date/priority: in_progress before todo", () => {
        const a = makeTodo({ dueDate: todayStr(), priority: "high", status: "in_progress" });
        const b = makeTodo({ dueDate: todayStr(), priority: "high", status: "todo" });
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });

    test("same everything: more recently updated first", () => {
        const a = makeTodo({ updatedAt: "2026-03-20T12:00" });
        const b = makeTodo({ updatedAt: "2026-03-19T12:00" });
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });

    test("final tiebreak: title ASC", () => {
        const a = makeTodo({ title: "Alpha", updatedAt: "2026-01-01T00:00" });
        const b = makeTodo({ title: "Beta", updatedAt: "2026-01-01T00:00" });
        expect(urgencyComparator(a, b)).toBeLessThan(0);
    });
});

// ─── needsAttention ─────────────────────────────────────────────────────────

describe("needsAttention", () => {
    test("in_progress todo needs attention", () => {
        expect(needsAttention(makeTodo({ status: "in_progress" }))).toBe(true);
    });

    test("high priority todo needs attention", () => {
        expect(needsAttention(makeTodo({ priority: "high" }))).toBe(true);
    });

    test("overdue todo needs attention", () => {
        expect(needsAttention(makeTodo({ dueDate: daysFromNow(-1) }))).toBe(true);
    });

    test("due today needs attention", () => {
        expect(needsAttention(makeTodo({ dueDate: todayStr() }))).toBe(true);
    });

    test("low priority future todo does NOT need attention", () => {
        expect(needsAttention(makeTodo({ priority: "low", dueDate: daysFromNow(5) }))).toBe(false);
    });

    test("done todo does NOT need attention", () => {
        expect(needsAttention(makeTodo({ status: "done", priority: "high" }))).toBe(false);
    });

    test("archived todo does NOT need attention", () => {
        expect(needsAttention(makeTodo({ archived: true, dueDate: daysFromNow(-1) }))).toBe(false);
    });

    test("timeblock todo does NOT need attention", () => {
        expect(needsAttention(makeTodo({
            kind: "event",
            source: "timeblock-generator",
            tags: ["timeblock"],
            dueDate: todayStr(),
        }))).toBe(false);
    });

    test("user event does NOT need attention", () => {
        expect(needsAttention(makeTodo({
            kind: "event",
            source: "user",
            dueDate: todayStr(),
        }))).toBe(false);
    });

    test("todo with no date, no priority, status todo does NOT need attention", () => {
        expect(needsAttention(makeTodo({ priority: "none" }))).toBe(false);
    });
});

// ─── kind/source helpers ───────────────────────────────────────────────────

describe("todo kind helpers", () => {
    test("detects task vs event", () => {
        expect(isTaskTodo(makeTodo({ kind: "task" }))).toBe(true);
        expect(isTaskTodo(makeTodo({ kind: "event" }))).toBe(false);
        expect(isEventTodo(makeTodo({ kind: "event" }))).toBe(true);
    });

    test("detects generated timeblocks by source", () => {
        expect(isTimeblockTodo(makeTodo({
            kind: "event",
            source: "timeblock-generator",
        }))).toBe(true);
    });

    test("keeps legacy timeblock tag as fallback", () => {
        expect(isTimeblockTodo(makeTodo({
            kind: "task",
            source: "user",
            tags: ["timeblock"],
        }))).toBe(true);
    });

    test("switching draft to event clears task-only fields", () => {
        expect(applyTodoKindToDraft(makeTodo({
            kind: "task",
            source: "user",
            status: "done",
            dueDate: "2026-04-09",
            priority: "high",
        }), "event")).toMatchObject({
            kind: "event",
            source: "user",
            status: "todo",
            dueDate: undefined,
            priority: undefined,
        });
    });
});

// ─── matchesDueFilter ───────────────────────────────────────────────────────

describe("matchesDueFilter", () => {
    test("any matches everything", () => {
        expect(matchesDueFilter(makeTodo(), "any")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: daysFromNow(-5) }), "any")).toBe(true);
    });

    test("overdue matches past dates only", () => {
        expect(matchesDueFilter(makeTodo({ dueDate: daysFromNow(-1) }), "overdue")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: todayStr() }), "overdue")).toBe(false);
    });

    test("today matches today only", () => {
        expect(matchesDueFilter(makeTodo({ dueDate: todayStr() }), "today")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: daysFromNow(1) }), "today")).toBe(false);
    });

    test("today_or_overdue matches both buckets", () => {
        expect(matchesDueFilter(makeTodo({ dueDate: daysFromNow(-1) }), "today_or_overdue")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: todayStr() }), "today_or_overdue")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: daysFromNow(1) }), "today_or_overdue")).toBe(false);
    });

    test("next_7_days matches tomorrow through 7 days", () => {
        expect(matchesDueFilter(makeTodo({ dueDate: daysFromNow(1) }), "next_7_days")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: daysFromNow(7) }), "next_7_days")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: todayStr() }), "next_7_days")).toBe(false);
    });

    test("no_due matches todos without dates", () => {
        expect(matchesDueFilter(makeTodo(), "no_due")).toBe(true);
        expect(matchesDueFilter(makeTodo({ dueDate: todayStr() }), "no_due")).toBe(false);
    });
});

// ─── fuzzyMatch ─────────────────────────────────────────────────────────────

describe("fuzzyMatch", () => {
    test("empty query matches everything", () => {
        expect(fuzzyMatch("", "anything")).toBe(true);
    });

    test("sequential chars match", () => {
        expect(fuzzyMatch("abc", "aXbXcX")).toBe(true);
    });

    test("out of order does not match", () => {
        expect(fuzzyMatch("abc", "acb")).toBe(false);
    });

    test("case insensitive", () => {
        expect(fuzzyMatch("ABC", "aXbXcX")).toBe(true);
    });

    test("exact match", () => {
        expect(fuzzyMatch("hello", "hello")).toBe(true);
    });

    test("query longer than text does not match", () => {
        expect(fuzzyMatch("longer", "short")).toBe(false);
    });
});

// ─── applyQuickPreset ───────────────────────────────────────────────────────

describe("applyQuickPreset", () => {
    test("none resets to all status", () => {
        const result = applyQuickPreset("none");
        expect(result.statusBucket).toBe("all");
        expect(result.selectedTags).toEqual([]);
        expect(result.selectedPriority).toBeNull();
    });

    test("needs_attention sets active status", () => {
        const result = applyQuickPreset("needs_attention");
        expect(result.statusBucket).toBe("active");
        expect(result.quickPreset).toBe("needs_attention");
    });

    test("due_today sets active + today filter", () => {
        const result = applyQuickPreset("due_today");
        expect(result.statusBucket).toBe("active");
        expect(result.dueFilter).toBe("today");
    });

    test("overdue sets active + overdue filter", () => {
        const result = applyQuickPreset("overdue");
        expect(result.statusBucket).toBe("active");
        expect(result.dueFilter).toBe("overdue");
    });
});

// ─── filterAndSortTodos ─────────────────────────────────────────────────────

describe("filterAndSortTodos", () => {
    const todos: Todo[] = [
        makeTodo({ id: "1", title: "Overdue high", dueDate: daysFromNow(-2), priority: "high", updatedAt: "2026-03-01T00:00" }),
        makeTodo({ id: "2", title: "Today low", dueDate: todayStr(), priority: "low", updatedAt: "2026-03-10T00:00" }),
        makeTodo({ id: "3", title: "Future none", dueDate: daysFromNow(3), priority: "none", updatedAt: "2026-03-15T00:00" }),
        makeTodo({ id: "4", title: "No date med", priority: "medium", updatedAt: "2026-03-20T00:00" }),
        makeTodo({ id: "5", title: "Done task", status: "done", dueDate: todayStr(), updatedAt: "2026-03-05T00:00" }),
        makeTodo({ id: "6", title: "Archived task", archived: true, dueDate: daysFromNow(-1), updatedAt: "2026-03-02T00:00" }),
    ];

    test("default state returns all, sorted by urgency", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState());
        expect(result.length).toBe(6);
        // Urgency order: overdue > today > next_7_days > no_due
        expect(result[0].id).toBe("1"); // overdue high
    });

    test("active status bucket filters out done and archived", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState({ statusBucket: "active" }));
        expect(result.every((t) => t.status !== "done" && !t.archived)).toBe(true);
        expect(result.length).toBe(4);
    });

    test("search filters by title", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState({ searchQuery: "overdue" }));
        expect(result.length).toBe(1);
        expect(result[0].id).toBe("1");
    });

    test("tag filter with OR matching", () => {
        const tagged = [
            makeTodo({ id: "a", tags: ["bug", "ui"] }),
            makeTodo({ id: "b", tags: ["feature"] }),
            makeTodo({ id: "c", tags: ["bug"] }),
            makeTodo({ id: "d" }),
        ];
        const result = filterAndSortTodos(tagged, createDefaultFilterState({ selectedTags: ["bug"] }));
        expect(result.map((t) => t.id).sort()).toEqual(["a", "c"]);
    });

    test("priority filter", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState({ selectedPriority: "high" }));
        expect(result.length).toBe(1);
        expect(result[0].id).toBe("1");
    });

    test("due filter", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState({ dueFilter: "today" }));
        const ids = result.map((t) => t.id);
        expect(ids).toContain("2");
        expect(ids).toContain("5");
        expect(ids).not.toContain("1"); // overdue, not today
    });

    test("needs_attention preset", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState({ quickPreset: "needs_attention" }));
        // Should include: overdue high (#1), today low (#2 - due today)
        // Should exclude: #3 (future none), #4 (no date med), #5 (done), #6 (archived)
        expect(result.every((t) => !t.archived && t.status !== "done")).toBe(true);
        expect(result.some((t) => t.id === "1")).toBe(true); // overdue
        expect(result.some((t) => t.id === "2")).toBe(true); // due today
    });

    test("skipStatusFilter option", () => {
        const result = filterAndSortTodos(
            todos,
            createDefaultFilterState({ statusBucket: "active" }),
            { skipStatusFilter: true },
        );
        // Should include done and archived even though statusBucket is active
        expect(result.length).toBe(6);
    });

    test("recent sort mode", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState({ sortMode: "recent" }));
        // Most recently updated first
        for (let i = 1; i < result.length; i++) {
            expect(new Date(result[i - 1].updatedAt).getTime()).toBeGreaterThanOrEqual(
                new Date(result[i].updatedAt).getTime(),
            );
        }
    });

    test("manual sort mode preserves original order", () => {
        const ordered = [
            makeTodo({ id: "x", title: "Third" }),
            makeTodo({ id: "y", title: "First" }),
            makeTodo({ id: "z", title: "Second" }),
        ];
        const result = filterAndSortTodos(ordered, createDefaultFilterState({ sortMode: "manual" }));
        expect(result.map((t) => t.id)).toEqual(["x", "y", "z"]); // original order preserved
    });
});
