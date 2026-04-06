import type { Todo, TodoKind, TodoSource } from "./todo-types";

type TodoLikeWithKind = Pick<Todo, "kind"> | { kind?: TodoKind };
type TodoLikeWithSource = Pick<Todo, "source"> | { source?: TodoSource };
type TodoLikeWithTags = Pick<Todo, "tags"> | { tags?: string[] };

type TodoKindDraft = {
    kind?: TodoKind;
    source?: TodoSource;
    status: Todo["status"];
    dueDate?: string;
    priority?: Todo["priority"];
};

export function getTodoKind(todo: TodoLikeWithKind): TodoKind {
    return todo.kind === "event" ? "event" : "task";
}

export function getTodoSource(todo: TodoLikeWithSource): TodoSource {
    return todo.source === "timeblock-generator" ? "timeblock-generator" : "user";
}

export function isEventTodo(todo: TodoLikeWithKind): boolean {
    return getTodoKind(todo) === "event";
}

export function isTaskTodo(todo: TodoLikeWithKind): boolean {
    return getTodoKind(todo) === "task";
}

export function isTimeblockTodo(
    todo: TodoLikeWithKind & TodoLikeWithSource & TodoLikeWithTags,
): boolean {
    return getTodoSource(todo) === "timeblock-generator"
        || (todo.tags?.includes("timeblock") ?? false);
}

export function applyTodoKindToDraft<T extends TodoKindDraft>(draft: T, kind: TodoKind): T {
    if (kind === "event") {
        return {
            ...draft,
            kind,
            source: draft.source ?? "user",
            status: "todo",
            dueDate: undefined,
            priority: undefined,
        };
    }

    return {
        ...draft,
        kind,
        source: draft.source ?? "user",
    };
}

export function getTodoKindLabel(kind: TodoKind): "Task" | "Event" {
    return kind === "event" ? "Event" : "Task";
}
