import { TypedPluginWithFunctions } from "@/types/Plugin";
import { functionStubs, GetTodosInputSchema, TodosPluginBase } from "./index";
import { FunctionsFromStubs } from "@/types/Functions";
import { createServiceLogger } from "@/lib/logger";
import type { Todo, TodoKind, TodoSource, Recurrence } from "./todo-types";
import { FileDatabase } from "@/storage/FileDatabase";
import path from "path";
import { getNomendexPath, getTodosPath, hasActiveWorkspace } from "@/storage/root-path";
import type { Attachment } from "@/types/attachments";
import { BoardConfig } from "./board-types";
import { mkdir } from "node:fs/promises";
import { ensureTimeblockingConfig } from "@/features/timeblocking/config";
import { broadcastTodoEvent } from "@/services/todo-events";
import { sanitizeTodoForClient, sanitizeTodoListForClient } from "./todo-sanitize";
import { getTodoKind, getTodoSource, isTimeblockTodo } from "./todo-kind-utils";
import {
    appendTodoToLayout,
    applyTodoReorders,
    getTodoLayoutColumnKey,
    loadTodoLayout,
    moveTodoInLayout,
    removeTodoFromLayout,
    saveTodoLayout,
    sortTodosByLayout,
    type TodoLayoutState,
} from "./todo-layout";
import {
    canonicalizeProjectFilter,
    canonicalizeTodoProject,
    INBOX_PROJECT_NAME,
} from "@/features/projects/inbox-project";

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

function getTodosKindSourceMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-kind-source-v4.done");
}

function getTodosLegacyTimeblockBackfillMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-timeblock-backfill-v5.done");
}

function getTodosInboxCanonicalMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-inbox-canonical-v6.done");
}

function getTodosOrderLayoutMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-order-layout-v7.done");
}

function getTodosSubtaskNormalizationMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "todos-subtask-normalization-v8.done");
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
    // One-off migration: introduce explicit kind/source semantics for todos.
    await runTodosKindSourceMigrationIfNeeded();
    // One-off migration: backfill legacy `timeblock` tags into canonical generated-event semantics.
    await runTodosLegacyTimeblockBackfillMigrationIfNeeded();
    // One-off migration: canonicalize todo.project to reserved "Inbox".
    await runTodosInboxCanonicalMigrationIfNeeded();
    // One-off migration: move legacy todo.order into standalone layout storage.
    await runTodosOrderLayoutMigrationIfNeeded();
    // One-off migration: normalize parentTodoId references (remove dangling/invalid ones).
    await runTodosSubtaskNormalizationMigrationIfNeeded();
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

function logNonCanonicalProjectValues(todos: readonly Todo[], context: string): void {
    const allNonCanonical = todos
        .filter((todo) => canonicalizeTodoProject(todo.project) !== todo.project)
        .map((todo) => ({
            todoId: todo.id,
            project: todo.project ?? null,
            canonicalProject: canonicalizeTodoProject(todo.project),
        }));

    if (allNonCanonical.length === 0) {
        return;
    }

    const sample = allNonCanonical.slice(0, 20);

    todosLogger.warn("Detected non-canonical todo project values in storage", {
        context,
        count: allNonCanonical.length,
        sample,
    });
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

function computeNextOccurrenceDate(anchor: string, recurrence: Recurrence, originDay?: number): string {
    const hasTime = anchor.includes("T");
    const datePart = anchor.split("T")[0];
    const timePart = hasTime ? anchor.split("T")[1] : undefined;
    const [year, month, day] = datePart.split("-").map(Number);
    const base = new Date(year, month - 1, day, 0, 0, 0, 0);
    const n = recurrence.interval;
    if (recurrence.frequency === "daily") {
        base.setDate(base.getDate() + n);
    } else if (recurrence.frequency === "weekly") {
        base.setDate(base.getDate() + n * 7);
    } else {
        // Monthly: clamp against the canonical origin day (not the possibly-drifted
        // anchor day), so e.g. Jan 31 -> Feb 28 -> Mar 31 instead of permanently 28.
        const canonicalDay = originDay ?? day;
        const targetMonth = base.getMonth() + n;
        const targetYear = base.getFullYear() + Math.floor(targetMonth / 12);
        const normalizedMonth = ((targetMonth % 12) + 12) % 12;
        const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
        base.setFullYear(targetYear, normalizedMonth, Math.min(canonicalDay, lastDay));
    }
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, "0");
    const d = String(base.getDate()).padStart(2, "0");
    return timePart ? `${y}-${m}-${d}T${timePart}` : `${y}-${m}-${d}`;
}

// Advance anchor by `recurrence` repeatedly until the resulting local-date is
// strictly after `now`. Prevents overdue recurring tasks from spawning
// still-overdue instances. Bounded loop for safety.
function advanceAnchorPastNow(anchor: string, recurrence: Recurrence, now: Date = new Date()): string {
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const originDay = recurrence.originDay ?? Number(anchor.split("T")[0].split("-")[2]);
    let cursor = computeNextOccurrenceDate(anchor, recurrence, originDay);
    for (let i = 0; i < 1000; i++) {
        const datePart = cursor.split("T")[0];
        const [y, m, d] = datePart.split("-").map(Number);
        const cursorMidnight = new Date(y, m - 1, d).getTime();
        if (cursorMidnight > nowMidnight) return cursor;
        cursor = computeNextOccurrenceDate(cursor, recurrence, originDay);
    }
    return cursor;
}

