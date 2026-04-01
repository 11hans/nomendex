import { createServiceLogger } from "@/lib/logger";
import { FileDatabase } from "@/storage/FileDatabase";
import { getGoalsPath, hasActiveWorkspace } from "@/storage/root-path";
import { GoalRecord, GoalRecordSchema } from "./goal-types";
import type { Todo } from "@/features/todos/todo-types";
import type { ProjectConfig } from "@/features/projects/project-types";

const goalsLogger = createServiceLogger("GOALS");

// Lazy-initialized FileDatabase for goals
let goalsDb: FileDatabase<GoalRecord> | null = null;

/**
 * Initialize the goals service. Must be called after initializePaths().
 */
export async function initializeGoalsService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        goalsLogger.warn("No active workspace, skipping goals initialization");
        return;
    }
    goalsDb = new FileDatabase<GoalRecord>(getGoalsPath());
    await goalsDb.initialize();
    goalsLogger.info("Goals service initialized");
}

function getDb(): FileDatabase<GoalRecord> {
    if (!goalsDb) {
        throw new Error("Goals service not initialized. Call initializeGoalsService() first.");
    }
    return goalsDb;
}

/**
 * List goals, optionally filtered by horizon, status, area, or parentGoalId.
 */
export async function getGoals(input: {
    horizon?: string;
    status?: string;
    area?: string;
    parentGoalId?: string;
}): Promise<GoalRecord[]> {
    goalsLogger.info("Getting goals", { filter: input });

    const goals = await getDb().findAll();

    let filtered = goals;
    if (input.horizon) {
        filtered = filtered.filter(g => g.horizon === input.horizon);
    }
    if (input.status) {
        filtered = filtered.filter(g => g.status === input.status);
    }
    if (input.area) {
        filtered = filtered.filter(g => g.area === input.area);
    }
    if (input.parentGoalId !== undefined) {
        filtered = filtered.filter(g => g.parentGoalId === input.parentGoalId);
    }

    // Sort by updatedAt descending
    filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    goalsLogger.info(`Retrieved ${filtered.length} goals`);
    return filtered;
}

/**
 * Get a single goal by ID.
 */
export async function getGoalById(input: { goalId: string }): Promise<GoalRecord> {
    goalsLogger.info(`Getting goal by ID: ${input.goalId}`);

    const goal = await getDb().findById(input.goalId);
    if (!goal) {
        throw new Error(`Goal with ID ${input.goalId} not found`);
    }

    return goal;
}

/**
 * Create a new goal.
 */
