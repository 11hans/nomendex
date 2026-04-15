import type { Todo } from "./todo-types";

export interface TodoTreeNode {
    todo: Todo;
    children: Todo[];
}

/**
 * Build a flat list into a tree representation.
 * Returns only top-level todos (those without parentTodoId), each with their
 * direct children embedded. Orphaned subtasks (whose parent isn't in the list)
 * are returned as top-level nodes without children.
 *
 * Input `todos` should be already filtered/sorted by the caller.
 */
export function buildTodoTree(todos: readonly Todo[]): TodoTreeNode[] {
    const byId = new Map<string, Todo>(todos.map((t) => [t.id, t]));
    const childrenMap = new Map<string, Todo[]>();
    const topLevel: Todo[] = [];

    for (const todo of todos) {
        if (todo.parentTodoId && byId.has(todo.parentTodoId)) {
            const siblings = childrenMap.get(todo.parentTodoId) ?? [];
            siblings.push(todo);
            childrenMap.set(todo.parentTodoId, siblings);
        } else {
            topLevel.push(todo);
        }
    }

    return topLevel.map((todo) => ({
        todo,
        children: childrenMap.get(todo.id) ?? [],
    }));
}

/**
 * Given a set of matching todo IDs (from a filter), expand the set to include
 * parents of matching subtasks, so the parent can be shown as context.
 * Returns the IDs of todos that should be shown (parents + matching items).
 */
export function expandWithParentContext(
    matchingIds: Set<string>,
    todos: readonly Todo[],
): Set<string> {
    const result = new Set(matchingIds);
    for (const todo of todos) {
        if (todo.parentTodoId && matchingIds.has(todo.id)) {
            result.add(todo.parentTodoId);
        }
    }
    return result;
}

/**
 * Compute subtask completion progress for a parent todo.
 * Returns { done, total } where total > 0 means subtasks exist.
 */
export function getSubtaskProgress(
    parentId: string,
    allSubtasks: readonly Todo[],
): { done: number; total: number } {
    const subtasks = allSubtasks.filter((t) => t.parentTodoId === parentId);
    const done = subtasks.filter((t) => t.status === "done").length;
    return { done, total: subtasks.length };
}
