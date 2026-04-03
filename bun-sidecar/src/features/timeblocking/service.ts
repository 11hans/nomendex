import { createTodo, deleteTodo, getProjects, getTodos, restoreTodoSnapshot } from "@/features/todos/fx";
import type { Todo } from "@/features/todos/todo-types";
import { ensureTimeblockingConfig } from "./config";
import { addDays, formatLocalDate, formatLocalDateTime, generateTimeblocks } from "./generate";
import type { DayConfig, GeneratedTimeblock, TimeblockingConflict, CoverageResult } from "./types";
import { checkCoverage, validateGeneratedTimeblocks } from "./validate";

export interface TimeblockingPlanInput {
    weekStart: string;
    days: DayConfig[];
}

export interface TimeblockingPreviewResult {
    weekStart: string;
    existingBlocks: Todo[];
    generatedBlocks: GeneratedTimeblock[];
    conflicts: TimeblockingConflict[];
    coverage: CoverageResult[];
}

export interface TimeblockingApplyResult extends TimeblockingPreviewResult {
    createdTodos: Todo[];
    deletedBlocks: Todo[];
}

function parseWeekStart(value: string): Date {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new Error("weekStart must use YYYY-MM-DD format.");
    }

    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error("Invalid weekStart.");
    }
    if (parsed.getDay() !== 1) {
        throw new Error("weekStart must be a Monday.");
    }
    return parsed;
}

function getWeekWindow(weekStart: Date): { start: string; end: string } {
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);

    const end = addDays(weekStart, 6);
    end.setHours(23, 59, 0, 0);

    return {
        start: formatLocalDateTime(start),
        end: formatLocalDateTime(end),
    };
}

function toConflict(error: unknown, weekStart: Date): TimeblockingConflict[] {
    const message = error instanceof Error ? error.message : String(error);
    return [{
        code: message.includes("workEnd") ? "missing-work-end" : "invalid-time-expression",
        message,
        day: formatLocalDate(weekStart),
    }];
}

export async function previewTimeblockingPlan(input: TimeblockingPlanInput): Promise<TimeblockingPreviewResult> {
    if (input.days.length !== 7) {
        throw new Error("Timeblocking preview requires exactly 7 day configs.");
    }

    const weekStart = parseWeekStart(input.weekStart);
    const config = await ensureTimeblockingConfig();
    const { start, end } = getWeekWindow(weekStart);
    const existingBlocks = await getTodos({
        tagsAll: ["timeblock"],
        scheduledOverlap: { start, end },
    });

    let generatedBlocks: GeneratedTimeblock[] = [];
    let conflicts: TimeblockingConflict[] = [];
    try {
        generatedBlocks = generateTimeblocks(weekStart, input.days, config);
    } catch (error) {
        conflicts = toConflict(error, weekStart);
    }

    const coverage = checkCoverage(generatedBlocks, config);
    const availableProjects = await getProjects();
    conflicts = conflicts.concat(validateGeneratedTimeblocks(generatedBlocks, config, availableProjects));

    return {
        weekStart: formatLocalDate(weekStart),
        existingBlocks,
        generatedBlocks,
        conflicts,
        coverage,
    };
}

export async function applyTimeblockingPlan(input: TimeblockingPlanInput): Promise<TimeblockingApplyResult> {
    const preview = await previewTimeblockingPlan(input);
    if (preview.conflicts.length > 0) {
        throw new Error("Cannot apply timeblocking plan while conflicts are present.");
    }

    const deletedBlocks = preview.existingBlocks;
    const createdTodos: Todo[] = [];

    try {
        for (const todo of deletedBlocks) {
            await deleteTodo({ todoId: todo.id });
        }

        for (const block of preview.generatedBlocks) {
            const created = await createTodo(block);
            createdTodos.push(created);
        }
    } catch (error) {
        for (const created of createdTodos) {
            try {
                await deleteTodo({ todoId: created.id });
            } catch {
                // Best-effort rollback of partially created items.
            }
        }

        for (const snapshot of deletedBlocks) {
            try {
                await restoreTodoSnapshot(snapshot);
            } catch {
                // Best-effort rollback of deleted snapshots.
            }
        }
        throw error;
    }

    return {
        ...preview,
        createdTodos,
        deletedBlocks,
    };
}