async function spawnRecurringInstance(completedTodo: Todo): Promise<Todo | undefined> {
    if (!completedTodo.recurrence) return undefined;
    // Subtasks should never spawn top-level recurring instances.
    if (completedTodo.parentTodoId) return undefined;
    // Determine anchor date: dueDate > scheduledStart > today
    const todayStr = formatDateValue(new Date());
    const anchor = completedTodo.dueDate ?? completedTodo.scheduledStart ?? todayStr;
    // Stamp originDay on monthly recurrences the first time we spawn, so the
    // canonical origin survives subsequent completions (Jan 31 -> Feb 28 -> Mar 31).
    const recurrence: Recurrence = completedTodo.recurrence.frequency === "monthly" && completedTodo.recurrence.originDay == null
        ? { ...completedTodo.recurrence, originDay: Number(anchor.split("T")[0].split("-")[2]) }
        : completedTodo.recurrence;
    // Advance past today so overdue completions don't spawn still-overdue instances.
    const nextAnchor = advanceAnchorPastNow(anchor, recurrence);

    let nextScheduledStart: string | null = null;
    let nextScheduledEnd: string | null = null;
    let nextDueDate: string | null = null;

    if (completedTodo.scheduledStart && !completedTodo.dueDate) {
        nextScheduledStart = nextAnchor;
        if (completedTodo.scheduledEnd) {
            const startD = parseLocalScheduleDate(completedTodo.scheduledStart);
            const endD   = parseLocalScheduleDate(completedTodo.scheduledEnd);
            if (startD && endD) {
                const nextStartD = parseLocalScheduleDate(nextAnchor);
                if (nextStartD) {
                    const offsetMs = endD.getTime() - startD.getTime();
                    nextScheduledEnd = formatDateValue(new Date(nextStartD.getTime() + offsetMs));
                }
            }
        }
    } else if (completedTodo.dueDate) {
        nextDueDate = nextAnchor;
        nextScheduledStart = completedTodo.scheduledStart ?? null;
        nextScheduledEnd   = completedTodo.scheduledEnd   ?? null;
    } else {
        nextDueDate = nextAnchor;
    }

    const spawned = await createTodo({
        title:                  completedTodo.title,
        description:            completedTodo.description,
        project:                completedTodo.project,
        kind:                   completedTodo.kind,
        source:                 completedTodo.source,
        tags:                   completedTodo.tags,
        scheduledStart:         nextScheduledStart,
        scheduledEnd:           nextScheduledEnd,
        dueDate:                nextDueDate,
        priority:               completedTodo.priority,
        duration:               completedTodo.duration,
        attachments:            completedTodo.attachments,
        calendarReminderPreset: completedTodo.calendarReminderPreset,
        goalRefs:               completedTodo.goalRefs,
        recurrence,
    });

    todosLogger.info(`Spawned recurring instance: ${spawned.id} from ${completedTodo.id}`);
    return spawned;
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

function normalizeKindField(value: unknown): TodoKind | undefined {
    return value === "task" || value === "event"
        ? value
        : undefined;
}

function normalizeSourceField(value: unknown): TodoSource | undefined {
    return value === "user" || value === "timeblock-generator"
        ? value
        : undefined;
}

// getTodoKind, getTodoSource, isEventTodo, isTimeblockTodo — imported from ./todo-kind-utils

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

/** Legacy tag check — used only by migration code. Prefer isTimeblockTodo from todo-kind-utils. */
function hasTimeblockTag(tags?: string[]): boolean {
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

export function collectRequestedKinds(input: {
    kind?: TodoKind;
    kinds?: TodoKind[];
}): Set<TodoKind> {
    const requestedKinds = new Set<TodoKind>();
    if (input.kind) {
        requestedKinds.add(input.kind);
    }
    if (input.kinds) {
        for (const kind of input.kinds) {
            requestedKinds.add(kind);
        }
    }
    return requestedKinds;
}

export function collectRequestedSources(input: {
    source?: TodoSource;
    sources?: TodoSource[];
}): Set<TodoSource> {
    const requestedSources = new Set<TodoSource>();
    if (input.source) {
        requestedSources.add(input.source);
    }
    if (input.sources) {
        for (const source of input.sources) {
            requestedSources.add(source);
        }
    }
    return requestedSources;
}

export function shouldRejectEventLifecycleChange(input: {
    currentKind?: TodoKind;
    nextKind?: TodoKind;
    currentStatus?: Todo["status"];
    nextStatus?: Todo["status"];
    completedAtProvided: boolean;
    kindChanged: boolean;
    statusChanged: boolean;
}): boolean {
    const effectiveKind = input.nextKind ?? input.currentKind ?? "task";
    if (effectiveKind !== "event") {
        return false;
    }

    if (input.completedAtProvided) {
        return true;
    }

    if (input.statusChanged) {
        return (input.nextStatus ?? "todo") !== "todo";
    }

    if (input.kindChanged) {
        return (input.nextStatus ?? input.currentStatus ?? "todo") !== "todo";
    }

    return false;
}

export function getExpiredTimeblockIds(
    todos: readonly Pick<Todo, "id" | "archived" | "kind" | "source" | "tags" | "scheduledStart" | "scheduledEnd">[],
    now: Date,
): string[] {
    const todayStart = startOfLocalDay(now).getTime();
    return todos
        .filter((todo) => !todo.archived && isTimeblockTodo(todo))
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

function inferMigratedKindSource(rawTodo: Record<string, unknown>): {
    kind: TodoKind;
    source: TodoSource;
} {
    const normalizedKind = normalizeKindField(rawTodo.kind);
    const normalizedSource = normalizeSourceField(rawTodo.source);

    if (normalizedKind && normalizedSource) {
        return {
            kind: normalizedKind,
            source: normalizedSource,
        };
    }

    if (hasTimeblockTag(Array.isArray(rawTodo.tags) ? rawTodo.tags.filter((tag): tag is string => typeof tag === "string") : undefined)) {
        return {
            kind: "event",
            // Keep the source conservative for legacy items. Timeblocking phase can
            // set explicit generator provenance for newly generated events.
            source: normalizedSource ?? "user",
        };
    }

    return {
        kind: normalizedKind ?? "task",
        source: normalizedSource ?? "user",
    };
}

export function getLegacyTimeblockBackfillUpdates(rawTodo: Record<string, unknown>): Partial<Todo> | null {
    const tags = Array.isArray(rawTodo.tags)
        ? rawTodo.tags.filter((tag): tag is string => typeof tag === "string")
        : undefined;

    if (!hasTimeblockTag(tags)) {
        return null;
    }

    const updates: Partial<Todo> = {};

    if (normalizeKindField(rawTodo.kind) !== "event") {
        updates.kind = "event";
    }

    if (normalizeSourceField(rawTodo.source) !== "timeblock-generator") {
        updates.source = "timeblock-generator";
    }

    if (rawTodo.status !== "todo") {
        updates.status = "todo";
    }

    if (hasOwnKey(rawTodo, "completedAt") && rawTodo.completedAt != null) {
        updates.completedAt = undefined;
    }

    return Object.keys(updates).length > 0 ? updates : null;
}

async function runTodosKindSourceMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosKindSourceMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);

    if (await markerFile.exists()) {
        todosLogger.info("Todos kind/source migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    let migratedCount = 0;

    for (const todo of todos) {
        const rawTodo = todo as unknown as Record<string, unknown>;
        const hasKind = hasOwnKey(rawTodo, "kind");
        const hasSource = hasOwnKey(rawTodo, "source");
        const normalizedKind = normalizeKindField(rawTodo.kind);
        const normalizedSource = normalizeSourceField(rawTodo.source);

        if (hasKind && hasSource && normalizedKind && normalizedSource) {
            continue;
        }

        const inferred = inferMigratedKindSource(rawTodo);
        await getDb().update(todo.id, {
            kind: inferred.kind,
            source: inferred.source,
            updatedAt: new Date().toISOString(),
        });
        migratedCount += 1;
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        migratedCount,
    }, null, 2));

    todosLogger.info(`Todos kind/source migration complete (${migratedCount} records migrated)`);
}

async function runTodosLegacyTimeblockBackfillMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosLegacyTimeblockBackfillMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);

    if (await markerFile.exists()) {
        todosLogger.info("Todos legacy timeblock backfill migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    let migratedCount = 0;

    for (const todo of todos) {
        const rawTodo = todo as unknown as Record<string, unknown>;
        const updates = getLegacyTimeblockBackfillUpdates(rawTodo);
        if (!updates) {
            continue;
        }

        await getDb().update(todo.id, {
            ...updates,
            updatedAt: new Date().toISOString(),
        });
        migratedCount += 1;
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        migratedCount,
    }, null, 2));

    todosLogger.info(`Todos legacy timeblock backfill migration complete (${migratedCount} records migrated)`);
}

async function runTodosInboxCanonicalMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosInboxCanonicalMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);

    if (await markerFile.exists()) {
        todosLogger.info("Todos Inbox canonical migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    const migrations = todos
        .map((todo) => {
            const canonicalProject = canonicalizeTodoProject(todo.project);
            if (todo.project === canonicalProject) {
                return null;
            }
            return {
                todoId: todo.id,
                originalTodo: todo,
                canonicalProject,
            };
        })
        .filter((migration): migration is { todoId: string; originalTodo: Todo; canonicalProject: string } => migration !== null);

    let backupPath: string | null = null;

    if (migrations.length > 0) {
        const backupDir = path.join(getNomendexPath(), "backups");
        await mkdir(backupDir, { recursive: true });
        backupPath = path.join(backupDir, `todos-inbox-canonical-v6-${Date.now()}.json`);

        await Bun.write(
            backupPath,
            JSON.stringify({
                createdAt: new Date().toISOString(),
                migration: "todos-inbox-canonical-v6",
                todos: migrations.map((migration) => ({
                    todoId: migration.todoId,
                    canonicalProject: migration.canonicalProject,
                    originalTodo: migration.originalTodo,
                })),
            }, null, 2),
        );

        for (const migration of migrations) {
            await getDb().update(migration.todoId, {
                project: migration.canonicalProject,
            });
        }
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        migratedCount: migrations.length,
        backupPath,
    }, null, 2));

    todosLogger.info(`Todos Inbox canonical migration complete (${migrations.length} records migrated)`);
}

function getLegacyTodoOrder(todo: Todo): number | undefined {
    const raw = todo as unknown as Record<string, unknown>;
    const maybeOrder = raw.order;
    return typeof maybeOrder === "number" && Number.isFinite(maybeOrder)
        ? maybeOrder
        : undefined;
}

function compareTodosForLegacyLayout(left: Todo, right: Todo): number {
    const leftOrder = getLegacyTodoOrder(left);
    const rightOrder = getLegacyTodoOrder(right);
    const leftRank = leftOrder ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rightOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
        return leftRank - rightRank;
    }
    const leftCreated = Date.parse(left.createdAt);
    const rightCreated = Date.parse(right.createdAt);
    if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
        return leftCreated - rightCreated;
    }
    return left.id.localeCompare(right.id);
}

