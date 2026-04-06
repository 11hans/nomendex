import path from "path";
import { mkdir } from "node:fs/promises";
import { getNomendexPath } from "@/storage/root-path";
import { canonicalizeTodoProject } from "@/features/projects/inbox-project";
import type { Todo } from "./todo-types";

export interface TodoLayoutState {
    version: 1;
    columns: Record<string, string[]>;
}

interface TodoLayoutTodoLike {
    id: string;
    status: Todo["status"];
    customColumnId?: string;
    project?: string;
    archived?: boolean;
}

const LAYOUT_VERSION = 1 as const;
const EMPTY_LAYOUT: TodoLayoutState = { version: LAYOUT_VERSION, columns: {} };
let layoutUpdateQueue: Promise<void> = Promise.resolve();

function withLayoutUpdateLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = layoutUpdateQueue.then(fn, fn);
    layoutUpdateQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

function cloneColumns(columns: Record<string, string[]>): Record<string, string[]> {
    return Object.fromEntries(
        Object.entries(columns).map(([key, value]) => [key, [...value]])
    );
}

function dedupeIds(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }
    return result;
}

function parseCreatedAt(value: string): number {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}

function compareFallback(a: TodoLayoutTodoLike & Pick<Todo, "createdAt">, b: TodoLayoutTodoLike & Pick<Todo, "createdAt">): number {
    const createdDiff = parseCreatedAt(a.createdAt) - parseCreatedAt(b.createdAt);
    if (createdDiff !== 0) {
        return createdDiff;
    }
    return a.id.localeCompare(b.id);
}

export function getTodoLayoutColumnKey(todo: Omit<TodoLayoutTodoLike, "id">): string {
    const scope = todo.archived ? "archived" : "active";
    const project = canonicalizeTodoProject(todo.project);
    const columnId = todo.customColumnId ?? todo.status;
    return `${scope}::${project}::${columnId}`;
}

export function normalizeTodoLayout(
    layout: TodoLayoutState,
    validTodoIds?: ReadonlySet<string>,
): TodoLayoutState {
    const columns: Record<string, string[]> = {};
    for (const [columnKey, ids] of Object.entries(layout.columns ?? {})) {
        const deduped = dedupeIds(Array.isArray(ids) ? ids : []);
        const filtered = validTodoIds
            ? deduped.filter((id) => validTodoIds.has(id))
            : deduped;
        if (filtered.length > 0) {
            columns[columnKey] = filtered;
        }
    }
    return { version: LAYOUT_VERSION, columns };
}

export function sortTodosByLayout<T extends TodoLayoutTodoLike & Pick<Todo, "createdAt">>(
    todos: readonly T[],
    layout: TodoLayoutState,
): T[] {
    const rankByColumn = new Map<string, Map<string, number>>();
    for (const [columnKey, ids] of Object.entries(layout.columns)) {
        rankByColumn.set(
            columnKey,
            new Map(ids.map((id, index) => [id, index]))
        );
    }

    return [...todos].sort((a, b) => {
        const keyA = getTodoLayoutColumnKey(a);
        const keyB = getTodoLayoutColumnKey(b);

        if (keyA !== keyB) {
            return keyA.localeCompare(keyB);
        }

        const ranks = rankByColumn.get(keyA);
        const rankA = ranks?.get(a.id);
        const rankB = ranks?.get(b.id);

        const hasRankA = rankA !== undefined;
        const hasRankB = rankB !== undefined;
        if (hasRankA && hasRankB) {
            if (rankA !== rankB) return rankA - rankB;
            return a.id.localeCompare(b.id);
        }
        if (hasRankA) return -1;
        if (hasRankB) return 1;

        return compareFallback(a, b);
    });
}

function areLayoutsEqual(left: TodoLayoutState, right: TodoLayoutState): boolean {
    const leftKeys = Object.keys(left.columns).sort();
    const rightKeys = Object.keys(right.columns).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    for (let i = 0; i < leftKeys.length; i += 1) {
        if (leftKeys[i] !== rightKeys[i]) return false;
        const leftIds = left.columns[leftKeys[i]] ?? [];
        const rightIds = right.columns[rightKeys[i]] ?? [];
        if (leftIds.length !== rightIds.length) return false;
        for (let j = 0; j < leftIds.length; j += 1) {
            if (leftIds[j] !== rightIds[j]) return false;
        }
    }
    return true;
}

function getTodoLayoutPath(): string {
    return path.join(getNomendexPath(), "todo-layout.json");
}

export async function loadTodoLayout(): Promise<TodoLayoutState> {
    const file = Bun.file(getTodoLayoutPath());
    if (!(await file.exists())) {
        return EMPTY_LAYOUT;
    }

    try {
        const raw = await file.json();
        if (!raw || typeof raw !== "object") {
            return EMPTY_LAYOUT;
        }
        const candidate = raw as Partial<TodoLayoutState>;
        if (candidate.version !== LAYOUT_VERSION || typeof candidate.columns !== "object" || candidate.columns == null) {
            return EMPTY_LAYOUT;
        }
        return normalizeTodoLayout({
            version: LAYOUT_VERSION,
            columns: candidate.columns,
        });
    } catch {
        return EMPTY_LAYOUT;
    }
}

