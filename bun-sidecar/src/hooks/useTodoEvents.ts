import { useEffect, useRef } from "react";
import { initCalendarChangeListener } from "@/features/todos/calendar-change-bridge";
import { removeTaskFromCalendar, syncTaskToCalendar } from "@/features/todos/calendar-bridge";
import { stripUnexpectedNulls } from "@/features/todos/todo-sanitize";
import type { Todo } from "@/features/todos/todo-types";
import type { TodoEvent } from "@/services/todo-events";

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;
const UPDATE_NULLABLE_KEYS = new Set(["scheduledStart", "scheduledEnd", "dueDate", "duration"]);

async function fetchTodosAPI<T>(endpoint: string, body: object): Promise<T> {
    const response = await fetch(`/api/todos/${endpoint}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Nomendex-Source": "calendar-sync",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        let errorMessage = `API error: ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData && typeof errorData.error === "string") {
                errorMessage = errorData.error;
            }
        } catch {
            // Use default status-based message when body is not JSON.
        }
        throw new Error(errorMessage);
    }

    return response.json();
}

const calendarTodosAPI = {
    deleteTodo: (args: { todoId: string }) => fetchTodosAPI("delete", args),
    getTodoById: (args: { todoId: string }) => fetchTodosAPI<Todo | null>("get", args),
    updateTodo: (args: { todoId: string; updates: Record<string, unknown> }) => {
        const sanitizedUpdates = stripUnexpectedNulls(args.updates, UPDATE_NULLABLE_KEYS);
        return fetchTodosAPI("update", { todoId: args.todoId, updates: sanitizedUpdates });
    },
};

export function useTodoEvents(): void {
    const reconnectAttemptRef = useRef(0);
    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        initCalendarChangeListener(calendarTodosAPI);

        let cancelled = false;

        function connect() {
            if (cancelled) return;

            const es = new EventSource("/api/todos/events");
            eventSourceRef.current = es;

            es.onopen = () => {
                reconnectAttemptRef.current = 0;
            };

            es.onmessage = (event) => {
                void (async () => {
                    try {
                        const data = JSON.parse(event.data) as TodoEvent;
                        if (data.type === "delete") {
                            await removeTaskFromCalendar(data.todoId);
                        } else if (data.todo.archived) {
                            await removeTaskFromCalendar(data.todo.id);
                        } else {
                            await syncTaskToCalendar(data.todo as Todo);
                        }
                        window.dispatchEvent(new CustomEvent("calendar-sync-update"));
                    } catch {
                        // Ignore malformed payloads/keepalives and transient sync failures.
                    }
                })();
            };

            es.onerror = () => {
                es.close();
                eventSourceRef.current = null;

                if (cancelled) return;

                const attempt = reconnectAttemptRef.current++;
                const delay = Math.min(
                    RECONNECT_DELAY_MS * Math.pow(2, attempt),
                    MAX_RECONNECT_DELAY_MS
                );
                setTimeout(connect, delay);
            };
        }

        connect();

        return () => {
            cancelled = true;
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
        };
    }, []);
}
