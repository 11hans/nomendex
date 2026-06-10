import { scanInsights } from "@/features/insights/fx";
import { ScanInsightsInputSchema } from "@/features/insights/insights-types";

function errorResponse(error: unknown, context: string): Response {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[insights-routes] ${context}:`, message);
    return Response.json({ error: message, context }, { status: 500 });
}

export const insightsRoutes = {
    /**
     * Tier-0 behavioral scan: deterministic signals (neglected areas, stale
     * todos, overdue high-priority work, effort distribution) from current state.
     */
    "/api/insights/scan": {
        async POST(req: Request) {
            try {
                const raw = await req.json().catch(() => ({}));
                const args = ScanInsightsInputSchema.parse(raw ?? {});
                return Response.json(await scanInsights(args));
            } catch (e) {
                return errorResponse(e, "insights/scan");
            }
        },
    },
};
