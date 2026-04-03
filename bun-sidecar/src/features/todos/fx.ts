import { TypedPluginWithFunctions } from "@/types/Plugin";
import { functionStubs, GetTodosInputSchema, TodosPluginBase } from "./index";
import { FunctionsFromStubs } from "@/types/Functions";
import { createServiceLogger } from "@/lib/logger";
import { Todo } from "./todo-types";
import { FileDatabase } from "@/storage/FileDatabase";
import path from "path";
import { getNomendexPath, getTodosPath, hasActiveWorkspace } from "@/storage/root-path";
import type { Attachment } from "@/types/attachments";
import { BoardConfig } from "./board-types";
import { mkdir } from "node:fs/promises";
import { ensureTimeblockingConfig } from "@/features/timeblocking/config";
import { broadcastTodoEvent } from "@/services/todo-events";
import { sanitizeTodoForClient, sanitizeTodoListForClient } from "./todo-sanitize";

// Create logger for todos plugin
const todosLogger = createServiceLogger("TODOS");

// Lazy-initialized FileDatabase for todos
let todosDb: FileDatabase<Todo> | null = null;
// Lazy-initialized FileDatabase for board configs
let boardConfigDb: FileDatabase<BoardConfig> | null = null;
let lastTimeblockHousekeepingDay: string | null = null;

function getBoardConfigPath(): string {
    return path.join(getTodosPath(), "..", "board-configs");
}

function getTodosLegacyDateMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-schedule-deadline-v1.done");
}

function getTodosScheduleFieldRenameMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-schedule-fields-v2.done");
}

function getTodosNullNormalizationMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-null-normalization-v3.done");
}

/**
 * Initialize the todos service. Must be called after initializePaths().
 */
export async function initializeTodosService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        todosLogger.warn("No active workspace, skipping todos initialization");
        return;
    }
    todosDb = new FileDatabase<Todo>(getTodosPath());
    await todosDb.initialize();

    // NEW: Initialize board config database
    boardConfigDb = new FileDatabase<BoardConfig>(getBoardConfigPath());
    await boardConfigDb.initialize();

    // One-off migration: interpret legacy due/start as schedule fields.
    await runTodosLegacyDateMigrationIfNeeded();
    // One-off migration: rename scheduledStartAt/scheduledEndAt -> scheduledStart/scheduledEnd.
    await runTodosScheduleFieldRenameMigrationIfNeeded();
    // One-off migration: normalize legacy nulls and malformed optional fields.
    await runTodosNullNormalizationMigrationIfNeeded();
    await ensureTimeblockingConfig();
    await runTimeblockHousekeepingIfNeeded();
    todosLogger.info("Todos service initialized");
}

function getDb(): FileDatabase<Todo> {
    if (!todosDb) {
        throw new Error("Todos service not initialized. Call initializeTodosService() first.");
    }
    return todosDb;
}

