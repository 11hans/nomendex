import type { Todo } from "@/features/todos/todo-types";

export type TodoEvent =
    | { type: "upsert"; todo: Todo }
    | { type: "delete"; todoId: string };

type SSEClient = (event: TodoEvent) => void;

const sseClients = new Set<SSEClient>();

export function addTodoSSEClient(client: SSEClient): () => void {
    sseClients.add(client);
    return () => {
        sseClients.delete(client);
    };
}

export function broadcastTodoEvent(event: TodoEvent): void {
    for (const client of sseClients) {
        try {
            client(event);
        } catch {
            sseClients.delete(client);
        }
    }
}
