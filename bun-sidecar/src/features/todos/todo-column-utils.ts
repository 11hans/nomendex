import type { BoardColumn } from "@/features/projects/project-types";
import type { Todo } from "./todo-types";

/**
 * In custom board mode, determine which column a todo belongs to.
 *
 * Priority:
 *   1. `customColumnId` — used only when the column exists AND its status is
 *      compatible with `todo.status` (same status, or a no-status column).
 *      This lets users distinguish between columns that share a status
 *      (e.g. "Backlog" vs "This Week") without trapping a todo in a stale
 *      column after its status changes.
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
    if (todo.customColumnId) {
        const customColumn = columns.find(c => c.id === todo.customColumnId);
        if (customColumn && (customColumn.status === undefined || customColumn.status === todo.status)) {
            return customColumn.id;
        }
    }
    const sorted = [...columns].sort((a, b) => a.order - b.order);
    const match = sorted.find((c) => c.status === todo.status);
    if (match) return match.id;
    if (todo.status === "done") return sorted[sorted.length - 1].id;
    return sorted[0].id;
}
