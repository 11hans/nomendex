import { Todo, type TodoKind, type TodoSource } from "@/features/todos/todo-types";
import type { Attachment } from "@/types/attachments";
import type { BoardConfig, ProjectConfig } from "@/features/projects/project-types";
import type { GetTodosInput } from "@/features/todos";
import type { DayConfig } from "@/features/timeblocking/types";
import type { TimeblockingApplyResult, TimeblockingPreviewResult } from "@/features/timeblocking/service";
import {
    sanitizeTodoForClient,
    sanitizeTodoListForClient,
    stripUnexpectedNulls,
} from "@/features/todos/todo-sanitize";

interface CreateTodoInput {
    title: string;
    description?: string;
    project?: string;
    kind?: TodoKind;
    source?: TodoSource;
    status?: "todo" | "in_progress" | "done" | "later";
    tags?: string[];
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    dueDate?: string | null;
    priority?: "high" | "medium" | "low" | "none";
    duration?: number;
    attachments?: Attachment[];
    customColumnId?: string;
    calendarReminderPreset?: "30-15" | "none";
    goalRefs?: string[];
}

interface UpdateTodoInput {
    todoId: string;
    updates: {
        title?: string;
        description?: string;
        kind?: TodoKind;
        source?: TodoSource;
        status?: "todo" | "in_progress" | "done" | "later";
        project?: string;
        archived?: boolean;
        tags?: string[];
        scheduledStart?: string | null;
        scheduledEnd?: string | null;
        dueDate?: string | null;
        priority?: "high" | "medium" | "low" | "none";
        duration?: number | null;
        attachments?: Attachment[];
        customColumnId?: string;
        calendarReminderPreset?: "30-15" | "none";
        goalRefs?: string[];
    };
}

interface ReorderInput {
    reorders: { todoId: string; order: number }[];
}

const CREATE_NULLABLE_KEYS = new Set(["scheduledStart", "scheduledEnd", "dueDate"]);
const UPDATE_NULLABLE_KEYS = new Set(["scheduledStart", "scheduledEnd", "dueDate", "duration"]);

async function fetchAPI<T>(endpoint: string, body: object = {}): Promise<T> {
    const response = await fetch(`/api/todos/${endpoint}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Nomendex-Client": "ui",
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
            // Use default message when body parsing fails.
        }
        throw new Error(errorMessage);
    }
    return response.json();
}

async function fetchProjectsAPI<T>(endpoint: string, body: object = {}): Promise<T> {
    const response = await fetch(`/api/projects/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

// Standalone API object for use outside React components
export const todosAPI = {
    getTodos: async (args: GetTodosInput = {}) =>
        sanitizeTodoListForClient(await fetchAPI<Todo[]>("list", args)),
    getTodoById: async (args: { todoId: string }) =>
        sanitizeTodoForClient(await fetchAPI<Todo>("get", args)),
    createTodo: async (args: CreateTodoInput) =>
        sanitizeTodoForClient(await fetchAPI<Todo>("create", stripUnexpectedNulls(args, CREATE_NULLABLE_KEYS))),
    updateTodo: async (args: UpdateTodoInput) => {
        const sanitizedUpdates = stripUnexpectedNulls(args.updates, UPDATE_NULLABLE_KEYS);
        const updated = await fetchAPI<Todo>("update", { todoId: args.todoId, updates: sanitizedUpdates });
        return sanitizeTodoForClient(updated);
    },
    deleteTodo: (args: { todoId: string }) => fetchAPI<{ success: boolean }>("delete", args),
    getProjects: () => fetchAPI<string[]>("projects"),
    reorderTodos: (args: ReorderInput) => fetchAPI<{ success: boolean }>("reorder", args),
    archiveTodo: async (args: { todoId: string }) => sanitizeTodoForClient(await fetchAPI<Todo>("archive", args)),
    unarchiveTodo: async (args: { todoId: string }) => sanitizeTodoForClient(await fetchAPI<Todo>("unarchive", args)),
    getArchivedTodos: async (args: { project?: string } = {}) =>
        sanitizeTodoListForClient(await fetchAPI<Todo[]>("archived", args)),
    getTags: () => fetchAPI<string[]>("tags"),
    deleteTag: (args: { tagName: string }) => fetchAPI<{ deletedFromCount: number }>("tags/delete", args),
    previewTimeblocking: (args: { weekStart: string; days: DayConfig[] }) =>
        fetchAPI<TimeblockingPreviewResult>("timeblocking/preview", args),
    applyTimeblocking: (args: { weekStart: string; days: DayConfig[] }) =>
        fetchAPI<TimeblockingApplyResult>("timeblocking/apply", args),
    // Board config - now uses projects API
    getBoardConfig: (args: { projectId?: string; projectName?: string }) => fetchProjectsAPI<BoardConfig | null>("board/get", args),
    saveBoardConfig: (args: { projectId?: string; projectName?: string; board: BoardConfig }) => fetchProjectsAPI<ProjectConfig>("board/save", args),
    deleteColumn: (args: { projectId: string; columnId: string }) => fetchProjectsAPI<{ success: boolean }>("column/delete", args),
    // Projects service API
    getProjectsList: () => fetchProjectsAPI<ProjectConfig[]>("list", {}),
};

// Hook wrapper for use in React components
export function useTodosAPI() {
    return todosAPI;
}
