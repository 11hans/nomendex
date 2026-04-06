export interface TodoReorderItem {
    id: string;
}

export interface TodoReorder {
    todoId: string;
    order: number;
}

export function buildTodoReorders(orderedTodos: readonly TodoReorderItem[]): TodoReorder[] {
    return orderedTodos.map((todo, index) => ({
        todoId: todo.id,
        order: index + 1,
    }));
}
