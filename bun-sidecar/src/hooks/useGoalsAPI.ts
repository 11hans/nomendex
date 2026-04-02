import type { GoalRecord } from "@/features/goals/goal-types";

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
};

export function useGoalsAPI() {
    return goalsAPI;
}