function buildTodoLayoutFromLegacyOrder(todos: readonly Todo[]): TodoLayoutState {
    const columns = new Map<string, Todo[]>();
    for (const todo of todos) {
        const key = getTodoLayoutColumnKey(todo);
        const bucket = columns.get(key) ?? [];
        bucket.push(todo);
        columns.set(key, bucket);
    }

    const serialized: Record<string, string[]> = {};
    for (const [columnKey, columnTodos] of columns.entries()) {
        serialized[columnKey] = [...columnTodos]
            .sort(compareTodosForLegacyLayout)
            .map((todo) => todo.id);
    }

    return {
        version: 1,
        columns: serialized,
    };
}

async function runTodosOrderLayoutMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosOrderLayoutMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);
    if (await markerFile.exists()) {
        todosLogger.info("Todos order->layout migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    const migratedTodos = todos.filter((todo) => getLegacyTodoOrder(todo) !== undefined);

    const layout = buildTodoLayoutFromLegacyOrder(todos);
    await saveTodoLayout(layout);

    for (const todo of migratedTodos) {
        await getDb().update(todo.id, { order: undefined } as Partial<Todo>);
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        migratedCount: migratedTodos.length,
        layoutColumns: Object.keys(layout.columns).length,
    }, null, 2));

    todosLogger.info(`Todos order->layout migration complete (${migratedTodos.length} records migrated)`);
}

/**
 * Migration v8: normalize subtask references.
 * - Remove parentTodoId on todos that reference a non-existent parent.
 * - Remove parentTodoId on todos whose parent is itself a subtask (depth > 1).
 * - Synchronize project on subtasks to match their parent's project.
 */
async function runTodosSubtaskNormalizationMigrationIfNeeded(): Promise<void> {
    const markerPath = getTodosSubtaskNormalizationMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);
    if (await markerFile.exists()) {
        todosLogger.info("Todos subtask normalization migration already applied, skipping");
        return;
    }

    const todos = await getDb().findAll();
    const todoIdSet = new Set(todos.map((t) => t.id));
    let removedCount = 0;
    let syncedCount = 0;

    for (const todo of todos) {
        const maybeParentId = todo.parentTodoId || undefined;

        if (!maybeParentId) {
            continue;
        }

        const updates: Partial<Todo> & Record<string, unknown> = {};

        if (maybeParentId) {
            const parent = todos.find((t) => t.id === maybeParentId);
            const parentHasParent = parent && parent.parentTodoId;

            if (!todoIdSet.has(maybeParentId) || parentHasParent) {
                // Dangling reference or depth > 1 — detach
                updates.parentTodoId = undefined;
                removedCount += 1;
            } else if (parent && canonicalizeTodoProject(parent.project) !== canonicalizeTodoProject(todo.project)) {
                // Project out of sync — fix
                updates.project = canonicalizeTodoProject(parent.project);
                syncedCount += 1;
            }
        }

        if (Object.keys(updates).length > 0) {
            updates.updatedAt = new Date().toISOString();
            await getDb().update(todo.id, updates as Partial<Todo>);
        }
    }

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        removedInvalidParentRefs: removedCount,
        syncedProjectCount: syncedCount,
    }, null, 2));

    todosLogger.info(`Todos subtask normalization migration complete (removed=${removedCount}, synced=${syncedCount})`);
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
    const normalizedProjectName = canonicalizeProjectFilter(projectName);
    if (!normalizedProjectName) return undefined;
    try {
        const { getProjectByName } = await import("@/features/projects/fx");
        const project = await getProjectByName({ name: normalizedProjectName });
        return project?.goalRef ?? undefined;
    } catch {
        return undefined;
    }
}

