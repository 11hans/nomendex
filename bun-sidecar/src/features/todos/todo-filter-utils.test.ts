import { describe, expect, test } from "bun:test";
import type { Todo } from "./todo-types";
import {
    classifyDueBucket,
    getEffectiveDate,
    dateSortComparator,
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

// ─── dateSortComparator ──────────────────────────────────────────────────────

describe("dateSortComparator", () => {
    test("earlier scheduledStart sorts first", () => {
        const a = makeTodo({ scheduledStart: daysFromNow(1) });
        const b = makeTodo({ scheduledStart: daysFromNow(3) });
        expect(dateSortComparator(a, b)).toBeLessThan(0);
    });

    test("scheduledStart takes priority over dueDate", () => {
        const a = makeTodo({ scheduledStart: daysFromNow(1), dueDate: daysFromNow(10) });
        const b = makeTodo({ dueDate: daysFromNow(2) }); // no scheduledStart
        expect(dateSortComparator(a, b)).toBeLessThan(0);
    });

    test("falls back to dueDate when no scheduledStart", () => {
        const a = makeTodo({ dueDate: daysFromNow(2) });
        const b = makeTodo({ dueDate: daysFromNow(5) });
        expect(dateSortComparator(a, b)).toBeLessThan(0);
    });

    test("falls back to createdAt when no scheduled or due date", () => {
        const a = makeTodo({ createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00" });
        const b = makeTodo({ createdAt: "2026-02-01T00:00", updatedAt: "2026-02-01T00:00" });
        expect(dateSortComparator(a, b)).toBeLessThan(0); // older first (ASC)
    });

    test("done todos sorted by completedAt DESC", () => {
        const a = makeTodo({ status: "done", completedAt: "2026-03-01T00:00", updatedAt: "2026-03-01T00:00" });
        const b = makeTodo({ status: "done", completedAt: "2026-03-10T00:00", updatedAt: "2026-03-10T00:00" });
        expect(dateSortComparator(a, b)).toBeGreaterThan(0); // b before a (DESC)
    });

    test("done todos fall back to updatedAt DESC when no completedAt", () => {
        const a = makeTodo({ status: "done", updatedAt: "2026-03-01T00:00" });
        const b = makeTodo({ status: "done", updatedAt: "2026-03-10T00:00" });
        expect(dateSortComparator(a, b)).toBeGreaterThan(0); // b before a
    });

    test("non-done always before done", () => {
        const active = makeTodo({ status: "todo", createdAt: "2026-01-01T00:00", updatedAt: "2026-01-01T00:00" });
        const done = makeTodo({ status: "done", completedAt: "2026-03-10T00:00", updatedAt: "2026-03-10T00:00" });
        expect(dateSortComparator(active, done)).toBeLessThan(0);
        expect(dateSortComparator(done, active)).toBeGreaterThan(0);
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

    test("default state returns all, sorted by date ASC (non-done), done last", () => {
        const result = filterAndSortTodos(todos, createDefaultFilterState());
        expect(result.length).toBe(6);
        // Non-done todos sorted by effective date ASC, done todos sorted completedAt DESC
        // Done and archived todos should have status===done or archived===true
        const nonDone = result.filter((t) => t.status !== "done");
        for (let i = 1; i < nonDone.length; i++) {
            const aDate = nonDone[i - 1].scheduledStart ?? nonDone[i - 1].dueDate ?? nonDone[i - 1].createdAt;
            const bDate = nonDone[i].scheduledStart ?? nonDone[i].dueDate ?? nonDone[i].createdAt;
            expect(new Date(aDate).getTime()).toBeLessThanOrEqual(new Date(bDate).getTime());
        }
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

    test("dateSortComparator: non-done sorted by scheduledStart ASC", () => {
        const t1 = makeTodo({ id: "a", scheduledStart: daysFromNow(3) });
        const t2 = makeTodo({ id: "b", scheduledStart: daysFromNow(1) });
        const t3 = makeTodo({ id: "c", scheduledStart: daysFromNow(5) });
        const result = [t1, t2, t3].sort(dateSortComparator);
        expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
    });

    test("dateSortComparator: falls back to dueDate when no scheduledStart", () => {
        const t1 = makeTodo({ id: "a", dueDate: daysFromNow(4) });
        const t2 = makeTodo({ id: "b", dueDate: daysFromNow(2) });
        const result = [t1, t2].sort(dateSortComparator);
        expect(result.map((t) => t.id)).toEqual(["b", "a"]);
    });

    test("dateSortComparator: done todos sorted completedAt DESC", () => {
        const t1 = makeTodo({ id: "a", status: "done", completedAt: "2026-03-01T00:00" });
        const t2 = makeTodo({ id: "b", status: "done", completedAt: "2026-03-10T00:00" });
        const t3 = makeTodo({ id: "c", status: "done", completedAt: "2026-03-05T00:00" });
        const result = [t1, t2, t3].sort(dateSortComparator);
        expect(result.map((t) => t.id)).toEqual(["b", "c", "a"]);
    });

    test("dateSortComparator: done todos sorted after non-done", () => {
        const active = makeTodo({ id: "active", status: "todo", createdAt: "2026-01-01T00:00" });
        const done = makeTodo({ id: "done", status: "done", completedAt: "2026-03-10T00:00" });
        const result = [done, active].sort(dateSortComparator);
        expect(result[0].id).toBe("active");
        expect(result[1].id).toBe("done");
    });
});
