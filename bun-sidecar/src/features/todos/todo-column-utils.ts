import type { BoardColumn } from "@/features/projects/project-types";
import type { Todo } from "./todo-types";

/**
 * In custom board mode, determine which column a todo belongs to.
 *
 * Strict rule: the todo's visual column is always the FIRST column
 * (sorted by `order`) whose `status` matches `todo.status`.
 *
 * Fallbacks (when no column maps to the status):
 *   - "done" status → last column
 *   - any other status → first column
 *
 * `customColumnId` on the todo is ignored for display placement;
 * it is only kept for data-compatibility reasons.
 */
export function getColumnIdForTodo(
    todo: Pick<Todo, "status">,
    columns: BoardColumn[],
): string {
    const sorted = [...columns].sort((a, b) => a.order - b.order);
    const match = sorted.find((c) => c.status === todo.status);
    if (match) return match.id;
    if (todo.status === "done") return sorted[sorted.length - 1].id;
    return sorted[0].id;
}
