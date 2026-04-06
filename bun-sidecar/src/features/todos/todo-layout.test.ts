import { describe, expect, test } from "bun:test";
import type { Todo } from "./todo-types";
import { getTodoLayoutColumnKey, normalizeTodoLayout, sortTodosByLayout } from "./todo-layout";

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
        project: "Inbox",
        ...overrides,
    };
}

describe("getTodoLayoutColumnKey", () => {
    test("builds active key from project + status", () => {
        const key = getTodoLayoutColumnKey(makeTodo({ status: "in_progress", project: "Work" }));
        expect(key).toBe("active::Work::in_progress");
    });

    test("prefers custom column id over status", () => {
        const key = getTodoLayoutColumnKey(makeTodo({ customColumnId: "col-review", status: "done" }));
        expect(key).toBe("active::Inbox::col-review");
    });

    test("builds archived scope key", () => {
        const key = getTodoLayoutColumnKey(makeTodo({ archived: true, status: "done" }));
        expect(key).toBe("archived::Inbox::done");
    });
});

describe("normalizeTodoLayout", () => {
    test("dedupes ids and drops empty columns", () => {
        const normalized = normalizeTodoLayout({
            version: 1,
            columns: {
                "active::Inbox::todo": ["a", "a", "b"],
                "active::Inbox::done": [],
            },
        });

        expect(normalized.columns).toEqual({
            "active::Inbox::todo": ["a", "b"],
        });
    });

    test("filters unknown ids when valid set is provided", () => {
        const normalized = normalizeTodoLayout({
            version: 1,
            columns: {
                "active::Inbox::todo": ["a", "b", "c"],
            },
        }, new Set(["a", "c"]));

        expect(normalized.columns).toEqual({
            "active::Inbox::todo": ["a", "c"],
        });
    });
});

describe("sortTodosByLayout", () => {
    test("orders todos by layout order inside the same column", () => {
        const a = makeTodo({ id: "a" });
        const b = makeTodo({ id: "b" });
        const c = makeTodo({ id: "c" });

        const sorted = sortTodosByLayout([a, b, c], {
            version: 1,
            columns: {
                "active::Inbox::todo": ["c", "a", "b"],
            },
        });

        expect(sorted.map((todo) => todo.id)).toEqual(["c", "a", "b"]);
    });

    test("uses deterministic order across columns", () => {
        const todo = makeTodo({ id: "todo", status: "todo" });
        const done = makeTodo({ id: "done", status: "done" });
        const inProgress = makeTodo({ id: "prog", status: "in_progress" });

        const input = [todo, done, inProgress];
        const sorted = sortTodosByLayout(input, {
            version: 1,
            columns: {
                "active::Inbox::todo": ["todo"],
                "active::Inbox::done": ["done"],
                "active::Inbox::in_progress": ["prog"],
            },
        });

        expect(sorted.map((item) => item.id)).toEqual(["done", "prog", "todo"]);
    });
});