function hasOwnKey(obj: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function formatDateValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = value.getHours();
    const minutes = value.getMinutes();
    const seconds = value.getSeconds();
    const milliseconds = value.getMilliseconds();

    if (hours === 0 && minutes === 0 && seconds === 0 && milliseconds === 0) {
        return `${year}-${month}-${day}`;
    }

    return `${year}-${month}-${day}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeDateField(value: unknown): string | undefined {
    if (value == null) {
        return undefined;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        // Validate format: must be YYYY-MM-DD or YYYY-MM-DDTHH:mm
        if (parseLocalScheduleDate(trimmed) === undefined) {
            return undefined;
        }
        return trimmed;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDateValue(value);
    }

    return undefined;
}

function normalizeDurationField(value: unknown): number | undefined {
    if (value == null) {
        return undefined;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }

    const rounded = Math.round(value);
    return rounded > 0 ? rounded : undefined;
}

function parseLocalScheduleDate(value: string): Date | undefined {
    const dateTimeMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (dateTimeMatch) {
        const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = dateTimeMatch;
        const year = Number(yearStr);
        const month = Number(monthStr);
        const day = Number(dayStr);
        const hour = Number(hourStr);
        const minute = Number(minuteStr);

        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(hour) || !Number.isInteger(minute)) {
            return undefined;
        }

        const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
        if (
            parsed.getFullYear() !== year
            || parsed.getMonth() !== month - 1
            || parsed.getDate() !== day
            || parsed.getHours() !== hour
            || parsed.getMinutes() !== minute
        ) {
            return undefined;
        }
        return parsed;
    }

    const dateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
        const [, yearStr, monthStr, dayStr] = dateMatch;
        const year = Number(yearStr);
        const month = Number(monthStr);
        const day = Number(dayStr);

        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
            return undefined;
        }

        const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
        if (
            parsed.getFullYear() !== year
            || parsed.getMonth() !== month - 1
            || parsed.getDate() !== day
        ) {
            return undefined;
        }
        return parsed;
    }

    return undefined;
}

function deriveDurationFromSchedule(scheduledStart?: string, scheduledEnd?: string): number | undefined {
    if (!scheduledStart || !scheduledEnd) {
        return undefined;
    }

    const startHasTime = scheduledStart.includes("T");
    const endHasTime = scheduledEnd.includes("T");
    if (!startHasTime && !endHasTime) {
        return undefined;
    }

    const startDate = parseLocalScheduleDate(scheduledStart);
    const endDate = parseLocalScheduleDate(scheduledEnd);
    if (!startDate || !endDate) {
        return undefined;
    }

    const diffMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    return diffMinutes > 0 ? diffMinutes : undefined;
}

export function isTimeblockTags(tags?: string[]): boolean {
    return tags?.includes("timeblock") ?? false;
}

function startOfLocalDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

function formatLocalDayKey(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function getScheduleInterval(todo: Pick<Todo, "scheduledStart" | "scheduledEnd">): {
    start: Date;
    end: Date;
} | null {
    const startValue = todo.scheduledStart ?? todo.scheduledEnd;
    const endValue = todo.scheduledEnd ?? todo.scheduledStart;
    if (!startValue || !endValue) {
        return null;
    }

    const start = parseLocalScheduleDate(startValue);
    const end = parseLocalScheduleDate(endValue);
    if (!start || !end) {
        return null;
    }

    return start.getTime() <= end.getTime()
        ? { start, end }
        : { start: end, end: start };
}

export function intervalsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
    return a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime();
}

export function matchesScheduledOverlap(
    todo: Pick<Todo, "scheduledStart" | "scheduledEnd">,
    overlap: { start: string; end: string },
): boolean {
    const overlapStart = parseLocalScheduleDate(overlap.start);
    const overlapEnd = parseLocalScheduleDate(overlap.end);
    if (!overlapStart || !overlapEnd) {
        throw new Error("Invalid scheduledOverlap range");
    }

    const queryInterval = overlapStart.getTime() <= overlapEnd.getTime()
        ? { start: overlapStart, end: overlapEnd }
        : { start: overlapEnd, end: overlapStart };
    const interval = getScheduleInterval(todo);
    return interval ? intervalsOverlap(interval, queryInterval) : false;
}

export function collectRequestedStatuses(input: {
    status?: Todo["status"];
    statuses?: Todo["status"][];
}): Set<Todo["status"]> {
    const requestedStatuses = new Set<Todo["status"]>();
    if (input.status) {
        requestedStatuses.add(input.status);
    }
    if (input.statuses) {
        for (const status of input.statuses) {
            requestedStatuses.add(status);
        }
    }
    return requestedStatuses;
}

export function shouldRejectTimeblockCompletionChange(input: {
    currentTags?: string[];
    nextTags?: string[];
    status?: Todo["status"];
    completedAtProvided: boolean;
}): boolean {
    const effectiveTags = input.nextTags ?? input.currentTags;
    return isTimeblockTags(effectiveTags)
        && (input.status === "done" || input.completedAtProvided);
}

export function getExpiredTimeblockIds(
    todos: readonly Pick<Todo, "id" | "archived" | "tags" | "scheduledStart" | "scheduledEnd">[],
    now: Date,
): string[] {
    const todayStart = startOfLocalDay(now).getTime();
    return todos
        .filter((todo) => !todo.archived && isTimeblockTags(todo.tags))
        .flatMap((todo) => {
            const interval = getScheduleInterval(todo);
            if (!interval) return [];
            return interval.end.getTime() < todayStart ? [todo.id] : [];
        });
}

export async function runTimeblockHousekeepingIfNeeded(): Promise<void> {
    const now = new Date();
    const todayKey = formatLocalDayKey(now);
    if (lastTimeblockHousekeepingDay === todayKey) {
        return;
    }

    const todos = await getDb().findAll();
    const archivedAt = now.toISOString();
    const expiredIds = new Set(getExpiredTimeblockIds(todos, now));
    const archivedTodos = todos
        .filter((todo) => expiredIds.has(todo.id))
        .map((todo) => ({
            ...todo,
            archived: true,
            updatedAt: archivedAt,
        }));

    if (archivedTodos.length > 0) {
        await getDb().updateMany(archivedTodos.map((todo) => ({
            id: todo.id,
            updates: {
                archived: true,
                updatedAt: archivedAt,
            } satisfies Partial<Todo>,
        })));
        for (const todo of archivedTodos) {
            broadcastTodoEvent({ type: "upsert", todo });
        }
        todosLogger.info(`Auto-archived ${archivedTodos.length} expired timeblocks`);
    }

    lastTimeblockHousekeepingDay = todayKey;
}

function resolveLegacyScheduleFields(startValue: unknown, dueValue: unknown): {
    scheduledStart?: string;
    scheduledEnd?: string;
} {
    const legacyStart = normalizeDateField(startValue);
    const legacyDue = normalizeDateField(dueValue);

    if (legacyStart && legacyDue) {
        return {
            scheduledStart: legacyStart,
            scheduledEnd: legacyDue,
        };
    }

    if (legacyStart) {
        return {
            scheduledStart: legacyStart,
            scheduledEnd: undefined,
        };
    }

    if (legacyDue) {
        return {
            scheduledStart: legacyDue,
            scheduledEnd: undefined,
        };
    }

    return {
        scheduledStart: undefined,
        scheduledEnd: undefined,
    };
}

function isPermissionError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const code = (error as { code?: unknown }).code;
    if (code === "EPERM" || code === "EACCES") {
        return true;
    }

    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && /(?:permission denied|operation not permitted|EPERM|EACCES)/i.test(message);
}

async function runTodosLegacyDateMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosLegacyDateMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);

    if (await markerFile.exists()) {
        todosLogger.info("Todos date migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    let migratedCount = 0;

    // Intentionally migrate all todos, including status="done".
    // We preserve historical schedule context uniformly and avoid
    // introducing status-based migration branches.
    for (const todo of todos) {
        const rawTodo = todo as unknown as Record<string, unknown>;
        const hasLegacyStartKey = hasOwnKey(rawTodo, "startDate");
        const hasLegacyDueKey = hasOwnKey(rawTodo, "dueDate");

        if (!hasLegacyStartKey && !hasLegacyDueKey) {
            continue;
        }

        const { scheduledStart, scheduledEnd } = resolveLegacyScheduleFields(rawTodo.startDate, rawTodo.dueDate);

        const migrationUpdates = {
            updatedAt: new Date().toISOString(),
            startDate: undefined,
            dueDate: undefined,
            scheduledStart,
            scheduledEnd,
        } as Partial<Todo> & Record<string, unknown>;

        await getDb().update(todo.id, migrationUpdates as Partial<Todo>);
        migratedCount += 1;
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        migratedCount,
    }, null, 2));

    todosLogger.info(`Todos legacy date migration complete (${migratedCount} records migrated)`);
}

// Cleans up `scheduledStartAt`/`scheduledEndAt` field names from the initial dev branch
// implementation, renaming them to the final `scheduledStart`/`scheduledEnd` convention.
async function runTodosScheduleFieldRenameMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosScheduleFieldRenameMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);

    if (await markerFile.exists()) {
        todosLogger.info("Todos schedule field rename migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    let migratedCount = 0;

    for (const todo of todos) {
        const rawTodo = todo as unknown as Record<string, unknown>;
        const hasOldStartKey = hasOwnKey(rawTodo, "scheduledStartAt");
        const hasOldEndKey = hasOwnKey(rawTodo, "scheduledEndAt");

        if (!hasOldStartKey && !hasOldEndKey) {
            continue;
        }

        const oldScheduledStart = normalizeDateField(rawTodo.scheduledStartAt);
        const oldScheduledEnd = normalizeDateField(rawTodo.scheduledEndAt);
        const hasNewStart = hasOwnKey(rawTodo, "scheduledStart");
        const hasNewEnd = hasOwnKey(rawTodo, "scheduledEnd");
        const normalizedNewStart = normalizeDateField(rawTodo.scheduledStart);
        const normalizedNewEnd = normalizeDateField(rawTodo.scheduledEnd);

        const migrationUpdates = {
            updatedAt: new Date().toISOString(),
            scheduledStart: hasNewStart ? normalizedNewStart : oldScheduledStart,
            scheduledEnd: hasNewEnd ? normalizedNewEnd : oldScheduledEnd,
            scheduledStartAt: undefined,
            scheduledEndAt: undefined,
        } as Partial<Todo> & Record<string, unknown>;

        await getDb().update(todo.id, migrationUpdates as Partial<Todo>);
        migratedCount += 1;
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        migratedCount,
    }, null, 2));

    todosLogger.info(`Todos schedule field rename migration complete (${migratedCount} records migrated)`);
}

async function runTodosNullNormalizationMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosNullNormalizationMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);

    if (await markerFile.exists()) {
        todosLogger.info("Todos null normalization migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    let migratedCount = 0;

    for (const todo of todos) {
        const normalized = sanitizeTodoForClient(todo);
        if (JSON.stringify(normalized) === JSON.stringify(todo)) {
            continue;
        }

        await getDb().update(todo.id, normalized as Partial<Todo>);
        migratedCount += 1;
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        migratedCount,
    }, null, 2));

    todosLogger.info(`Todos null normalization migration complete (${migratedCount} records migrated)`);
}

/**
 * Compute resolvedGoalRefs for a todo.
 * If the todo has explicit goalRefs, use those.
 * Otherwise, inherit from the project's goalRef.
 */
function computeResolvedGoalRefs(
    goalRefs: string[] | null | undefined,
    projectGoalRef: string | undefined,
): string[] {
    if (goalRefs != null) return goalRefs;
    if (projectGoalRef) return [projectGoalRef];
    return [];
}

/**
 * Look up a project's goalRef by project name.
 * Returns undefined if project not found or has no goalRef.
 */
async function getProjectGoalRef(projectName: string | undefined): Promise<string | undefined> {
    if (!projectName || projectName.trim() === "") return undefined;
    try {
        const { getProjectByName } = await import("@/features/projects/fx");
        const project = await getProjectByName({ name: projectName });
        return project?.goalRef ?? undefined;
    } catch {
        return undefined;
    }
}

async function getTodos(rawInput: unknown) {
    const input = GetTodosInputSchema.parse(rawInput ?? {});
    todosLogger.info(`Getting todos${input.project != null ? ` for project: ${input.project || "No Project"}` : ""}`);

    try {
        await runTimeblockHousekeepingIfNeeded();

        const todos = await getDb().findAll();

        let activeTodos = todos.filter(t => !t.archived);

        // Filter by project if specified
        if (input.project != null) {
            if (input.project === "") {
                // Empty string means "no project" - filter for todos without a project (exclude items with any project)
                activeTodos = activeTodos.filter(t => !t.project || t.project.trim() === "");
            } else {
                // Filter for specific project
                activeTodos = activeTodos.filter(t => t.project === input.project);
            }
        }

        if (input.tagsAll && input.tagsAll.length > 0) {
            activeTodos = activeTodos.filter((todo) => input.tagsAll!.every((tag) => todo.tags?.includes(tag)));
        }

        if (input.scheduledOverlap) {
            activeTodos = activeTodos.filter((todo) => matchesScheduledOverlap(todo, input.scheduledOverlap!));
        }

        const requestedStatuses = collectRequestedStatuses(input);
        if (requestedStatuses.size > 0) {
            activeTodos = activeTodos.filter((todo) => requestedStatuses.has(todo.status));
        }

        // Sort todos by order (nulls last)
        activeTodos.sort((a, b) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        });

        const sanitized = sanitizeTodoListForClient(activeTodos);
        todosLogger.info(`Retrieved ${sanitized.length} todos`);
        return sanitized;
    } catch (error) {
        todosLogger.error(`Failed to get todos`, { error });
        throw error;
    }
}

async function getTodoById(input: { todoId: string }) {
    todosLogger.info(`Getting todo by ID: ${input.todoId}`);

    try {
        const todo = await getDb().findById(input.todoId);

        if (!todo) {
            todosLogger.warn(`Todo not found: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        const sanitized = sanitizeTodoForClient(todo);
        todosLogger.info(`Retrieved todo: ${input.todoId}`);
        return sanitized;
    } catch (error) {
        todosLogger.error(`Failed to get todo ${input.todoId}`, { error });
        throw error;
    }
}

