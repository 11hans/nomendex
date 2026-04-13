import type { BoardColumn } from "@/features/projects/project-types";
import type { Todo } from "./todo-types";

/**
 * In custom board mode, determine which column a todo belongs to.
 *
 * Priority:
 *   1. `customColumnId` on the todo — if set and the column still exists, use it.
 *      This is the primary placement key and allows multiple columns with the
 *      same status to be distinguished.
 *   2. First column (sorted by `order`) whose `status` matches `todo.status`.
 *
 * Fallbacks (when no column maps to the status):
 *   - "done" status → last column
 *   - any other status → first column
 */
export function getColumnIdForTodo(
    todo: Pick<Todo, "status" | "customColumnId">,
    columns: BoardColumn[],
): string {
    // 1. If customColumnId is set and the column still exists, use it
    if (todo.customColumnId) {
        const customColumn = columns.find(c => c.id === todo.customColumnId);
        if (customColumn) return customColumn.id;
    }
    // 2. Fall back to status-based matching
    const sorted = [...columns].sort((a, b) => a.order - b.order);
    const match = sorted.find((c) => c.status === todo.status);
    if (match) return match.id;
    if (todo.status === "done") return sorted[sorted.length - 1].id;
    return sorted[0].id;
}
