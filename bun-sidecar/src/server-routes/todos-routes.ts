// Direct API routes for todos feature
// These replace the generic /api/plugin-registry endpoint

import { z } from "zod";
import {
    getTodos,
    getTodoById,
    createTodo,
    updateTodo,
    deleteTodo,
    getProjects,
    reorderTodos,
    archiveTodo,
    unarchiveTodo,
    getArchivedTodos,
    getTags,
    getBoardConfig,
    saveBoardConfig,
    deleteColumn,
    recomputeAllGoalRefs,
    forceReindexTodos,
} from "@/features/todos/fx";
import { DayTypeSchema } from "@/features/timeblocking/types";
import { applyTimeblockingPlan, previewTimeblockingPlan } from "@/features/timeblocking/service";
import { addTodoSSEClient, broadcastTodoEvent, type TodoEvent } from "@/services/todo-events";

const TodoStatusSchema = z.enum(["todo", "in_progress", "done", "later"]);
const PrioritySchema = z.enum(["high", "medium", "low", "none"]);
const CalendarReminderPresetSchema = z.enum(["30-15", "none"]);
const nullToUndefined = (value: unknown) => value === null ? undefined : value;
const OptionalStringSchema = z.preprocess(nullToUndefined, z.string().optional());
const OptionalNumberSchema = z.preprocess(nullToUndefined, z.number().optional());
const OptionalBooleanSchema = z.preprocess(nullToUndefined, z.boolean().optional());
const OptionalStringArraySchema = z.preprocess(nullToUndefined, z.array(z.string()).optional());
const OptionalStatusSchema = z.preprocess(nullToUndefined, TodoStatusSchema.optional());
const OptionalStatusArraySchema = z.preprocess(nullToUndefined, z.array(TodoStatusSchema).optional());
const OptionalPrioritySchema = z.preprocess(nullToUndefined, PrioritySchema.optional());
const OptionalCalendarReminderSchema = z.preprocess(nullToUndefined, CalendarReminderPresetSchema.optional());
const ScheduledOverlapSchema = z.object({
    start: z.string(),
    end: z.string(),
});

const GetTodosInputSchema = z.object({
    project: z.string().optional(),
    tagsAll: z.array(z.string()).optional(),
    scheduledOverlap: ScheduledOverlapSchema.optional(),
    status: OptionalStatusSchema,
    statuses: OptionalStatusArraySchema,
});

const GetTodoByIdInputSchema = z.object({
    todoId: z.string(),
});

const CreateTodoInputSchema = z.object({
    title: z.string(),
    description: OptionalStringSchema,
    project: OptionalStringSchema,
    status: OptionalStatusSchema,
    tags: OptionalStringArraySchema,
    scheduledStart: z.string().nullable().optional(),
    scheduledEnd: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    priority: OptionalPrioritySchema,
    duration: OptionalNumberSchema,
    attachments: z.preprocess(nullToUndefined, z.array(z.any()).optional()),
    customColumnId: OptionalStringSchema,
    calendarReminderPreset: OptionalCalendarReminderSchema,
    goalRefs: OptionalStringArraySchema,
});

const UpdateTodoInputSchema = z.object({
    todoId: z.string(),
    updates: z.object({
        title: OptionalStringSchema,
        description: OptionalStringSchema,
        status: OptionalStatusSchema,
        project: OptionalStringSchema,
        archived: OptionalBooleanSchema,
        order: OptionalNumberSchema,
        tags: OptionalStringArraySchema,
        scheduledStart: z.string().nullable().optional(),
        scheduledEnd: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        priority: OptionalPrioritySchema,
        completedAt: OptionalStringSchema,
        duration: z.number().nullable().optional(),
        attachments: z.preprocess(nullToUndefined, z.array(z.any()).optional()),
        customColumnId: OptionalStringSchema,
        calendarReminderPreset: OptionalCalendarReminderSchema,
        goalRefs: OptionalStringArraySchema,
    }),
});

const DeleteTodoInputSchema = z.object({
    todoId: z.string(),
});

const ReorderTodosInputSchema = z.object({
    reorders: z.array(z.object({
        todoId: z.string(),
        order: z.number(),
    })),
});

const ArchivedTodosInputSchema = z.object({
    project: z.string().optional(),
});

const GetBoardConfigInputSchema = z.object({
    projectId: z.string().optional(),
    projectName: z.string().optional(),
});

const SaveBoardConfigInputSchema = z.object({
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    board: z.any(),
});

const DeleteColumnInputSchema = z.object({
    projectId: z.string(),
    columnId: z.string(),
});

const TimeblockingPlanInputSchema = z.object({
    weekStart: z.string(),
    days: z.array(z.object({
        type: DayTypeSchema,
        workEnd: z.string().optional(),
    })).length(7),
});

const EmptyInputSchema = z.object({});

// Exposed for route-schema regression tests.
export const todosRouteSchemasForTests = {
    GetTodosInputSchema,
    CreateTodoInputSchema,
    UpdateTodoInputSchema,
};

function jsonValidationError(error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
}

function jsonError(error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error instanceof Error && "statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number")
        ? (error as { statusCode: number }).statusCode
        : 500;
    return Response.json({ error: message }, { status });
}

