import { describe, expect, test } from "bun:test";
import type { BoardColumn } from "@/features/projects/project-types";
import { getColumnIdForTodo } from "./todo-column-utils";

function col(id: string, order: number, status?: BoardColumn["status"]): BoardColumn {
    return { id, title: id, order, status };
}

describe("getColumnIdForTodo", () => {
    test("returns first matching column for unique status mapping", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "in_progress"), col("c", 3, "done")];
        expect(getColumnIdForTodo({ status: "todo" }, columns)).toBe("a");
        expect(getColumnIdForTodo({ status: "in_progress" }, columns)).toBe("b");
        expect(getColumnIdForTodo({ status: "done" }, columns)).toBe("c");
    });

    test("first column wins for duplicate status mappings", () => {
        const columns = [col("x", 1, "todo"), col("y", 2, "todo"), col("z", 3, "in_progress")];
        expect(getColumnIdForTodo({ status: "todo" }, columns)).toBe("x");
    });

    test("respects order when checking first-wins for duplicates", () => {
        // y has order 1 so it comes before x (order 2) when sorted
        const columns = [col("x", 2, "todo"), col("y", 1, "todo")];
        expect(getColumnIdForTodo({ status: "todo" }, columns)).toBe("y");
    });

    test("falls back to last column when no column maps to done", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "in_progress"), col("c", 3)];
        expect(getColumnIdForTodo({ status: "done" }, columns)).toBe("c");
    });

    test("falls back to first column when no column maps to todo", () => {
        const columns = [col("a", 1), col("b", 2, "done")];
        expect(getColumnIdForTodo({ status: "todo" }, columns)).toBe("a");
    });

    test("falls back to first column when no column maps to in_progress", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "done")];
        expect(getColumnIdForTodo({ status: "in_progress" }, columns)).toBe("a");
    });

    test("falls back to first column when no column maps to later", () => {
        const columns = [col("a", 1, "todo"), col("b", 2, "in_progress")];
        expect(getColumnIdForTodo({ status: "later" }, columns)).toBe("a");
    });

    test("no-status columns are skipped when looking for a match", () => {
        // All columns have no status — fallback applies
        const columns = [col("a", 1), col("b", 2), col("c", 3)];
        expect(getColumnIdForTodo({ status: "todo" }, columns)).toBe("a");
        expect(getColumnIdForTodo({ status: "done" }, columns)).toBe("c");
    });
});
