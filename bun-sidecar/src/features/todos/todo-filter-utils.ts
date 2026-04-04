import type { Todo } from "./todo-types";
import type {
    DueBucket,
    TodoDueFilter,
    TodoFilterState,
    TodoQuickPreset,
    TodoSortMode,
    TodoStatusBucket,
} from "./todo-filter-types";

// ─── Date helpers ───────────────────────────────────────────────────────────

function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function startOfTomorrow(): Date {
    const d = startOfToday();
    d.setDate(d.getDate() + 1);
    return d;
}

function parseDate(dateString: string): Date | null {
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
}

export function isTimeblockTodo(todo: Pick<Todo, "tags">): boolean {
    return todo.tags?.includes("timeblock") ?? false;
}

// ─── Effective date ─────────────────────────────────────────────────────────

/** Returns the most relevant date for urgency: dueDate > scheduledStart > scheduledEnd */
export function getEffectiveDate(todo: Todo): string | undefined {
    return todo.dueDate ?? todo.scheduledStart ?? todo.scheduledEnd;
}

// ─── Due bucket classification ──────────────────────────────────────────────

/** Classify a date string into an urgency bucket (local time). */
export function classifyDueBucket(dateString: string | undefined): DueBucket {
    if (!dateString) return "no_due";

    const date = parseDate(dateString);
    if (!date) return "no_due";

    const today = startOfToday();
    const tomorrow = startOfTomorrow();
    const next7End = new Date(tomorrow);
    next7End.setDate(next7End.getDate() + 7);

    if (date < today) return "overdue";
    if (date < tomorrow) return "today";
    if (date < next7End) return "next_7_days";
    return "no_due";
}

// ─── Urgency comparator ────────────────────────────────────────────────────

const DUE_BUCKET_ORDER: Record<DueBucket, number> = {
    overdue: 0,
    today: 1,
    next_7_days: 2,
    no_due: 3,
};

const PRIORITY_ORDER: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
    none: 3,
};

const STATUS_ORDER: Record<string, number> = {
    in_progress: 0,
    todo: 1,
    later: 2,
    done: 3,
};

/**
 * Stable urgency comparator.
 * Order: due bucket → effective date → priority → status → updatedAt DESC → title ASC
 */
export function urgencyComparator(a: Todo, b: Todo): number {
    // 1. Due bucket
    const aDate = getEffectiveDate(a);
    const bDate = getEffectiveDate(b);
    const aBucket = classifyDueBucket(aDate);
    const bBucket = classifyDueBucket(bDate);
    const bucketDiff = DUE_BUCKET_ORDER[aBucket] - DUE_BUCKET_ORDER[bBucket];
    if (bucketDiff !== 0) return bucketDiff;

    // 2. Effective date (earlier first)
    if (aDate && bDate) {
        const aTime = new Date(aDate).getTime();
        const bTime = new Date(bDate).getTime();
        if (aTime !== bTime) return aTime - bTime;
    } else if (aDate) {
        return -1;
    } else if (bDate) {
        return 1;
    }

    // 3. Priority
    const aPri = PRIORITY_ORDER[a.priority ?? "none"] ?? 3;
    const bPri = PRIORITY_ORDER[b.priority ?? "none"] ?? 3;
    if (aPri !== bPri) return aPri - bPri;

    // 4. Status
    const aStat = STATUS_ORDER[a.status] ?? 4;
    const bStat = STATUS_ORDER[b.status] ?? 4;
    if (aStat !== bStat) return aStat - bStat;

    // 5. updatedAt DESC
    const aUp = new Date(a.updatedAt).getTime();
    const bUp = new Date(b.updatedAt).getTime();
    if (aUp !== bUp) return bUp - aUp;

    // 6. title ASC
    return a.title.localeCompare(b.title);
}