async function getTodos(rawInput: unknown) {
    const input = GetTodosInputSchema.parse(rawInput ?? {});
    const projectFilter = canonicalizeProjectFilter(input.project);
    todosLogger.info(`Getting todos${projectFilter ? ` for project: ${projectFilter}` : ""}`);

    try {
        await runTimeblockHousekeepingIfNeeded();

        const todos = await getDb().findAll();

        let activeTodos = todos.filter(t => !t.archived);
        logNonCanonicalProjectValues(activeTodos, "getTodos");

        // By default, exclude subtasks (todos with parentTodoId) from results.
        // Callers can opt in with includeSubtasks:true, subtasksOnly:true, or fetch a specific parent's subtasks with parentTodoId.
        if (input.parentTodoId) {
            activeTodos = activeTodos.filter((todo) => todo.parentTodoId === input.parentTodoId);
        } else if (input.subtasksOnly) {
            activeTodos = activeTodos.filter((todo) => Boolean(todo.parentTodoId));
        } else if (!input.includeSubtasks) {
            activeTodos = activeTodos.filter((todo) => !todo.parentTodoId);
        }

        // Filter by project if specified (legacy aliases map to canonical Inbox)
        if (projectFilter) {
            activeTodos = activeTodos.filter((todo) => canonicalizeTodoProject(todo.project) === projectFilter);
        }

        if (input.tagsAll && input.tagsAll.length > 0) {
            activeTodos = activeTodos.filter((todo) => input.tagsAll!.every((tag) => todo.tags?.includes(tag)));
        }

        if (input.scheduledOverlap) {
            activeTodos = activeTodos.filter((todo) => matchesScheduledOverlap(todo, input.scheduledOverlap!));
        }

        const requestedKinds = collectRequestedKinds(input);
        if (requestedKinds.size > 0) {
            activeTodos = activeTodos.filter((todo) => requestedKinds.has(getTodoKind(todo)));
        }

        const requestedSources = collectRequestedSources(input);
        if (requestedSources.size > 0) {
            activeTodos = activeTodos.filter((todo) => requestedSources.has(getTodoSource(todo)));
        }

        const requestedStatuses = collectRequestedStatuses(input);
        if (requestedStatuses.size > 0) {
            activeTodos = activeTodos.filter((todo) => requestedStatuses.has(todo.status));
        }

        const layout = await loadTodoLayout();
        activeTodos = sortTodosByLayout(activeTodos, layout);

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
        logNonCanonicalProjectValues([todo], "getTodoById");

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
    kind?: TodoKind;
    source?: TodoSource;
    status?: "todo" | "planned" | "in_progress" | "done" | "later";
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
    parentTodoId?: string;
    recurrence?: Recurrence;
}) {
    todosLogger.info(`Creating new todo: ${input.title}`);

    try {
        // ── Subtask validation ──────────────────────────────────────────────
        let resolvedParentTodoId: string | undefined;
        let inheritedProject: string | undefined;

        if (input.parentTodoId) {
            const parent = await getDb().findById(input.parentTodoId);
            if (!parent) {
                throw new Error(`Parent todo '${input.parentTodoId}' does not exist.`);
            }
            if (parent.parentTodoId) {
                throw new Error("Cannot create a subtask of a subtask. Maximum hierarchy depth is 1.");
            }
            resolvedParentTodoId = input.parentTodoId;
            inheritedProject = canonicalizeTodoProject(parent.project);
        }

        // Project for subtasks is always inherited from parent; ignore any provided value
        const canonicalProject = resolvedParentTodoId
            ? inheritedProject!
            : canonicalizeTodoProject(input.project);

        // Validate that the project exists BEFORE creating the todo.
        // Inbox is a reserved system project and is always allowed.
        if (!resolvedParentTodoId && canonicalProject !== INBOX_PROJECT_NAME) {
            const { getProjectByName } = await import("@/features/projects/fx");
            const project = await getProjectByName({ name: canonicalProject });
            if (!project) {
                throw new Error(`Project '${canonicalProject}' does not exist. Please ask the user to create it manually: Open the 'Projects' view from the sidebar and click 'New Project'.`);
            }
        }

        const kind = normalizeKindField(input.kind) ?? "task";
        const source = normalizeSourceField(input.source) ?? "user";
        let requestedStatus = input.status || "todo";

        // Subtasks only support todo/done — restrict other statuses
        if (resolvedParentTodoId && requestedStatus !== "todo" && requestedStatus !== "done") {
            requestedStatus = "todo";
        }

        if (shouldRejectEventLifecycleChange({
            nextKind: kind,
            nextStatus: requestedStatus,
            completedAtProvided: false,
            kindChanged: true,
            statusChanged: input.status !== undefined,
        })) {
            throw new Error("Events can only be active or archived. Create them with status 'todo'.");
        }

        const status = requestedStatus;

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
        const projectGoalRef = await getProjectGoalRef(canonicalProject);
        const resolvedGoalRefs = computeResolvedGoalRefs(input.goalRefs, projectGoalRef);

        const now = new Date().toISOString();
        const newTodo: Todo = {
            id: `todo-${slug}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            title: input.title,
            description: input.description,
            kind,
            source,
            status: status,
            createdAt: now,
            updatedAt: now,
            archived: false,
            project: canonicalProject,
            tags: input.tags,
            scheduledStart,
            scheduledEnd,
            dueDate: deadlineDueDate,
            priority: input.priority,
            completedAt: kind === "task" && status === "done" ? now : undefined,
            duration,
            attachments: input.attachments,
            customColumnId: input.customColumnId,
            calendarReminderPreset: input.calendarReminderPreset,
            goalRefs: input.goalRefs,
            resolvedGoalRefs: resolvedGoalRefs.length > 0 ? resolvedGoalRefs : undefined,
            parentTodoId: resolvedParentTodoId,
            // Recurrence is top-level-only; silently drop when creating a subtask.
            recurrence: resolvedParentTodoId ? undefined : input.recurrence,
        };

        const created = await getDb().create(newTodo);
        const allTodos = await getDb().findAll();
        await appendTodoToLayout(created, new Set(allTodos.map((todo) => todo.id)));

        const sanitized = sanitizeTodoForClient(created);
        todosLogger.info(`Created todo: ${sanitized.id}`);
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
        kind?: TodoKind;
        source?: TodoSource;
        status?: "todo" | "planned" | "in_progress" | "done" | "later";
        project?: string;
        archived?: boolean;
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
        parentTodoId?: string | null;
        recurrence?: Recurrence | null;
    };
}) {
    todosLogger.info(`Updating todo: ${input.todoId}`);

    try {
        const projectUpdateProvided = hasOwnKey(input.updates, "project");
        const canonicalProjectUpdate = projectUpdateProvided
            ? canonicalizeTodoProject(input.updates.project)
            : undefined;

        // Validate that the project exists if it's being updated.
        // Inbox is a reserved system project and is always allowed.
        if (projectUpdateProvided && canonicalProjectUpdate && canonicalProjectUpdate !== INBOX_PROJECT_NAME) {
            const { getProjectByName } = await import("@/features/projects/fx");
            const project = await getProjectByName({ name: canonicalProjectUpdate });
            if (!project) {
                throw new Error(`Project '${canonicalProjectUpdate}' does not exist. Please ask the user to create it manually: Open the 'Projects' view from the sidebar and click 'New Project'.`);
            }
        }

        const currentTodo = await getDb().findById(input.todoId);
        if (!currentTodo) {
            todosLogger.warn(`Todo not found for update: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        const isSubtask = Boolean(currentTodo.parentTodoId);

        // ── Subtask-specific guards ─────────────────────────────────────────
        if (isSubtask && projectUpdateProvided) {
            throw new Error("Cannot change the project of a subtask directly. Change the parent todo's project instead.");
        }

        const wantsParentUpdate = hasOwnKey(input.updates, "parentTodoId");
        if (wantsParentUpdate) {
            const newParentId = input.updates.parentTodoId ?? undefined;
            if (newParentId) {
                if (newParentId === input.todoId) {
                    throw new Error("A todo cannot be its own parent.");
                }
                const newParent = await getDb().findById(newParentId);
                if (!newParent) {
                    throw new Error(`Parent todo '${newParentId}' does not exist.`);
                }
                if (newParent.parentTodoId) {
                    throw new Error("Cannot attach to a subtask as parent. Maximum hierarchy depth is 1.");
                }
            }
        }

        // Subtask status restricted to todo/done
        const wantsStatusUpdateForSubtask = hasOwnKey(input.updates, "status") && input.updates.status !== undefined;
        const nextParentId = wantsParentUpdate ? (input.updates.parentTodoId ?? undefined) : currentTodo.parentTodoId;
        const willBeSubtask = Boolean(nextParentId);
        if (willBeSubtask && wantsStatusUpdateForSubtask) {
            const requestedStatus = input.updates.status!;
            if (requestedStatus !== "todo" && requestedStatus !== "done") {
                throw new Error(`Subtasks only support status 'todo' or 'done'. Got '${requestedStatus}'.`);
            }
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

        // Handle parentTodoId update
        if (wantsParentUpdate) {
            const newParentId = input.updates.parentTodoId ?? undefined;
            updates.parentTodoId = newParentId;
            // Inherit project from new parent if attaching
            if (newParentId) {
                const newParent = await getDb().findById(newParentId);
                if (newParent) {
                    updates.project = canonicalizeTodoProject(newParent.project);
                }
            }
        }

        // Project resolution:
        // - Top-level + project provided → use canonicalProjectUpdate
        // - Top-level + no project → canonicalize current (invariant fix)
        // - Attaching to parent → project already set from parent above
        // - Subtask staying as subtask → don't touch project (inherited from parent)
        if (wantsParentUpdate && nextParentId) {
            // Project already set from parent in the parentTodoId handling block above
        } else if (!isSubtask && projectUpdateProvided) {
            updates.project = canonicalProjectUpdate;
        } else if (!isSubtask && !projectUpdateProvided) {
            delete updates.project;
            const invariantProject = canonicalizeTodoProject(currentTodo.project);
            if (currentTodo.project !== invariantProject) {
                updates.project = invariantProject;
            }
        } else {
            // Subtask, no parent change, no project change — don't update project field
            delete updates.project;
        }

        const wantsKindUpdate = hasOwnKey(input.updates, "kind") && input.updates.kind !== undefined;
        const wantsSourceUpdate = hasOwnKey(input.updates, "source") && input.updates.source !== undefined;
        const wantsStatusUpdate = hasOwnKey(input.updates, "status") && input.updates.status !== undefined;
        const completedAtProvided = hasOwnKey(input.updates, "completedAt") && input.updates.completedAt !== undefined;

        if (!wantsKindUpdate) {
            delete updates.kind;
        }
        if (!wantsSourceUpdate) {
            delete updates.source;
        }
        if (!wantsStatusUpdate) {
            delete updates.status;
        }
        if (!completedAtProvided) {
            delete updates.completedAt;
        }

        if (wantsKindUpdate) {
            updates.kind = normalizeKindField(input.updates.kind);
        }

        if (wantsSourceUpdate) {
            updates.source = normalizeSourceField(input.updates.source);
        }

        const currentKind = getTodoKind(currentTodo);
        const nextKind = wantsKindUpdate
            ? (updates.kind ?? "task")
            : currentKind;
        if (shouldRejectEventLifecycleChange({
            currentKind,
            nextKind,
            currentStatus: currentTodo.status,
            nextStatus: input.updates.status,
            completedAtProvided,
            kindChanged: wantsKindUpdate,
            statusChanged: wantsStatusUpdate,
        })) {
            throw new Error("Events can only be active or archived. Use status 'todo' for active events.");
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

        if (hasOwnKey(input.updates, "recurrence")) {
            const r = input.updates.recurrence;
            // Subtasks cannot have recurrence (top-level-only feature).
            if (currentTodo.parentTodoId) {
                updates.recurrence = undefined;
            } else {
                updates.recurrence = r === null ? undefined : (r ?? undefined);
            }
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

        // Auto-set completedAt when status changes to/from done
        if (wantsStatusUpdate && currentTodo.status !== input.updates.status) {
            if (nextKind === "task" && input.updates.status === "done") {
                updates.completedAt = new Date().toISOString();
            } else if (currentTodo.status === "done") {
                updates.completedAt = undefined;
            }
        }

        // Capture before DB write: does this completion need a recurring spawn?
        const isSpawningOccurrence =
            wantsStatusUpdate &&
            nextKind === "task" &&
            input.updates.status === "done" &&
            currentTodo.status !== "done" &&
            Boolean(currentTodo.recurrence);

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
            const effectiveProject = updates.project ?? currentTodo.project;
            const projectGoalRef = await getProjectGoalRef(effectiveProject);
            const resolved = computeResolvedGoalRefs(effectiveGoalRefs, projectGoalRef);
            updates.resolvedGoalRefs = resolved.length > 0 ? resolved : undefined;
        } else if (!isClosed) {
            // Open todo: recompute resolvedGoalRefs
            const effectiveGoalRefs = input.updates.goalRefs ?? currentTodo.goalRefs;
            const effectiveProject = updates.project ?? currentTodo.project;
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

        const previousColumnKey = getTodoLayoutColumnKey(currentTodo);
        const nextColumnKey = getTodoLayoutColumnKey(updated);
        const columnChanged = previousColumnKey !== nextColumnKey;
        const projectChanged = !isSubtask && updates.project !== undefined && updates.project !== canonicalizeTodoProject(currentTodo.project);

        // Single findAll for both layout move and child propagation
        const allTodos = (columnChanged || projectChanged) ? await getDb().findAll() : undefined;

        if (columnChanged && allTodos) {
            await moveTodoInLayout(updated.id, updated, new Set(allTodos.map((todo) => todo.id)));
        }

        // Propagate project change to children when a top-level todo's project changes
        if (projectChanged && allTodos) {
            const newProject = canonicalizeTodoProject(updated.project);
            const children = allTodos.filter((t) => t.parentTodoId === input.todoId);
            const childUpdateTime = new Date().toISOString();
            for (const child of children) {
                const updatedChild = await getDb().update(child.id, {
                    project: newProject,
                    updatedAt: childUpdateTime,
                } as Partial<Todo>);
                if (updatedChild) {
                    broadcastTodoEvent({ type: "upsert", todo: sanitizeTodoForClient(updatedChild) });
                }
            }
        }

        const sanitized = sanitizeTodoForClient(updated);
        todosLogger.info(`Updated todo: ${input.todoId}`);

        // Spawn next occurrence if this was a recurring task completion
        if (isSpawningOccurrence) {
            try {
                const spawned = await spawnRecurringInstance(updated);
                if (spawned) broadcastTodoEvent({ type: "upsert", todo: spawned });
            } catch (spawnErr) {
                todosLogger.warn(`Failed to spawn recurring instance for ${input.todoId}`, { error: spawnErr });
                // Non-fatal: completion is recorded even if spawn fails
            }
        }

        return sanitized;
    } catch (error) {
        todosLogger.error(`Failed to update todo ${input.todoId}`, { error });
        throw error;
    }
}

async function deleteTodo(input: { todoId: string }) {
    todosLogger.info(`Deleting todo: ${input.todoId}`);

    try {
        // Cascade delete children (subtasks) first
        const allBeforeDelete = await getDb().findAll();
        const children = allBeforeDelete.filter((t) => t.parentTodoId === input.todoId);
        for (const child of children) {
            await getDb().delete(child.id);
            todosLogger.info(`Cascade-deleted subtask: ${child.id}`);
        }

        const deleted = await getDb().delete(input.todoId);

        if (!deleted) {
            todosLogger.warn(`Todo not found for deletion: ${input.todoId}`);
            throw new Error(`Todo with ID ${input.todoId} not found`);
        }

        const allTodos = await getDb().findAll();
        const allRemainingIds = new Set(allTodos.map((todo) => todo.id));
        for (const child of children) {
            await removeTodoFromLayout(child.id, allRemainingIds);
        }
        await removeTodoFromLayout(input.todoId, allRemainingIds);

        todosLogger.info(`Deleted todo: ${input.todoId} (and ${children.length} subtask(s))`);
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

export async function skipRecurrenceOccurrence(input: { todoId: string }): Promise<Todo> {
    todosLogger.info(`Skipping recurrence occurrence for todo: ${input.todoId}`);

    try {
        const current = await getDb().findById(input.todoId);
        if (!current) throw new Error(`Todo ${input.todoId} not found`);
        if (!current.recurrence) throw new Error(`Todo ${input.todoId} has no recurrence`);

        const todayStr = formatDateValue(new Date());
        const anchor = current.dueDate ?? current.scheduledStart ?? todayStr;
        const nextAnchor = advanceAnchorPastNow(anchor, current.recurrence);

        const dateUpdates: Partial<Todo> = { updatedAt: new Date().toISOString() };
        if (current.scheduledStart && !current.dueDate) {
            dateUpdates.scheduledStart = nextAnchor;
            if (current.scheduledEnd) {
                const s = parseLocalScheduleDate(current.scheduledStart);
                const e = parseLocalScheduleDate(current.scheduledEnd);
                if (s && e) {
                    const ns = parseLocalScheduleDate(nextAnchor);
                    if (ns) dateUpdates.scheduledEnd = formatDateValue(new Date(ns.getTime() + e.getTime() - s.getTime()));
                }
            }
        } else {
            dateUpdates.dueDate = nextAnchor;
        }

        const updated = await getDb().update(input.todoId, dateUpdates);
        if (!updated) throw new Error(`Failed to update todo ${input.todoId}`);
        const sanitized = sanitizeTodoForClient(updated);
        broadcastTodoEvent({ type: "upsert", todo: sanitized });
        todosLogger.info(`Skipped occurrence for todo: ${input.todoId}, next anchor: ${nextAnchor}`);
        return sanitized;
    } catch (error) {
        todosLogger.error(`Failed to skip recurrence for todo ${input.todoId}`, { error });
        throw error;
    }
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
            projectSet.add(canonicalizeTodoProject(todo.project));
        }

        // Include projects from projects.json so newly created projects
        // are visible in pickers even before any todo is assigned to them.
        try {
            const { listProjects } = await import("@/features/projects/fx");
            const configuredProjects = await listProjects({ includeArchived: false });
            for (const project of configuredProjects) {
                projectSet.add(canonicalizeTodoProject(project.name));
            }
        } catch (error) {
            todosLogger.warn("Failed to load projects from projects service, falling back to todo-derived projects", { error });
        }

        const projects = Array.from(projectSet).sort((left, right) => {
            if (left === INBOX_PROJECT_NAME && right !== INBOX_PROJECT_NAME) return -1;
            if (left !== INBOX_PROJECT_NAME && right === INBOX_PROJECT_NAME) return 1;
            return left.localeCompare(right);
        });
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
        const todos = await getDb().findAll();
        const todoById = new Map(todos.map((todo) => [todo.id, todo]));
        const { changed, movedIds } = await applyTodoReorders(input.reorders, todoById);

        todosLogger.info(`Successfully reordered todos`, { changed, movedIds });
        return { success: true };
    } catch (error) {
        todosLogger.error(`Failed to reorder todos`, { error });
        throw error;
    }
}

async function archiveTodo(input: { todoId: string }) {
    todosLogger.info(`Archiving todo: ${input.todoId}`);
    // Cascade archive to children (subtasks) first
    const allTodos = await getDb().findAll();
    const children = allTodos.filter((t) => t.parentTodoId === input.todoId && !t.archived);
    for (const child of children) {
        await updateTodo({ todoId: child.id, updates: { archived: true } });
    }
    // Route through updateTodo so resolvedGoalRefs freeze/recompute logic stays consistent.
    return updateTodo({ todoId: input.todoId, updates: { archived: true } });
}

async function unarchiveTodo(input: { todoId: string }) {
    todosLogger.info(`Unarchiving todo: ${input.todoId}`);
    // Cascade unarchive to children (subtasks) as well
    const allTodos = await getDb().findAll();
    const children = allTodos.filter((t) => t.parentTodoId === input.todoId && t.archived);
    for (const child of children) {
        await updateTodo({ todoId: child.id, updates: { archived: false } });
    }
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
                projectGoalRefMap.set(canonicalizeTodoProject(p.name).toLowerCase(), p.goalRef);
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
                    ? projectGoalRefMap.get(canonicalizeTodoProject(todo.project).toLowerCase())
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
    const projectFilter = canonicalizeProjectFilter(input.project);
    todosLogger.info(`Getting archived todos${projectFilter ? ` for project: ${projectFilter}` : ""}`);

    try {
        const todos = await getDb().findAll();

        // Exclude subtasks from the archived view — they are shown under their parent
        let archivedTodos = todos.filter((t) => t.archived && !t.parentTodoId);
        logNonCanonicalProjectValues(archivedTodos, "getArchivedTodos");

        // Filter by project if specified (legacy aliases map to canonical Inbox)
        if (projectFilter) {
            archivedTodos = archivedTodos.filter((todo) => canonicalizeTodoProject(todo.project) === projectFilter);
        }

        const layout = await loadTodoLayout();
        archivedTodos = sortTodosByLayout(archivedTodos, layout);

        const sanitized = sanitizeTodoListForClient(archivedTodos);
        todosLogger.info(`Retrieved ${sanitized.length} archived todos`);
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

async function deleteTag({ tagName }: { tagName: string }): Promise<{ deletedFromCount: number }> {
    todosLogger.info(`Deleting tag: ${tagName}`);

    try {
        const todos = await getDb().findAll();
        const tagLower = tagName.toLowerCase();
        const affected = todos.filter(t => t.tags?.some(t2 => t2.toLowerCase() === tagLower));

        for (const todo of affected) {
            const newTags = (todo.tags ?? []).filter(t => t.toLowerCase() !== tagLower);
            const updated = await updateTodo({ todoId: todo.id, updates: { tags: newTags } });
            broadcastTodoEvent({ type: "upsert", todo: updated });
        }

        todosLogger.info(`Deleted tag "${tagName}" from ${affected.length} todos`);
        return { deletedFromCount: affected.length };
    } catch (error) {
        todosLogger.error(`Failed to delete tag`, { error });
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
        const normalizedProjectName = canonicalizeTodoProject(input.projectId);
        const config = await getBoardConfig({ projectId: input.projectId });
        if (!config) throw new Error("Board config not found");

        // Find fallback column
        const sortedColumns = [...config.columns].sort((a, b) => a.order - b.order);
        const fallbackColumn = sortedColumns.find(c => c.id !== input.columnId);
        if (!fallbackColumn) throw new Error("Cannot delete the only column");

        // Migrate todos from deleted column
        const todos = await getDb().findAll();
        const orphanTodos = todos.filter(t => {
            const todoProject = canonicalizeTodoProject(t.project);
            return todoProject === normalizedProjectName && t.customColumnId === input.columnId;
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
    getProjects, reorderTodos, archiveTodo, unarchiveTodo, getArchivedTodos, getTags, deleteTag,
    getBoardConfig, saveBoardConfig, deleteColumn, restoreTodoSnapshot, forceReindexTodos
};
