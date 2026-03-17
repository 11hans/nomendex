import { TypedPluginWithFunctions } from "@/types/Plugin";
import { functionStubs, TodosPluginBase } from "./index";
import { FunctionsFromStubs } from "@/types/Functions";
import { createServiceLogger } from "@/lib/logger";
import { Todo } from "./todo-types";
import { FileDatabase } from "@/storage/FileDatabase";
import path from "path";
import { getNomendexPath, getTodosPath, hasActiveWorkspace } from "@/storage/root-path";
import type { Attachment } from "@/types/attachments";
import { BoardConfig } from "./board-types";
import { mkdir } from "node:fs/promises";

// Create logger for todos plugin
const todosLogger = createServiceLogger("TODOS");

// Lazy-initialized FileDatabase for todos
let todosDb: FileDatabase<Todo> | null = null;
// Lazy-initialized FileDatabase for board configs
let boardConfigDb: FileDatabase<BoardConfig> | null = null;

function getBoardConfigPath(): string {
    return path.join(getTodosPath(), "..", "board-configs");
}

function getTodosLegacyDateMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-schedule-deadline-v1.done");
}

function getTodosScheduleFieldRenameMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-schedule-fields-v2.done");
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

async function getTodos(input: { project?: string }) {
    todosLogger.info(`Getting todos${input.project != null ? ` for project: ${input.project || 'No Project'}` : ''}`);

    try {
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

        // Sort todos by order (nulls last)
        activeTodos.sort((a, b) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        });

        todosLogger.info(`Retrieved ${activeTodos.length} todos`);
        return activeTodos;
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

        todosLogger.info(`Retrieved todo: ${input.todoId}`);
        return todo;
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

        // Get existing todos to determine next order
        const existingTodos = await getDb().findAll();
        const status = input.status || "todo";

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
        };

        const created = await getDb().create(newTodo);

        todosLogger.info(`Created todo: ${created.id} with order ${created.order}`);
        return created;
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

        let updates = {
            ...input.updates,
            updatedAt: new Date().toISOString(),
        } as Partial<Todo>;

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

        const updated = await getDb().update(input.todoId, updates as Partial<Todo>);

        if (!updated) {
            todosLogger.warn(`Todo not found for update after write: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Updated todo: ${input.todoId}`);
        return updated;
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

async function getProjects() {
    todosLogger.info(`Getting unique projects`);

    try {
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

    try {
        const updated = await getDb().update(input.todoId, {
            archived: true,
            updatedAt: new Date().toISOString(),
        });

        if (!updated) {
            todosLogger.warn(`Todo not found for archiving: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Archived todo: ${input.todoId}`);
        return updated;
    } catch (error) {
        todosLogger.error(`Failed to archive todo ${input.todoId}`, { error });
        throw error;
    }
}

async function unarchiveTodo(input: { todoId: string }) {
    todosLogger.info(`Unarchiving todo: ${input.todoId}`);

    try {
        const updated = await getDb().update(input.todoId, {
            archived: false,
            updatedAt: new Date().toISOString(),
        });

        if (!updated) {
            todosLogger.warn(`Todo not found for unarchiving: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        todosLogger.info(`Unarchived todo: ${input.todoId}`);
        return updated;
    } catch (error) {
        todosLogger.error(`Failed to unarchive todo ${input.todoId}`, { error });
        throw error;
    }
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

        todosLogger.info(`Retrieved ${archivedTodos.length} archived todos`);
        console.log("Final archived todos:", archivedTodos);
        return archivedTodos;
    } catch (error) {
        todosLogger.error(`Failed to get archived todos`, { error });
        throw error;
    }
}

async function getTags() {
    todosLogger.info(`Getting unique tags`);

    try {
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
    getBoardConfig, saveBoardConfig, deleteColumn
};