export async function saveTodoLayout(layout: TodoLayoutState): Promise<void> {
    const normalized = normalizeTodoLayout(layout);
    const filePath = getTodoLayoutPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await Bun.write(filePath, JSON.stringify(normalized, null, 2));
}

async function updateTodoLayout(
    updater: (layout: TodoLayoutState) => TodoLayoutState,
    validTodoIds?: ReadonlySet<string>,
): Promise<boolean> {
    return withLayoutUpdateLock(async () => {
        const current = normalizeTodoLayout(await loadTodoLayout(), validTodoIds);
        const updated = normalizeTodoLayout(updater(current), validTodoIds);
        if (areLayoutsEqual(current, updated)) {
            return false;
        }
        await saveTodoLayout(updated);
        return true;
    });
}

export async function appendTodoToLayout(
    todo: TodoLayoutTodoLike,
    validTodoIds?: ReadonlySet<string>,
): Promise<boolean> {
    return updateTodoLayout((layout) => {
        const columns = cloneColumns(layout.columns);
        for (const columnKey of Object.keys(columns)) {
            columns[columnKey] = columns[columnKey].filter((id) => id !== todo.id);
            if (columns[columnKey].length === 0) {
                delete columns[columnKey];
            }
        }

        const targetKey = getTodoLayoutColumnKey(todo);
        columns[targetKey] = dedupeIds([...(columns[targetKey] ?? []), todo.id]);
        return { ...layout, columns };
    }, validTodoIds);
}

export async function removeTodoFromLayout(
    todoId: string,
    validTodoIds?: ReadonlySet<string>,
): Promise<boolean> {
    return updateTodoLayout((layout) => {
        const columns = cloneColumns(layout.columns);
        for (const columnKey of Object.keys(columns)) {
            columns[columnKey] = columns[columnKey].filter((id) => id !== todoId);
            if (columns[columnKey].length === 0) {
                delete columns[columnKey];
            }
        }
        return { ...layout, columns };
    }, validTodoIds);
}

export async function moveTodoInLayout(
    todoId: string,
    to: Omit<TodoLayoutTodoLike, "id">,
    validTodoIds?: ReadonlySet<string>,
): Promise<boolean> {
    return updateTodoLayout((layout) => {
        const columns = cloneColumns(layout.columns);
        for (const columnKey of Object.keys(columns)) {
            columns[columnKey] = columns[columnKey].filter((id) => id !== todoId);
            if (columns[columnKey].length === 0) {
                delete columns[columnKey];
            }
        }
        const targetKey = getTodoLayoutColumnKey(to);
        columns[targetKey] = dedupeIds([...(columns[targetKey] ?? []), todoId]);
        return { ...layout, columns };
    }, validTodoIds);
}

export async function applyTodoReorders(
    reorders: Array<{ todoId: string; order: number }>,
    todoById: ReadonlyMap<string, Todo>,
): Promise<{ changed: boolean; movedIds: number }> {
    if (reorders.length === 0) {
        return { changed: false, movedIds: 0 };
    }

    const validTodoIds = new Set(todoById.keys());
    const touchedIds = new Set(
        reorders
            .map((entry) => entry.todoId)
            .filter((todoId) => validTodoIds.has(todoId))
    );

    if (touchedIds.size === 0) {
        return { changed: false, movedIds: 0 };
    }

    const changed = await updateTodoLayout((layout) => {
        const columns = cloneColumns(layout.columns);
        const columnByTodoId = new Map<string, string>();

        for (const [columnKey, ids] of Object.entries(columns)) {
            for (const id of ids) {
                if (!columnByTodoId.has(id)) {
                    columnByTodoId.set(id, columnKey);
                }
            }
        }

        const grouped = new Map<string, Array<{ todoId: string; order: number }>>();
        for (const reorder of reorders) {
            const todo = todoById.get(reorder.todoId);
            if (!todo) {
                continue;
            }

            // Prefer the column where the todo is currently present in layout.
            // Fallback to computed key from todo fields for legacy/missing layout rows.
            const columnKey = columnByTodoId.get(reorder.todoId) ?? getTodoLayoutColumnKey(todo);
            const bucket = grouped.get(columnKey) ?? [];
            bucket.push(reorder);
            grouped.set(columnKey, bucket);
        }

        if (grouped.size === 0) {
            return layout;
        }

        for (const columnKey of Object.keys(columns)) {
            columns[columnKey] = columns[columnKey].filter((id) => !touchedIds.has(id));
            if (columns[columnKey].length === 0) {
                delete columns[columnKey];
            }
        }

        for (const [columnKey, entries] of grouped.entries()) {
            const orderedIds = dedupeIds(
                [...entries]
                    .sort((left, right) => left.order - right.order)
                    .map((entry) => entry.todoId)
            );
            const remaining = columns[columnKey] ?? [];
            columns[columnKey] = dedupeIds([...orderedIds, ...remaining]);
        }

        return { ...layout, columns };
    }, validTodoIds);

    return { changed, movedIds: touchedIds.size };
}
