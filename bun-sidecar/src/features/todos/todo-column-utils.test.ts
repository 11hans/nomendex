import { describe, expect, test } from "bun:test";
import type { BoardColumn } from "@/features/projects/project-types";
import { getColumnIdForTodo } from "./todo-column-utils";

function col(id: string, order: number, status?: BoardColumn["status"]): BoardColumn {
    return { id, title: id, order, status };
}

function todo(status: Parameters<typeof getColumnIdForTodo>[0]["status"], customColumnId?: string): Parameters<typeof getColumnIdForTodo>[0] {
    return { status, customColumnId };
}

describe("getColumnIdForTodo", () => {
    test("returns first matching column for unique status mapping", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "in_progress"), col("c", 3, "done")];
        expect(getColumnIdForTodo(todo("todo"), columns)).toBe("a");
        expect(getColumnIdForTodo(todo("in_progress"), columns)).toBe("b");
        expect(getColumnIdForTodo(todo("done"), columns)).toBe("c");
    });

    test("first column wins for duplicate status mappings when no customColumnId", () => {
        const columns = [col("x", 1, "todo"), col("y", 2, "todo"), col("z", 3, "in_progress")];
        expect(getColumnIdForTodo(todo("todo"), columns)).toBe("x");
    });

    test("respects order when checking first-wins for duplicates", () => {
        // y has order 1 so it comes before x (order 2) when sorted
        const columns = [col("x", 2, "todo"), col("y", 1, "todo")];
        expect(getColumnIdForTodo(todo("todo"), columns)).toBe("y");
    });

    test("falls back to last column when no column maps to done", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "in_progress"), col("c", 3)];
        expect(getColumnIdForTodo(todo("done"), columns)).toBe("c");
    });

    test("falls back to first column when no column maps to todo", () => {
        const columns = [col("a", 1), col("b", 2, "done")];
        expect(getColumnIdForTodo(todo("todo"), columns)).toBe("a");
    });

    test("falls back to first column when no column maps to in_progress", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "done")];
        expect(getColumnIdForTodo(todo("in_progress"), columns)).toBe("a");
    });

    test("falls back to first column when no column maps to later", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "in_progress")];
        expect(getColumnIdForTodo(todo("later"), columns)).toBe("a");
    });

    test("no-status columns are skipped when looking for a match", () => {
        // All columns have no status — fallback applies
        const columns = [col("a", 1), col("b", 2), col("c", 3)];
        expect(getColumnIdForTodo(todo("todo"), columns)).toBe("a");
        expect(getColumnIdForTodo(todo("done"), columns)).toBe("c");
    });

    // customColumnId takes priority over status matching
    test("customColumnId places todo in specific column even when another has matching status", () => {
        const columns = [col("x", 1, "todo"), col("y", 2, "todo"), col("z", 3, "in_progress")];
        // Todo with status "todo" but customColumnId pointing to "y" → goes to "y"
        expect(getColumnIdForTodo(todo("todo", "y"), columns)).toBe("y");
    });

    test("customColumnId works across any column regardless of status", () => {
        const columns = [col("backlog", 1, "todo"), col("this-week", 2, "todo"), col("done", 3, "done")];
        expect(getColumnIdForTodo(todo("todo", "this-week"), columns)).toBe("this-week");
        expect(getColumnIdForTodo(todo("todo", "backlog"), columns)).toBe("backlog");
    });

    test("falls back to status matching when customColumnId refers to deleted column", () => {
        const columns = [col("x", 1, "todo"), col("y", 2, "in_progress")];
        // Column "old-col" no longer exists → fall back to first matching status column
        expect(getColumnIdForTodo(todo("todo", "old-col"), columns)).toBe("x");
    });

    test("falls back to status matching when customColumnId column has incompatible status", () => {
        const columns = [col("week", 1, "todo"), col("doing", 2, "in_progress"), col("done-col", 3, "done")];
        // Todo marked done but customColumnId still points to a "todo" column
        // → should move to the done column, not stay in "week"
        expect(getColumnIdForTodo(todo("done", "week"), columns)).toBe("done-col");
        // Todo returned to "todo" but customColumnId still points to done
        // → should move back to a "todo" column
        expect(getColumnIdForTodo(todo("todo", "done-col"), columns)).toBe("week");
    });

    test("customColumnId into a no-status column sticks regardless of todo status", () => {
        const columns = [col("inbox", 1), col("doing", 2, "in_progress"), col("done-col", 3, "done")];
        // No-status columns act as "any status" containers — customColumnId is honored
        expect(getColumnIdForTodo(todo("todo", "inbox"), columns)).toBe("inbox");
        expect(getColumnIdForTodo(todo("done", "inbox"), columns)).toBe("inbox");
    });
});
