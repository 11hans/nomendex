import { describe, expect, test } from "bun:test";
import { todosRouteSchemasForTests } from "./todos-routes";

describe("todos route schema validation", () => {
    test("list schema accepts status filters", () => {
        const parsed = todosRouteSchemasForTests.GetTodosInputSchema.parse({
            project: "Nomendex",
            status: "in_progress",
            statuses: ["todo", "in_progress"],
        });

        expect(parsed).toEqual({
            project: "Nomendex",
            status: "in_progress",
            statuses: ["todo", "in_progress"],
        });
    });

    test("list schema normalizes null status filters to undefined", () => {
        const parsed = todosRouteSchemasForTests.GetTodosInputSchema.parse({
            project: "Nomendex",
            status: null,
            statuses: null,
        });

        expect(parsed).toEqual({
            project: "Nomendex",
            status: undefined,
            statuses: undefined,
        });
    });

    test("create schema accepts null for optional fields and normalizes to undefined where needed", () => {
        const parsed = todosRouteSchemasForTests.CreateTodoInputSchema.parse({
            title: "Test task",
            description: null,
            project: null,
            status: null,
            tags: null,
            scheduledStart: null,
            scheduledEnd: null,
            dueDate: null,
            priority: null,
            duration: null,
            attachments: null,
            customColumnId: null,
            calendarReminderPreset: null,
            goalRefs: null,
        });

        expect(parsed).toEqual({
            title: "Test task",
            description: undefined,
            project: undefined,
            status: undefined,
            tags: undefined,
            scheduledStart: null,
            scheduledEnd: null,
            dueDate: null,
            priority: undefined,
            duration: undefined,
            attachments: undefined,
            customColumnId: undefined,
            calendarReminderPreset: undefined,
            goalRefs: undefined,
        });
    });

    test("update schema accepts null for optional fields and normalizes to undefined where needed", () => {
        const parsed = todosRouteSchemasForTests.UpdateTodoInputSchema.parse({
            todoId: "todo-1",
            updates: {
                title: null,
                description: null,
                status: null,
                project: null,
                archived: null,
                order: null,
                tags: null,
                scheduledStart: null,
                scheduledEnd: null,
                dueDate: null,
                priority: null,
                completedAt: null,
                duration: null,
                attachments: null,
                customColumnId: null,
                calendarReminderPreset: null,
                goalRefs: null,
            },
        });

        expect(parsed).toEqual({
            todoId: "todo-1",
            updates: {
                title: undefined,
                description: undefined,
                status: undefined,
                project: undefined,
                archived: undefined,
                order: undefined,
                tags: undefined,
                scheduledStart: null,
                scheduledEnd: null,
                dueDate: null,
                priority: undefined,
                completedAt: undefined,
                duration: null,
                attachments: undefined,
                customColumnId: undefined,
                calendarReminderPreset: undefined,
                goalRefs: undefined,
            },
        });
    });

    test("schema still rejects invalid non-null values", () => {
        expect(() => todosRouteSchemasForTests.GetTodosInputSchema.parse({
            status: "active",
        })).toThrow();
        expect(() => todosRouteSchemasForTests.CreateTodoInputSchema.parse({
            title: "Task",
            status: "invalid-status",
        })).toThrow();
        expect(() => todosRouteSchemasForTests.UpdateTodoInputSchema.parse({
            todoId: "todo-1",
            updates: {
                priority: "urgent",
            },
        })).toThrow();
    });
});
