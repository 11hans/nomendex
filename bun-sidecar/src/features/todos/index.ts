import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import { TodosView } from "./view";
import { TodosBrowserView } from "./browser-view";
import { ArchivedBrowserView } from "./archived-view";
import { InboxListView } from "./inbox-view";
import { FunctionStubs } from "@/types/Functions";
import { TodoKindSchema, TodoSchema, TodoSourceSchema } from "./todo-types";
import { AttachmentSchema } from "@/types/attachments";
import { BoardConfigSchema } from "./board-types";

// Export the commands function for use in CommandMenu
export { getTodosCommands } from "./commands";

export const ScheduledOverlapSchema = z.object({
    start: z.string(),
    end: z.string(),
});

export const GetTodosInputSchema = z.object({
    project: z.string().optional(),
    tagsAll: z.array(z.string()).optional(),
    scheduledOverlap: ScheduledOverlapSchema.optional(),
    kind: TodoKindSchema.optional(),
    kinds: z.array(TodoKindSchema).optional(),
    source: TodoSourceSchema.optional(),
    sources: z.array(TodoSourceSchema).optional(),
    status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
    statuses: z.array(z.enum(["todo", "in_progress", "done", "later"])).optional(),
});

export type GetTodosInput = z.infer<typeof GetTodosInputSchema>;

export const functionStubs = {
    getTodos: {
        input: GetTodosInputSchema,
        output: z.array(TodoSchema),
    },
    getProjects: {
        input: z.object({}),
        output: z.array(z.string()),
    },
    getTodoById: {
        input: z.object({ todoId: z.string() }),
        output: TodoSchema,
    },
    createTodo: {
        input: z.object({
            title: z.string(),
            description: z.string().optional(),
            project: z.string().optional(),
            kind: TodoKindSchema.optional(),
            source: TodoSourceSchema.optional(),
            status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
            tags: z.array(z.string()).optional(),
            scheduledStart: z.string().nullable().optional(),
            scheduledEnd: z.string().nullable().optional(),
            // Deadline only. Schedule lives in `scheduledStart`/`scheduledEnd`.
            dueDate: z.string().nullable().optional(),
            priority: z.enum(["high", "medium", "low", "none"]).optional(),
            duration: z.number().optional(),
            attachments: z.array(AttachmentSchema).optional(),
            customColumnId: z.string().optional(),
            goalRefs: z.array(z.string()).optional(),
        }),
        output: TodoSchema,
    },
    updateTodo: {
        input: z.object({
            todoId: z.string(),
            updates: z.object({
                title: z.string().optional(),
                description: z.string().optional(),
                kind: TodoKindSchema.optional(),
                source: TodoSourceSchema.optional(),
                status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
                project: z.string().optional(),
                archived: z.boolean().optional(),
                tags: z.array(z.string()).optional(),
                scheduledStart: z.string().nullable().optional(),
                scheduledEnd: z.string().nullable().optional(),
                // Deadline only. Schedule lives in `scheduledStart`/`scheduledEnd`.
                dueDate: z.string().nullable().optional(),
                priority: z.enum(["high", "medium", "low", "none"]).optional(),
                completedAt: z.string().optional(),
                duration: z.number().nullable().optional(),
                attachments: z.array(AttachmentSchema).optional(),
                customColumnId: z.string().optional(),
                goalRefs: z.array(z.string()).optional(),
            }).strict(),
        }),
        output: TodoSchema,
    },
    deleteTodo: {
        input: z.object({ todoId: z.string() }),
        output: z.object({ success: z.boolean() }),
    },
    reorderTodos: {
        input: z.object({
            reorders: z.array(z.object({
                todoId: z.string(),
                order: z.number(),
            })),
        }),
        output: z.object({ success: z.boolean() }),
    },
    archiveTodo: {
        input: z.object({ todoId: z.string() }),
        output: TodoSchema,
    },
    unarchiveTodo: {
        input: z.object({ todoId: z.string() }),
        output: TodoSchema,
    },
    getArchivedTodos: {
        input: z.object({
            project: z.string().optional(),
        }),
        output: z.array(TodoSchema),
    },
    getTags: {
        input: z.object({}),
        output: z.array(z.string()),
    },
    getBoardConfig: {
        input: z.object({ projectId: z.string() }),
        output: BoardConfigSchema.nullable(),
    },
    saveBoardConfig: {
        input: z.object({ config: BoardConfigSchema }),
        output: BoardConfigSchema,
    },
    deleteColumn: {
        input: z.object({ projectId: z.string(), columnId: z.string() }),
        output: z.object({ success: z.boolean() }),
    },
} satisfies FunctionStubs;

export const todosPluginSerial: SerializablePlugin = {
    id: "todos",
    name: "Todos",
    icon: "list-todo",
};

export const todosViewPropsSchema = z.object({
    todoId: z.string(),
});
export type TodosViewProps = z.infer<typeof todosViewPropsSchema>;

export const todosBrowserViewPropsSchema = z.object({
    project: z.string().optional(),
    selectedTodoId: z.string().optional(),
});
export type TodosBrowserViewProps = z.infer<typeof todosBrowserViewPropsSchema>;

const views = {
    browser: {
        id: "browser",
        name: "Todos",
        component: TodosBrowserView,
        props: todosBrowserViewPropsSchema,
    },
    archived: {
        id: "archived",
        name: "Archived",
        component: ArchivedBrowserView,
        props: todosBrowserViewPropsSchema,
    },
    inbox: {
        id: "inbox",
        name: "Inbox",
        component: InboxListView,
    },
    editor: {
        id: "editor",
        name: "Todo Details",
        component: TodosView,
        props: todosViewPropsSchema,
    },
} as const;

export const TodosPluginBase: PluginBase = {
    id: todosPluginSerial.id,
    name: todosPluginSerial.name,
    icon: todosPluginSerial.icon,
    views,
    mcpServers: {}, // MCP servers are defined in fx.ts to keep them backend-only
    functionStubs,
    commands: [
        {
            id: "todos.open",
            name: "Open Todos",
            description: "Open the all-project todos board",
            icon: "CheckSquare",
            callback: () => {
                // This will be handled by CommandMenu
            },
        },
        {
            id: "todos.create",
            name: "Create New Todo",
            description: "Create a new todo item",
            icon: "Plus",
            callback: () => {
                // This will be handled by CommandMenu
            },
        },
    ],
};