/** Sort by updatedAt descending. */
export function recentComparator(a: Todo, b: Todo): number {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

// ─── Needs attention predicate ──────────────────────────────────────────────

/** Active todo that requires user attention: overdue/today, high priority, or in progress. */
export function needsAttention(todo: Todo): boolean {
    // Must be active (not done, not archived)
    if (todo.archived) return false;
    if (todo.status === "done") return false;
    if (isTimeblockTodo(todo)) return false;

    const bucket = classifyDueBucket(getEffectiveDate(todo));
    if (bucket === "overdue" || bucket === "today") return true;
    if ((todo.priority ?? "none") === "high") return true;
    if (todo.status === "in_progress") return true;

    return false;
}

// ─── Due filter predicate ───────────────────────────────────────────────────

/** Check if a todo matches the given due filter. */
export function matchesDueFilter(todo: Todo, filter: TodoDueFilter): boolean {
    if (filter === "any") return true;

    const bucket = classifyDueBucket(getEffectiveDate(todo));

    switch (filter) {
        case "overdue":
            return bucket === "overdue";
        case "today":
            return bucket === "today";
        case "today_or_overdue":
            return bucket === "today" || bucket === "overdue";
        case "next_7_days":
            return bucket === "next_7_days";
        case "no_due":
            return bucket === "no_due";
    }
}

// ─── Quick presets ──────────────────────────────────────────────────────────

/** Returns filter overrides for a quick preset. */
export function applyQuickPreset(preset: TodoQuickPreset): Partial<TodoFilterState> {
    const clean: Partial<TodoFilterState> = {
        selectedTags: [],
        selectedPriority: null,
        dueFilter: "any",
        selectedProject: null,
        quickPreset: preset,
    };

    switch (preset) {
        case "none":
            return { ...clean, statusBucket: "all" };
        case "needs_attention":
            return { ...clean, statusBucket: "active" };
        case "due_today":
            return { ...clean, statusBucket: "active", dueFilter: "today" };
        case "overdue":
            return { ...clean, statusBucket: "active", dueFilter: "overdue" };
    }
}

// ─── Fuzzy search ───────────────────────────────────────────────────────────

/** Sequential character fuzzy match (case-insensitive). */
export function fuzzyMatch(query: string, text: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    const t = text.toLowerCase();

    let qIdx = 0;
    let tIdx = 0;

    while (qIdx < q.length && tIdx < t.length) {
        if (q[qIdx] === t[tIdx]) {
            qIdx++;
        }
        tIdx++;
    }

    return qIdx === q.length;
}

/** Check if a todo matches a search query across title, description, project, tags. */
function matchesSearch(todo: Todo, query: string): boolean {
    if (!query.trim()) return true;
    return (
        fuzzyMatch(query, todo.title)
        || (todo.description ? fuzzyMatch(query, todo.description) : false)
        || (todo.project ? fuzzyMatch(query, todo.project) : false)
        || (todo.tags?.some((tag) => fuzzyMatch(query, tag)) ?? false)
    );
}

// ─── Status bucket predicate ────────────────────────────────────────────────

function matchesStatusBucket(todo: Todo, bucket: TodoStatusBucket): boolean {
    switch (bucket) {
        case "all":
            return true;
        case "active":
            return !todo.archived && todo.status !== "done";
        case "completed":
            return todo.status === "done" && !todo.archived;
        case "archived":
            return todo.archived === true;
    }
}

// ─── Master filter+sort pipeline ────────────────────────────────────────────

export interface FilterAndSortOptions {
    /** Skip status bucket filtering (kanban views where columns handle status). */
    skipStatusFilter?: boolean;
}

/**
 * Master filter and sort pipeline for todos.
 * Applies all filters in order, then sorts by the selected mode.
 */
export function filterAndSortTodos(
    todos: readonly Todo[],
    state: TodoFilterState,
    options?: FilterAndSortOptions,
): Todo[] {
    // Determine effective filter state (presets may override)
    const effectiveState = state.quickPreset !== "none"
        ? { ...state, ...applyQuickPreset(state.quickPreset) }
        : state;

    let result = todos.filter((todo) => {
        // 1. Search
        if (!matchesSearch(todo, effectiveState.searchQuery)) return false;

        // 2. Status bucket
        if (!options?.skipStatusFilter && !matchesStatusBucket(todo, effectiveState.statusBucket)) return false;

        // 3. Tags (OR match)
        if (effectiveState.selectedTags.length > 0) {
            if (!todo.tags?.some((tag) => effectiveState.selectedTags.includes(tag))) return false;
        }

        // 4. Priority
        if (effectiveState.selectedPriority !== null) {
            if ((todo.priority ?? "none") !== effectiveState.selectedPriority) return false;
        }

        // 5. Due filter
        if (!matchesDueFilter(todo, effectiveState.dueFilter)) return false;

        // 6. Project
        if (effectiveState.selectedProject !== null) {
            if ((todo.project ?? "") !== effectiveState.selectedProject) return false;
        }

        // 7. Needs attention preset (additional predicate)
        if (effectiveState.quickPreset === "needs_attention") {
            if (!needsAttention(todo)) return false;
        }

        return true;
    });

    // Sort
    const comparator = getComparator(effectiveState.sortMode);
    if (comparator) {
        result = [...result].sort(comparator);
    }

    return result;
}

function getComparator(mode: TodoSortMode): ((a: Todo, b: Todo) => number) | null {
    switch (mode) {
        case "urgency":
            return urgencyComparator;
        case "recent":
            return recentComparator;
        case "manual":
            return null; // manual mode preserves existing order
    }
}