async function createTodo(input: {
    title: string;
    description?: string;
    project?: string;
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
}) {
    todosLogger.info(`Creating new todo: ${input.title}`);

    try {
        // Validate that the project exists BEFORE creating the todo
        if (input.project && input.project.trim() !== "") {
            const { getProjectByName } = await import("@/features/projects/fx");
            const project = await getProjectByName({ name: input.project });
            if (!project) {
                throw new Error(`Project '${input.project}' does not exist. Please ask the user to create it manually: Open the 'Projects' view from the sidebar and click 'New Project'.`);
            }
        }

        const requestedStatus = input.status || "todo";
        if (shouldRejectTimeblockCompletionChange({
            nextTags: input.tags,
            status: requestedStatus,
            completedAtProvided: false,
        })) {
            throw new Error("Timeblocks cannot be created as completed while they still carry the timeblock tag.");
        }

        // Get existing todos to determine next order
        const existingTodos = await getDb().findAll();
        const status = requestedStatus;

        // Find max order for this status
        const todosInStatus = existingTodos.filter(t => t.status === status && !t.archived);
        const maxOrder = todosInStatus.reduce((max, todo) => {
            return Math.max(max, todo.order || 0);
        }, 0);

        // Generate a slug from the title (lowercase, no special chars, hyphens instead of spaces)
        let slug = input.title
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents/diacritics
            .replace(/[^a-z0-9\s-]/g, "") // remove non-alphanumeric chars
            .trim()
            .replace(/\s+/g, "-") // replace spaces with hyphens
            .replace(/-+/g, "-"); // remove consecutive hyphens

        // Limit slug length
        if (slug.length > 50) {
            slug = slug.substring(0, 50).replace(/-$/, "");
        }

        // Fallback if title was entirely emojis/special chars
        if (!slug) {
            slug = Math.random().toString(36).substr(2, 6);
        }

        const scheduledStart = normalizeDateField(input.scheduledStart);
        const scheduledEnd = normalizeDateField(input.scheduledEnd);
        const deadlineDueDate = normalizeDateField(input.dueDate);
        const requestedDuration = normalizeDurationField(input.duration);
        const derived = scheduledEnd ? deriveDurationFromSchedule(scheduledStart, scheduledEnd) : undefined;
        const duration = derived ?? requestedDuration;

        // Compute resolvedGoalRefs
        const projectGoalRef = await getProjectGoalRef(input.project);
        const resolvedGoalRefs = computeResolvedGoalRefs(input.goalRefs, projectGoalRef);

        const now = new Date().toISOString();
        const newTodo: Todo = {
            id: `todo-${slug}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            title: input.title,
            description: input.description,
            status: status,
            createdAt: now,
            updatedAt: now,
            archived: false,
            project: input.project,
            order: maxOrder + 1,
            tags: input.tags,
            scheduledStart,
            scheduledEnd,
            dueDate: deadlineDueDate,
            priority: input.priority,
            completedAt: status === "done" ? now : undefined,
            duration,
            attachments: input.attachments,
            customColumnId: input.customColumnId,
            calendarReminderPreset: input.calendarReminderPreset,
            goalRefs: input.goalRefs,
            resolvedGoalRefs: resolvedGoalRefs.length > 0 ? resolvedGoalRefs : undefined,
        };

        const created = await getDb().create(newTodo);

        const sanitized = sanitizeTodoForClient(created);
        todosLogger.info(`Created todo: ${sanitized.id} with order ${sanitized.order}`);
        return sanitized;
    } catch (error) {
        todosLogger.error(`Failed to create todo`, { error });
        throw error;
    }
}

async function updateTodo(input: {
    todoId: string;
    updates: {
        title?: string;
        description?: string;
        status?: "todo" | "in_progress" | "done" | "later";
        project?: string;
        archived?: boolean;
        order?: number;
        tags?: string[];
        scheduledStart?: string | null;
        scheduledEnd?: string | null;
        dueDate?: string | null;
        priority?: "high" | "medium" | "low" | "none";
        completedAt?: string;
        duration?: number | null;
        attachments?: Attachment[];
        customColumnId?: string;
        calendarReminderPreset?: "30-15" | "none";
        goalRefs?: string[];
    };
}) {
    todosLogger.info(`Updating todo: ${input.todoId}`);

    try {
        // Validate that the project exists if it's being updated
        if (input.updates.project && input.updates.project.trim() !== "") {
            const { getProjectByName } = await import("@/features/projects/fx");
            const project = await getProjectByName({ name: input.updates.project });
            if (!project) {
                throw new Error(`Project '${input.updates.project}' does not exist. Please ask the user to create it manually: Open the 'Projects' view from the sidebar and click 'New Project'.`);
            }
        }

        const currentTodo = await getDb().findById(input.todoId);
        if (!currentTodo) {
            todosLogger.warn(`Todo not found for update: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        // Guard: reject goalRefs mutation on a todo that is already closed and stays closed.
        // Closed todos have a frozen resolvedGoalRefs snapshot; mutating goalRefs would cause drift.
        const wouldBeClosed = (input.updates.status ?? currentTodo.status) === "done"
            || (input.updates.archived ?? currentTodo.archived) === true;
        const isAlreadyClosed = currentTodo.status === "done" || currentTodo.archived === true;
        if (
            hasOwnKey(input.updates, "goalRefs") &&
            isAlreadyClosed &&
            wouldBeClosed
        ) {
            throw Object.assign(
                new Error("Goal link cannot be changed on a completed or archived todo. The goal link is frozen for historical reporting."),
                { statusCode: 409 }
            );
        }

        let updates = {
            ...input.updates,
            updatedAt: new Date().toISOString(),
        } as Partial<Todo>;

        const resultingTags = hasOwnKey(input.updates, "tags")
            ? (input.updates.tags ?? undefined)
            : currentTodo.tags;
        if (shouldRejectTimeblockCompletionChange({
            currentTags: currentTodo.tags,
            nextTags: resultingTags,
            status: input.updates.status,
            completedAtProvided: hasOwnKey(input.updates, "completedAt"),
        })) {
            throw new Error("Timeblocks cannot be marked completed while they still carry the timeblock tag.");
        }

        if (hasOwnKey(input.updates, "scheduledStart")) {
            updates.scheduledStart = normalizeDateField(input.updates.scheduledStart);
        }

        if (hasOwnKey(input.updates, "scheduledEnd")) {
            updates.scheduledEnd = normalizeDateField(input.updates.scheduledEnd);
        }

        if (hasOwnKey(input.updates, "dueDate")) {
            updates.dueDate = normalizeDateField(input.updates.dueDate);
        }

        if (hasOwnKey(input.updates, "duration")) {
            updates.duration = normalizeDurationField(input.updates.duration);
        }

        const shouldReconcileDuration = hasOwnKey(input.updates, "scheduledStart")
            || hasOwnKey(input.updates, "scheduledEnd")
            || hasOwnKey(input.updates, "duration");

        if (shouldReconcileDuration) {
            const nextScheduledStart = hasOwnKey(input.updates, "scheduledStart")
                ? updates.scheduledStart
                : currentTodo.scheduledStart;
            const nextScheduledEnd = hasOwnKey(input.updates, "scheduledEnd")
                ? updates.scheduledEnd
                : currentTodo.scheduledEnd;

            // Range schedule is authoritative; when scheduledEnd exists, duration is derived from it.
            // For date-only ranges (no time component), deriveDurationFromSchedule returns undefined;
            // in that case we preserve the existing duration rather than clearing it.
            if (nextScheduledEnd) {
                const derived = deriveDurationFromSchedule(nextScheduledStart, nextScheduledEnd);
                if (derived !== undefined) {
                    updates.duration = derived;
                }
            }
        }

        // If status is changing, assign new order for the target status
        if (input.updates.status) {
            if (currentTodo.status !== input.updates.status) {
                // Get existing todos to determine next order for new status
                const existingTodos = await getDb().findAll();
                const todosInNewStatus = existingTodos.filter(t =>
                    t.status === input.updates.status && !t.archived && t.id !== input.todoId
                );
                const maxOrder = todosInNewStatus.reduce((max, todo) => {
                    return Math.max(max, todo.order || 0);
                }, 0);

                updates.order = maxOrder + 1;
                todosLogger.info(`Status changed, assigning new order: ${updates.order}`);

                // Auto-set completedAt when status changes to/from done
                if (input.updates.status === "done") {
                    updates.completedAt = new Date().toISOString();
                } else if (currentTodo.status === "done") {
                    updates.completedAt = undefined;
                }
            }
        }

        // Compute resolvedGoalRefs based on status and archived state.
        // "closed" means status=done OR archived=true.
        const effectiveStatus = input.updates.status ?? currentTodo.status;
        const effectiveArchived = input.updates.archived ?? currentTodo.archived;
        const isClosed = effectiveStatus === "done" || effectiveArchived === true;
        const wasClosed = currentTodo.status === "done" || currentTodo.archived === true;
        const isClosing = isClosed && !wasClosed;

        if (isClosing) {
            // Freezing: compute and set resolvedGoalRefs as a snapshot
            const effectiveGoalRefs = input.updates.goalRefs ?? currentTodo.goalRefs;
            const effectiveProject = input.updates.project ?? currentTodo.project;
            const projectGoalRef = await getProjectGoalRef(effectiveProject);
            const resolved = computeResolvedGoalRefs(effectiveGoalRefs, projectGoalRef);
            updates.resolvedGoalRefs = resolved.length > 0 ? resolved : undefined;
        } else if (!isClosed) {
            // Open todo: recompute resolvedGoalRefs
            const effectiveGoalRefs = input.updates.goalRefs ?? currentTodo.goalRefs;
            const effectiveProject = input.updates.project ?? currentTodo.project;
            const projectGoalRef = await getProjectGoalRef(effectiveProject);
            const resolved = computeResolvedGoalRefs(effectiveGoalRefs, projectGoalRef);
            updates.resolvedGoalRefs = resolved.length > 0 ? resolved : undefined;
        }
        // If already closed (done/archived) and staying closed, don't recompute — keep frozen

        const updated = await getDb().update(input.todoId, updates as Partial<Todo>);

        if (!updated) {
            todosLogger.warn(`Todo not found for update after write: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        const sanitized = sanitizeTodoForClient(updated);
        todosLogger.info(`Updated todo: ${input.todoId}`);
        return sanitized;
    } catch (error) {
        todosLogger.error(`Failed to update todo ${input.todoId}`, { error });
        throw error;
    }
}

async function deleteTodo(input: { todoId: string }) {
    todosLogger.info(`Deleting todo: ${input.todoId}`);

    try {
        const deleted = await getDb().delete(input.todoId);

        if (!deleted) {
            todosLogger.warn(`Todo not found for deletion: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Deleted todo: ${input.todoId}`);
        return { success: true };
    } catch (error) {
        todosLogger.error(`Failed to delete todo ${input.todoId}`, { error });
        throw error;
    }
}

async function restoreTodoSnapshot(todo: Todo): Promise<Todo> {
    await getDb().create(todo);
    return todo;
}

async function getProjects() {
    todosLogger.info(`Getting unique projects`);

    try {
        await runTimeblockHousekeepingIfNeeded();
        const todos = await getDb().findAll();
        const activeTodos = todos.filter(t => !t.archived);

        // Extract unique projects from active todos
        const projectSet = new Set<string>();
        for (const todo of activeTodos) {
            const projectName = todo.project?.trim();
            if (projectName) {
                projectSet.add(projectName);
            }
        }

        // Include projects from projects.json so newly created projects
        // are visible in pickers even before any todo is assigned to them.
        try {
            const { listProjects } = await import("@/features/projects/fx");
            const configuredProjects = await listProjects({ includeArchived: false });
            for (const project of configuredProjects) {
                const projectName = project.name?.trim();
                if (projectName) {
                    projectSet.add(projectName);
                }
            }
        } catch (error) {
            todosLogger.warn("Failed to load projects from projects service, falling back to todo-derived projects", { error });
        }

        const projects = Array.from(projectSet).sort();
        todosLogger.info(`Found ${projects.length} unique projects`);
        return projects;
    } catch (error) {
        if (isPermissionError(error)) {
            todosLogger.warn("Permission error while loading todo projects; returning empty fallback list", { error });
            return [];
        }
        todosLogger.error(`Failed to get projects`, { error });
        throw error;
    }
}

async function reorderTodos(input: {
    reorders: { todoId: string; order: number }[];
}) {
    todosLogger.info(`Reordering ${input.reorders.length} todos`);

    try {
        // Update each todo with its new order
        for (const reorder of input.reorders) {
            await getDb().update(reorder.todoId, {
                order: reorder.order,
                updatedAt: new Date().toISOString(),
            });
        }

        todosLogger.info(`Successfully reordered todos`);
        return { success: true };
    } catch (error) {
        todosLogger.error(`Failed to reorder todos`, { error });
        throw error;
    }
}

async function archiveTodo(input: { todoId: string }) {
    todosLogger.info(`Archiving todo: ${input.todoId}`);
    // Route through updateTodo so resolvedGoalRefs freeze/recompute logic stays consistent.
    return updateTodo({ todoId: input.todoId, updates: { archived: true } });
}

async function unarchiveTodo(input: { todoId: string }) {
    todosLogger.info(`Unarchiving todo: ${input.todoId}`);
    // Route through updateTodo so resolvedGoalRefs recompute logic stays consistent.
    return updateTodo({ todoId: input.todoId, updates: { archived: false } });
}

/**
 * Batch recompute resolvedGoalRefs for all todos.
 * - Open todos: recompute from explicit goalRefs or project.goalRef (live).
 * - Done/archived todos: only fill in if currently missing (frozen snapshot).
 * Returns counts of updated and skipped todos.
 */
export async function recomputeAllGoalRefs(): Promise<{
    updated: number;
    skipped: number;
    errors: number;
}> {
    todosLogger.info("Starting batch recompute of resolvedGoalRefs");
    const todos = await getDb().findAll();

    // Build project→goalRef map once (avoid N×M lookups)
    const projectGoalRefMap = new Map<string, string>();
    try {
        const { listProjects } = await import("@/features/projects/fx");
        const projects = await listProjects({ includeArchived: false });
        for (const p of projects) {
            if (p.name && p.goalRef) {
                projectGoalRefMap.set(p.name.trim().toLowerCase(), p.goalRef);
            }
        }
    } catch {
        todosLogger.warn("Failed to load projects for batch recompute");
    }

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const todo of todos) {
        try {
            const isClosed = todo.status === "done" || todo.archived === true;

            if (isClosed) {
                // Frozen: closed todos never get resolvedGoalRefs recomputed.
                // Their snapshot was taken at completion time.
                skipped++;
            } else {
                // Open: always recompute
                const projectGoalRef = todo.project
                    ? projectGoalRefMap.get(todo.project.trim().toLowerCase())
                    : undefined;
                const resolved = computeResolvedGoalRefs(todo.goalRefs, projectGoalRef);
                const current = todo.resolvedGoalRefs ?? [];
                const hasChange =
                    resolved.length !== current.length ||
                    resolved.some((r, i) => r !== current[i]);
                if (hasChange) {
                    await getDb().update(todo.id, {
                        resolvedGoalRefs: resolved.length > 0 ? resolved : undefined,
                        updatedAt: new Date().toISOString(),
                    });
                    updated++;
                } else {
                    skipped++;
                }
            }
        } catch {
            errors++;
        }
    }

    todosLogger.info(`Batch recompute done: updated=${updated}, skipped=${skipped}, errors=${errors}`);
    return { updated, skipped, errors };
}

async function forceReindexTodos(): Promise<{
    success: true;
    scanned: number;
    normalized: number;
    reindexedAt: string;
}> {
    todosLogger.info("Force reindex requested");

    const todos = await getDb().findAll();
    let normalized = 0;

    for (const todo of todos) {
        const sanitized = sanitizeTodoForClient(todo);
        if (JSON.stringify(sanitized) === JSON.stringify(todo)) {
            continue;
        }
        await getDb().update(todo.id, sanitized as Partial<Todo>);
        normalized += 1;
    }

    // Housekeeping is cached per day; reset and force-run as part of manual reindex.
    lastTimeblockHousekeepingDay = null;
    await runTimeblockHousekeepingIfNeeded();

    const result = {
        success: true as const,
        scanned: todos.length,
        normalized,
        reindexedAt: new Date().toISOString(),
    };
    todosLogger.info("Force reindex finished", result);
    return result;
}

async function getArchivedTodos(input: { project?: string }) {
    todosLogger.info(`Getting archived todos${input.project != null ? ` for project: ${input.project || 'No Project'}` : ''}`);

    try {
        const todos = await getDb().findAll();
        console.log("All todos found:", todos.length);

        let archivedTodos = todos.filter(t => t.archived);
        console.log("Archived todos before project filter:", archivedTodos.length, archivedTodos.map(t => ({ id: t.id, title: t.title, project: t.project, archived: t.archived })));

        // Filter by project if specified
        if (input.project != null) {
            console.log("Filtering by project:", input.project);
            if (input.project === "") {
                // Empty string means "no project" - filter for todos without a project
                archivedTodos = archivedTodos.filter(t => !t.project || t.project.trim() === "");
            } else {
                // Filter for specific project
                archivedTodos = archivedTodos.filter(t => t.project === input.project);
            }
            console.log("Archived todos after project filter:", archivedTodos.length);
        }

        // Sort todos by order (nulls last)
        archivedTodos.sort((a, b) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        });

        const sanitized = sanitizeTodoListForClient(archivedTodos);
        todosLogger.info(`Retrieved ${sanitized.length} archived todos`);
        console.log("Final archived todos:", sanitized);
        return sanitized;
    } catch (error) {
        todosLogger.error(`Failed to get archived todos`, { error });
        throw error;
    }
}

async function getTags() {
    todosLogger.info(`Getting unique tags`);

    try {
        await runTimeblockHousekeepingIfNeeded();
        const todos = await getDb().findAll();
        const activeTodos = todos.filter(t => !t.archived);

        // Extract unique tags
        const tagSet = new Set<string>();
        for (const todo of activeTodos) {
            if (todo.tags) {
                for (const tag of todo.tags) {
                    tagSet.add(tag);
                }
            }
        }

        const tags = Array.from(tagSet).sort();
        todosLogger.info(`Found ${tags.length} unique tags`);
        return tags;
    } catch (error) {
        todosLogger.error(`Failed to get tags`, { error });
        throw error;
    }
}

function getBoardConfigDb(): FileDatabase<BoardConfig> {
    if (!boardConfigDb) {
        throw new Error("Board config service not initialized.");
    }
    return boardConfigDb;
}

/**
 * Get board config for a project. Returns null if not found.
 */
async function getBoardConfig(input: { projectId: string }): Promise<BoardConfig | null> {
    todosLogger.info(`Getting board config for project: ${input.projectId || "(no project)"}`);

    try {
        const configs = await getBoardConfigDb().findAll();
        const config = configs.find(c => c.projectId === input.projectId);
        return config || null;
    } catch (error) {
        todosLogger.error(`Failed to get board config`, { error });
        throw error;
    }
}

/**
 * Save board config (create new or update existing).
 */
async function saveBoardConfig(input: { config: BoardConfig }): Promise<BoardConfig> {
    todosLogger.info(`Saving board config for project: ${input.config.projectId || "(no project)"}`);

    try {
        const existing = await getBoardConfig({ projectId: input.config.projectId });

        if (existing) {
            // Update existing
            const updated = await getBoardConfigDb().update(existing.id, input.config);
            if (!updated) throw new Error("Failed to update board config");
            return updated;
        } else {
            // Create new
            const created = await getBoardConfigDb().create(input.config);
            return created;
        }
    } catch (error) {
        todosLogger.error(`Failed to save board config`, { error });
        throw error;
    }
}

/**
 * Delete a column and migrate its todos to the first remaining column.
 */
async function deleteColumn(input: { projectId: string; columnId: string }): Promise<{ success: boolean }> {
    todosLogger.info(`Deleting column ${input.columnId} from project ${input.projectId}`);

    try {
        const config = await getBoardConfig({ projectId: input.projectId });
        if (!config) throw new Error("Board config not found");

        // Find fallback column
        const sortedColumns = [...config.columns].sort((a, b) => a.order - b.order);
        const fallbackColumn = sortedColumns.find(c => c.id !== input.columnId);
        if (!fallbackColumn) throw new Error("Cannot delete the only column");

        // Migrate todos from deleted column
        const todos = await getDb().findAll();
        const orphanTodos = todos.filter(t => {
            const todoProject = t.project || "";
            return todoProject === input.projectId && t.customColumnId === input.columnId;
        });

        for (const todo of orphanTodos) {
            await getDb().update(todo.id, {
                customColumnId: fallbackColumn.id,
                updatedAt: new Date().toISOString()
            });
        }

        // Remove column from config
        const newColumns = config.columns.filter(c => c.id !== input.columnId);
        await saveBoardConfig({
            config: { ...config, columns: newColumns }
        });

        todosLogger.info(`Deleted column, moved ${orphanTodos.length} todos to ${fallbackColumn.title}`);
        return { success: true };
    } catch (error) {
        todosLogger.error(`Failed to delete column`, { error });
        throw error;
    }
}


const functions: FunctionsFromStubs<typeof functionStubs> = {
    getTodos: { ...functionStubs.getTodos, fx: getTodos },
    getTodoById: { ...functionStubs.getTodoById, fx: getTodoById },
    createTodo: { ...functionStubs.createTodo, fx: createTodo },
    updateTodo: { ...functionStubs.updateTodo, fx: updateTodo },
    deleteTodo: { ...functionStubs.deleteTodo, fx: deleteTodo },
    getProjects: { ...functionStubs.getProjects, fx: getProjects },
    reorderTodos: { ...functionStubs.reorderTodos, fx: reorderTodos },
    archiveTodo: { ...functionStubs.archiveTodo, fx: archiveTodo },
    unarchiveTodo: { ...functionStubs.unarchiveTodo, fx: unarchiveTodo },
    getArchivedTodos: { ...functionStubs.getArchivedTodos, fx: getArchivedTodos },
    getTags: { ...functionStubs.getTags, fx: getTags },
    getBoardConfig: { ...functionStubs.getBoardConfig, fx: getBoardConfig },
    saveBoardConfig: { ...functionStubs.saveBoardConfig, fx: saveBoardConfig },
    deleteColumn: { ...functionStubs.deleteColumn, fx: deleteColumn },
};

// MCP Server configuration (backend only)
const mcpServers = {
    todos: {
        name: "todos-mcp-server",
        version: "1.0.0",
        cmd: "bun",
        args: [path.resolve(__dirname, "./TodoMCPServer.ts")],
    }
};

const TodosPlugin: TypedPluginWithFunctions<typeof functionStubs> = {
    ...TodosPluginBase,
    mcpServers,
    functions,
};

export default TodosPlugin;
export const TodosPluginWithFunctions = TodosPlugin;

// Export individual functions for MCP
export {
    getTodos, createTodo, updateTodo, deleteTodo, getTodoById,
    getProjects, reorderTodos, archiveTodo, unarchiveTodo, getArchivedTodos, getTags,
    getBoardConfig, saveBoardConfig, deleteColumn, restoreTodoSnapshot, forceReindexTodos
};