function shouldBroadcastTodoEvents(req: Request): boolean {
    return req.headers.get("x-nomendex-source") !== "calendar-sync";
}

function sseResponse(sendClient: (send: (event: TodoEvent) => void) => () => void): Response {
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const send = (event: TodoEvent) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch {
                    cleanup?.();
                }
            };

            controller.enqueue(encoder.encode(": connected\n\n"));
            cleanup = sendClient(send);
        },
        cancel() {
            cleanup?.();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}

export const todosRoutes = {
    "/api/todos/list": {
        async POST(req: Request) {
            let args;
            try {
                args = GetTodosInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await getTodos(args);
            return Response.json(result);
        },
    },
    "/api/todos/get": {
        async POST(req: Request) {
            let args;
            try {
                args = GetTodoByIdInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await getTodoById(args);
            return Response.json(result);
        },
    },
    "/api/todos/create": {
        async POST(req: Request) {
            let args;
            try {
                args = CreateTodoInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await createTodo(args);
            if (shouldBroadcastTodoEvents(req)) {
                broadcastTodoEvent({ type: "upsert", todo: result });
            }
            return Response.json(result);
        },
    },
    "/api/todos/update": {
        async POST(req: Request) {
            let args;
            try {
                args = UpdateTodoInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            try {
                const result = await updateTodo(args);
                if (shouldBroadcastTodoEvents(req)) {
                    broadcastTodoEvent({ type: "upsert", todo: result });
                }
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/todos/delete": {
        async POST(req: Request) {
            let args;
            try {
                args = DeleteTodoInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await deleteTodo(args);
            if (shouldBroadcastTodoEvents(req)) {
                broadcastTodoEvent({ type: "delete", todoId: args.todoId });
            }
            return Response.json(result);
        },
    },
    "/api/todos/projects": {
        async POST() {
            const result = await getProjects();
            return Response.json(result);
        },
    },
    "/api/todos/reorder": {
        async POST(req: Request) {
            let args;
            try {
                args = ReorderTodosInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await reorderTodos(args);
            return Response.json(result);
        },
    },
    "/api/todos/archive": {
        async POST(req: Request) {
            let args;
            try {
                args = DeleteTodoInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await archiveTodo(args);
            if (shouldBroadcastTodoEvents(req)) {
                broadcastTodoEvent({ type: "upsert", todo: result });
            }
            return Response.json(result);
        },
    },
    "/api/todos/unarchive": {
        async POST(req: Request) {
            let args;
            try {
                args = DeleteTodoInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await unarchiveTodo(args);
            if (shouldBroadcastTodoEvents(req)) {
                broadcastTodoEvent({ type: "upsert", todo: result });
            }
            return Response.json(result);
        },
    },
    "/api/todos/archived": {
        async POST(req: Request) {
            let args;
            try {
                args = ArchivedTodosInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            const result = await getArchivedTodos(args);
            return Response.json(result);
        },
    },
    "/api/todos/events": {
        GET() {
            return sseResponse(addTodoSSEClient);
        },
    },
    "/api/todos/tags": {
        async POST() {
            const result = await getTags();
            return Response.json(result);
        },
    },
    "/api/todos/board-config/get": {
        async POST(req: Request) {
            let args;
            try {
                args = GetBoardConfigInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            return Response.json(await getBoardConfig(args));
        },
    },
    "/api/todos/board-config/save": {
        async POST(req: Request) {
            let args;
            try {
                args = SaveBoardConfigInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            return Response.json(await saveBoardConfig(args));
        },
    },
    "/api/todos/column/delete": {
        async POST(req: Request) {
            let args;
            try {
                args = DeleteColumnInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }
            return Response.json(await deleteColumn(args));
        },
    },
    "/api/todos/recompute-goal-refs": {
        async POST() {
            try {
                return Response.json(await recomputeAllGoalRefs());
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return Response.json({ error: msg }, { status: 500 });
            }
        },
    },
    "/api/todos/reindex": {
        async POST(req: Request) {
            try {
                EmptyInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }

            try {
                return Response.json(await forceReindexTodos());
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return Response.json({ error: msg }, { status: 500 });
            }
        },
    },
    "/api/todos/timeblocking/preview": {
        async POST(req: Request) {
            let args;
            try {
                args = TimeblockingPlanInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }

            try {
                return Response.json(await previewTimeblockingPlan(args));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return Response.json({ error: message }, { status: 400 });
            }
        },
    },
    "/api/todos/timeblocking/apply": {
        async POST(req: Request) {
            let args;
            try {
                args = TimeblockingPlanInputSchema.parse(await req.json());
            } catch (error) {
                return jsonValidationError(error);
            }

            try {
                const result = await applyTimeblockingPlan(args);
                if (shouldBroadcastTodoEvents(req)) {
                    for (const deleted of result.deletedBlocks) {
                        broadcastTodoEvent({ type: "delete", todoId: deleted.id });
                    }
                    for (const created of result.createdTodos) {
                        broadcastTodoEvent({ type: "upsert", todo: created });
                    }
                }
                return Response.json(result);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return Response.json({ error: message }, { status: 400 });
            }
        },
    },
};
