import type { Todo } from "@/features/todos/todo-types";
import { getEffectiveGoalRefs } from "@/features/todos/todo-types";
import type { GoalRecord } from "@/features/goals/goal-types";
import type { InsightSignal, InsightsReport } from "./insights-types";

/** Minimal project shape the computation needs (name → goal link). */
export interface ProjectLink {
    name: string;
    goalRef?: string;
}

export interface ComputeInsightsData {
    /** Active (non-archived) todos. */
    todos: Todo[];
    /** Archived todos — a todo completed then archived still counts as effort. */
    archivedTodos: Todo[];
    projects: ProjectLink[];
    goals: GoalRecord[];
    now?: Date;
    windowDays?: number;
    staleDays?: number;
    goalOverloadThreshold?: number;
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_STALE_DAYS = 14;
const MAX_LISTED = 5;
/**
 * Below this many completions in the window, flagging individual neglected areas
 * is noise ("you're neglecting everything"). The honest signal is throughput.
 * Calibrated against real data where a low week produced 4 simultaneous
 * area-neglect warnings — useless. Area-neglect is only meaningful *relative to*
 * activity elsewhere.
 */
const MEANINGFUL_ACTIVITY = 5;
const MAX_NEGLECT_SIGNALS = 2;
/**
 * Concurrent active, actionable goals above which the portfolio is overloaded.
 * Real data showed ~28 active goals across 4 areas — nothing can get focus at
 * that count. A defensible WIP ceiling for things you mean to move *now*.
 */
const DEFAULT_GOAL_OVERLOAD_THRESHOLD = 10;

const HORIZON_WEIGHT: Record<GoalRecord["horizon"], number> = {
    yearly: 3,
    quarterly: 2,
    monthly: 1,
    vision: 0,
};

/** Horizons that make a neglected area actually actionable / worth flagging now. */
const ACTIONABLE_HORIZONS = new Set<GoalRecord["horizon"]>(["yearly", "quarterly", "monthly"]);

function startOfLocalDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
    return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

function parseDate(iso: string | undefined): Date | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Compute Tier-0 behavioral signals. Pure: no I/O, fully determined by inputs.
 * Same inputs → same output, so it is safe to assert its facts to the user.
 */
export function computeInsights(data: ComputeInsightsData): InsightsReport {
    const now = data.now ?? new Date();
    const windowDays = data.windowDays ?? DEFAULT_WINDOW_DAYS;
    const staleDays = data.staleDays ?? DEFAULT_STALE_DAYS;
    const goalOverloadThreshold = data.goalOverloadThreshold ?? DEFAULT_GOAL_OVERLOAD_THRESHOLD;
    const todayStart = startOfLocalDay(now);
    const windowStart = new Date(now.getTime() - windowDays * 86_400_000);

    // name (lowercased) → goalRef
    const projectGoalRef = new Map<string, string | undefined>();
    for (const p of data.projects) projectGoalRef.set(p.name.toLowerCase(), p.goalRef);

    const goalById = new Map<string, GoalRecord>();
    for (const g of data.goals) goalById.set(g.id, g);

    /** Distinct goal areas a todo contributes to (via effective goal refs). */
    function areasForTodo(todo: Todo): Set<string> {
        const pRef = todo.project ? projectGoalRef.get(todo.project.toLowerCase()) : undefined;
        const refs = getEffectiveGoalRefs(todo, pRef);
        const areas = new Set<string>();
        for (const ref of refs) {
            const goal = goalById.get(ref);
            if (goal) areas.add(goal.area);
        }
        return areas;
    }

    const signals: InsightSignal[] = [];

    // ── Effort distribution + neglected areas (window) ──────────────────────
    const completedInWindow = [...data.todos, ...data.archivedTodos].filter((t) => {
        if (t.status !== "done") return false;
        const c = parseDate(t.completedAt);
        return !!c && c >= windowStart && c <= now;
    });

    const completedLast30 = [...data.todos, ...data.archivedTodos].filter((t) => {
        if (t.status !== "done") return false;
        const c = parseDate(t.completedAt);
        return !!c && c >= new Date(now.getTime() - 30 * 86_400_000) && c <= now;
    }).length;

    const effortByArea = new Map<string, number>();
    let unlinkedEffort = 0;
    for (const t of completedInWindow) {
        const areas = areasForTodo(t);
        if (areas.size === 0) {
            unlinkedEffort++;
            continue;
        }
        for (const area of areas) effortByArea.set(area, (effortByArea.get(area) ?? 0) + 1);
    }

    // Active, time-bound goals grouped by area.
    const actionableGoalsByArea = new Map<string, GoalRecord[]>();
    for (const g of data.goals) {
        if (g.status !== "active") continue;
        if (!ACTIONABLE_HORIZONS.has(g.horizon)) continue;
        const list = actionableGoalsByArea.get(g.area) ?? [];
        list.push(g);
        actionableGoalsByArea.set(g.area, list);
    }

    if (completedInWindow.length > 0) {
        const ranked = [...effortByArea.entries()].sort((a, b) => b[1] - a[1]);
        const parts = ranked.map(([area, n]) => `${area}: ${n}`);
        if (unlinkedEffort > 0) parts.push(`bez cíle: ${unlinkedEffort}`);
        const metrics: Record<string, number> = { total: completedInWindow.length };
        for (const [area, n] of effortByArea) metrics[area] = n;
        if (unlinkedEffort > 0) metrics["(unlinked)"] = unlinkedEffort;
        signals.push({
            type: "effort_distribution",
            severity: "info",
            title: `Rozložení úsilí za ${windowDays} dní`,
            detail: `${completedInWindow.length} dokončených úkolů — ${parts.join(" · ")}.`,
            metrics,
        });
    }

    // Actionable areas with zero effort in the window.
    const neglectedAreas = [...actionableGoalsByArea.entries()].filter(
        ([area]) => (effortByArea.get(area) ?? 0) === 0,
    );

    if (completedInWindow.length < MEANINGFUL_ACTIVITY) {
        // Too little activity to single out areas — "everything is neglected" is
        // noise. Report the real story: throughput.
        signals.push({
            type: "low_throughput",
            severity: "warning",
            title: "Nízký throughput",
            detail:
                `Jen ${completedInWindow.length} dokončen${completedInWindow.length === 1 ? "ý úkol" : "ých úkolů"} ` +
                `za ${windowDays} dní (${completedLast30} za 30 dní). Než řešit jednotlivé oblasti, ` +
                `je potřeba rozhýbat dokončování — ${neglectedAreas.length} akčních oblastí je tento týden na nule.`,
            metrics: {
                completedInWindow: completedInWindow.length,
                completedLast30,
                neglectedAreas: neglectedAreas.length,
            },
        });
    } else {
        // Comparative neglect: user is active, but some important area gets nothing.
        // Rank by focus flag, then horizon, then number of active goals; cap output.
        const ranked = neglectedAreas.sort((a, b) => {
            const af = a[1].some((g) => g.focus) ? 1 : 0;
            const bf = b[1].some((g) => g.focus) ? 1 : 0;
            if (af !== bf) return bf - af;
            const ah = Math.max(...a[1].map((g) => HORIZON_WEIGHT[g.horizon]));
            const bh = Math.max(...b[1].map((g) => HORIZON_WEIGHT[g.horizon]));
            if (ah !== bh) return bh - ah;
            return b[1].length - a[1].length;
        });
        const shown = ranked.slice(0, MAX_NEGLECT_SIGNALS);
        for (const [area, areaGoals] of shown) {
            const titles = areaGoals.slice(0, MAX_LISTED).map((g) => g.title);
            signals.push({
                type: "neglected_area",
                severity: "warning",
                title: `Zanedbaná oblast: ${area}`,
                detail:
                    `Za ${windowDays} dní ${completedInWindow.length} dokončených úkolů, ale 0 v oblasti „${area}" ` +
                    `(${areaGoals.length} aktivních cílů: ${titles.join("; ")}).`,
                area,
                goalIds: areaGoals.map((g) => g.id),
                metrics: {
                    activeGoals: areaGoals.length,
                    effortInWindow: 0,
                    moreNeglectedAreas: ranked.length - shown.length,
                },
            });
        }
    }

    // ── Goal portfolio overload ─────────────────────────────────────────────
    // Too many concurrent active, actionable goals → nothing gets real focus.
    // Fact only: the count + horizon breakdown + how many are flagged focus.
    const actionableGoals = [...actionableGoalsByArea.values()].flat();
    if (actionableGoals.length > goalOverloadThreshold) {
        const byHorizon = { yearly: 0, quarterly: 0, monthly: 0 };
        let focusCount = 0;
        for (const g of actionableGoals) {
            if (g.horizon === "yearly" || g.horizon === "quarterly" || g.horizon === "monthly") {
                byHorizon[g.horizon]++;
            }
            if (g.focus) focusCount++;
        }
        signals.push({
            type: "goal_overload",
            severity: "warning",
            title: "Přebujelé portfolio cílů",
            detail:
                `${actionableGoals.length} aktivních akčních cílů ` +
                `(yearly: ${byHorizon.yearly}, quarterly: ${byHorizon.quarterly}, monthly: ${byHorizon.monthly}) ` +
                `napříč ${actionableGoalsByArea.size} oblastmi. Označeno jako focus: ${focusCount}. ` +
                `Udržitelně se dá souběžně tlačit ~${goalOverloadThreshold}.`,
            goalIds: actionableGoals.map((g) => g.id),
            metrics: {
                activeActionable: actionableGoals.length,
                yearly: byHorizon.yearly,
                quarterly: byHorizon.quarterly,
                monthly: byHorizon.monthly,
                focusCount,
                threshold: goalOverloadThreshold,
            },
        });
    }

    // ── Stale open todos ────────────────────────────────────────────────────
    const stale = data.todos
        .filter((t) => {
            if (t.kind !== "task" || t.source !== "user") return false;
            if (t.parentTodoId) return false;
            if (t.status !== "todo" && t.status !== "planned") return false;
            const created = parseDate(t.createdAt);
            if (!created || daysBetween(now, created) < staleDays) return false;
            // Parked for the future on purpose → not stale.
            const start = parseDate(t.scheduledStart);
            if (start && start > now) return false;
            return true;
        })
        .sort((a, b) => (parseDate(a.createdAt)!.getTime() - parseDate(b.createdAt)!.getTime()));

    if (stale.length > 0) {
        const top = stale.slice(0, MAX_LISTED);
        const oldest = daysBetween(now, parseDate(stale[0].createdAt)!);
        signals.push({
            type: "stale_todo",
            severity: "notice",
            title: `${stale.length} úkolů bez pohybu`,
            detail:
                `${stale.length} otevřený${stale.length === 1 ? " úkol leží" : "ch úkolů leží"} ≥${staleDays} dní bez změny ` +
                `(nejstarší ${oldest} dní): ${top.map((t) => t.title).join("; ")}.`,
            todoIds: stale.map((t) => t.id),
            metrics: { count: stale.length, oldestDays: oldest },
        });
    }

    // ── Overdue high-priority work ──────────────────────────────────────────
    const overdueHigh = data.todos.filter((t) => {
        if (t.kind !== "task" || t.source !== "user") return false;
        if (t.parentTodoId) return false;
        if (t.priority !== "high") return false;
        if (t.status !== "todo" && t.status !== "planned" && t.status !== "in_progress") return false;
        const due = parseDate(t.dueDate);
        const start = parseDate(t.scheduledStart);
        const overdue = (due && due < todayStart) || (start && start < todayStart);
        return !!overdue;
    });

    if (overdueHigh.length > 0) {
        signals.push({
            type: "overdue_high_priority",
            severity: "warning",
            title: `${overdueHigh.length} high-priority po termínu`,
            detail:
                `${overdueHigh.length} úkol${overdueHigh.length === 1 ? "" : "ů"} s prioritou high je po termínu a stále otevřen${overdueHigh.length === 1 ? "" : "ých"}: ` +
                `${overdueHigh.slice(0, MAX_LISTED).map((t) => t.title).join("; ")}.`,
            todoIds: overdueHigh.map((t) => t.id),
            metrics: { count: overdueHigh.length },
        });
    }

    // Surface order: warnings → notices → info (deterministic within each).
    const severityRank: Record<InsightSignal["severity"], number> = { warning: 0, notice: 1, info: 2 };
    signals.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

    return {
        generatedAt: now.toISOString(),
        windowDays,
        staleDays,
        signalCount: signals.length,
        signals,
    };
}
