import type { GoalRecord } from "@/features/goals/goal-types";
import type { GoalForestNodeView, GoalGraphView } from "@/features/goals/goals-view-types";

async function fetchAPI<T>(endpoint: string, body: object = {}): Promise<T> {
    const response = await fetch(`/api/goals/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

export const goalsAPI = {
    listGoals: (args: { status?: string; horizon?: string; area?: string } = {}) =>
        fetchAPI<GoalRecord[]>("list", args),
    getGoal: (args: { goalId: string }) =>
        fetchAPI<GoalRecord>("get", args),
    getGoalForest: () =>
        fetchAPI<GoalForestNodeView[]>("graph/forest"),
    getGoalGraph: (args: { goalId: string }) =>
        fetchAPI<GoalGraphView>("graph", args),
    createGoal: (args: {
        title: string;
        area: string;
        horizon: GoalRecord["horizon"];
        progressMode: GoalRecord["progressMode"];
        description?: string;
        status?: GoalRecord["status"];
        parentGoalId?: string;
        targetDate?: string;
        tags?: string[];
    }) => fetchAPI<GoalRecord>("create", args),
    updateGoal: (args: {
        goalId: string;
        updates: {
            title?: string;
            description?: string;
            area?: string;
            horizon?: GoalRecord["horizon"];
            status?: GoalRecord["status"];
            parentGoalId?: string | null;
            targetDate?: string | null;
            tags?: string[];
            progressMode?: GoalRecord["progressMode"];
            progressCurrent?: number;
            progressTarget?: number;
            progressValue?: number;
        };
    }) => fetchAPI<GoalRecord>("update", args),
    deleteGoal: (args: { goalId: string }) =>
        fetchAPI<{ success: boolean }>("delete", args),
};

export function useGoalsAPI() {
    return goalsAPI;
}
