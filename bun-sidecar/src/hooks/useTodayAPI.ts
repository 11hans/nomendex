import type { DailyPanel } from "@/features/today/today-types";

export const todayAPI = {
    /** Panel above a daily note; null when the note isn't a daily note. */
    getDailyPanel: async (args: { fileName: string }): Promise<DailyPanel | null> => {
        const response = await fetch("/api/today/daily-panel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
        });
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        return response.json();
    },
};