export async function createGoal(input: {
    title: string;
    description?: string;
    area: string;
    horizon: "vision" | "yearly" | "quarterly" | "monthly";
    status?: "active" | "completed" | "paused" | "dropped";
    parentGoalId?: string;
    targetDate?: string;
    tags?: string[];
    mirrorNoteFile?: string;
    progressMode: "rollup" | "metric" | "manual" | "milestone";
    progressCurrent?: number;
    progressTarget?: number;
    progressValue?: number;
}): Promise<GoalRecord> {
    goalsLogger.info(`Creating goal: ${input.title}`);

    // Generate slug from title
    let slug = input.title
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");

    if (slug.length > 50) {
        slug = slug.substring(0, 50).replace(/-$/, "");
    }
    if (!slug) {
        slug = Math.random().toString(36).substr(2, 6);
    }

    const now = new Date().toISOString();
    const id = `goal-${slug}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

    // Build the progress portion based on mode
    let progressFields: Record<string, unknown>;
    switch (input.progressMode) {
        case "metric":
            progressFields = {
                progressMode: "metric" as const,
                progressCurrent: input.progressCurrent ?? 0,
                progressTarget: input.progressTarget ?? 100,
            };
            break;
        case "manual":
            progressFields = {
                progressMode: "manual" as const,
                progressValue: input.progressValue ?? 0,
            };
            break;
        case "milestone":
            progressFields = { progressMode: "milestone" as const };
            break;
        case "rollup":
        default:
            progressFields = { progressMode: "rollup" as const };
            break;
    }

    const goalData = {
        id,
        title: input.title,
        description: input.description,
        area: input.area,
        horizon: input.horizon,
        status: input.status ?? "active",
        parentGoalId: input.parentGoalId,
        targetDate: input.targetDate,
        tags: input.tags,
        mirrorNoteFile: input.mirrorNoteFile,
        createdAt: now,
        updatedAt: now,
        ...progressFields,
    };

    const goal = GoalRecordSchema.parse(goalData);
    const created = await getDb().create(goal);

    goalsLogger.info(`Created goal: ${created.id}`);
    return created;
}

/**
 * Update an existing goal.
 */
export async function updateGoal(input: {
    goalId: string;
    updates: {
        title?: string;
        description?: string;
        area?: string;
        horizon?: "vision" | "yearly" | "quarterly" | "monthly";
        status?: "active" | "completed" | "paused" | "dropped";
        parentGoalId?: string | null;
        targetDate?: string | null;
        tags?: string[];
        mirrorNoteFile?: string | null;
        progressMode?: "rollup" | "metric" | "manual" | "milestone";
        progressCurrent?: number;
        progressTarget?: number;
        progressValue?: number;
    };
}): Promise<GoalRecord> {
    goalsLogger.info(`Updating goal: ${input.goalId}`);

    const existing = await getDb().findById(input.goalId);
    if (!existing) {
        throw new Error(`Goal with ID ${input.goalId} not found`);
    }

    // Strip null values to undefined before building updates
    const { parentGoalId, targetDate, mirrorNoteFile, ...rest } = input.updates;

    const updates: Partial<GoalRecord> & Record<string, unknown> = {
        ...rest,
        updatedAt: new Date().toISOString(),
    };

    // Handle nullable fields: null means clear, undefined means no change
    if (parentGoalId !== undefined) {
        updates.parentGoalId = parentGoalId ?? undefined;
    }
    if (targetDate !== undefined) {
        updates.targetDate = targetDate ?? undefined;
    }
    if (mirrorNoteFile !== undefined) {
        updates.mirrorNoteFile = mirrorNoteFile ?? undefined;
    }

    // Validate the merged result against the full schema before writing
    GoalRecordSchema.parse({ ...existing, ...updates });

    const updated = await getDb().update(input.goalId, updates as Partial<GoalRecord>);
    if (!updated) {
        throw new Error(`Goal with ID ${input.goalId} not found after write`);
    }

    goalsLogger.info(`Updated goal: ${input.goalId}`);
    return updated;
}

/**
 * Delete a goal.
 */
export async function deleteGoal(input: { goalId: string }): Promise<{ success: boolean }> {
    goalsLogger.info(`Deleting goal: ${input.goalId}`);

    const deleted = await getDb().delete(input.goalId);
    if (!deleted) {
        throw new Error(`Goal with ID ${input.goalId} not found`);
    }

    goalsLogger.info(`Deleted goal: ${input.goalId}`);
    return { success: true };
}

/**
 * Compute progress percentage for a single goal.
 */
/** @internal Exported for testing */
export function computeGoalProgress(
    goal: GoalRecord,
    childGoals: GoalRecord[],
    linkedTodos: Todo[],
): number {
    const activeChildren = childGoals.filter(g => g.status === "active" || g.status === "completed");

    // If goal has active children, progress = average of children's computed progress
    if (activeChildren.length > 0 && goal.progressMode === "rollup") {
        const childProgresses = activeChildren.map(child => {
            // Use pre-computed progress if available (set by getGoalForest / getGoalGraph)
            if (typeof (child as GoalRecord & { _computedProgress?: number })._computedProgress === "number") {
                return (child as GoalRecord & { _computedProgress?: number })._computedProgress!;
            }
            const grandchildren = childGoals.filter(g => g.parentGoalId === child.id);
            return computeGoalProgress(child, grandchildren, []);
        });
        const sum = childProgresses.reduce((acc, val) => acc + val, 0);
        return Math.round(sum / childProgresses.length);
    }

    // Leaf goal or non-rollup mode
    switch (goal.progressMode) {
        case "metric": {
            if (!("progressCurrent" in goal) || !("progressTarget" in goal)) return 0;
            if (goal.progressTarget <= 0) return 0;
            return Math.round(Math.min(100, (goal.progressCurrent / goal.progressTarget) * 100));
        }
        case "manual": {
            if (!("progressValue" in goal)) return 0;
            return Math.round(goal.progressValue);
        }
        case "milestone": {
            if (activeChildren.length === 0) {
                // No children — use status as proxy
                return goal.status === "completed" ? 100 : 0;
            }
            const completed = activeChildren.filter(c => c.status === "completed").length;
            return Math.round((completed / activeChildren.length) * 100);
        }
        case "rollup":
        default: {
            // Leaf rollup goal with no children — derive from linked todos
            if (linkedTodos.length === 0) {
                return goal.status === "completed" ? 100 : 0;
            }
            const doneTodos = linkedTodos.filter(t => t.status === "done").length;
            return Math.round((doneTodos / linkedTodos.length) * 100);
        }
    }
}

export type GoalTreeNode = {
    goal: GoalRecord;
    children: GoalTreeNode[];
    linkedProjects: ProjectConfig[];
    computedProgress: number;
};

/**
 * Get the full goal forest: all goals as a nested tree with progress.
 * Useful for dashboard views and agent context.
 */
export async function getGoalForest(): Promise<GoalTreeNode[]> {
    const allGoals = await getDb().findAll();

    let allProjects: ProjectConfig[] = [];
    try {
        const { listProjects } = await import("@/features/projects/fx");
        allProjects = await listProjects({ includeArchived: false });
    } catch { /* projects optional */ }

    let allTodos: Todo[] = [];
    try {
        const { getTodos } = await import("@/features/todos/fx");
        allTodos = await getTodos({});
    } catch { /* todos optional */ }

    function buildNode(goal: GoalRecord): GoalTreeNode {
        const children = allGoals
            .filter(g => g.parentGoalId === goal.id)
            .map(buildNode);
        const linkedProjects = allProjects.filter(p => p.goalRef === goal.id);
        const linkedTodos = allTodos.filter(t => t.resolvedGoalRefs?.includes(goal.id));
        return {
            goal,
            children,
            linkedProjects,
            computedProgress: computeGoalProgress(
                goal,
                children.map(n => ({ ...n.goal, _computedProgress: n.computedProgress } as GoalRecord & { _computedProgress: number })),
                linkedTodos,
            ),
        };
    }

    const roots = allGoals.filter(g => !g.parentGoalId);
    return roots.map(buildNode);
}

/**
 * Get goal graph: goal + child goals + linked projects + linked todos + computed progress.
 */
export async function getGoalGraph(input: { goalId: string }): Promise<{
    goal: GoalRecord;
    childGoals: GoalRecord[];
    linkedProjects: ProjectConfig[];
    linkedTodos: Todo[];
    computedProgress: number;
}> {
    goalsLogger.info(`Getting goal graph for: ${input.goalId}`);

    const goal = await getDb().findById(input.goalId);
    if (!goal) {
        throw new Error(`Goal with ID ${input.goalId} not found`);
    }

    // Get all goals to find children
    const allGoals = await getDb().findAll();
    const childGoals = allGoals.filter(g => g.parentGoalId === input.goalId);

    // Get linked projects (projects that reference this goal via goalRef field)
    let linkedProjects: ProjectConfig[] = [];
    try {
        const { listProjects } = await import("@/features/projects/fx");
        const allProjects = await listProjects({ includeArchived: false });
        // Check for goalRef on projects — if field doesn't exist yet, this returns empty
        linkedProjects = allProjects.filter(p => p.goalRef === input.goalId);
    } catch (error) {
        goalsLogger.warn("Failed to load projects for goal graph", { error });
    }

    // Get all todos for progress computation across the goal tree
    let allTodos: Todo[] = [];
    try {
        const { getTodos } = await import("@/features/todos/fx");
        allTodos = await getTodos({});
    } catch (error) {
        goalsLogger.warn("Failed to load todos for goal graph", { error });
    }
    const linkedTodos = allTodos.filter(t => t.resolvedGoalRefs?.includes(input.goalId));

    // Pre-compute child progress so rollup parent uses real values
    const childrenWithProgress = childGoals.map(child => {
        const grandchildren = allGoals.filter(g => g.parentGoalId === child.id);
        const childTodos = allTodos.filter(t => t.resolvedGoalRefs?.includes(child.id));
        const progress = computeGoalProgress(child, grandchildren, childTodos);
        return { ...child, _computedProgress: progress } as GoalRecord & { _computedProgress: number };
    });

    const computedProgress = computeGoalProgress(goal, childrenWithProgress, linkedTodos);

    goalsLogger.info(`Goal graph computed for ${input.goalId}: progress=${computedProgress}%`);
    return {
        goal,
        childGoals,
        linkedProjects,
        linkedTodos,
        computedProgress,
    };
}
