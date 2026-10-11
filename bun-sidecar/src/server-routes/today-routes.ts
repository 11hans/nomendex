import { getDailyPanel } from "@/features/today/fx";
import { DailyPanelInputSchema } from "@/features/today/today-types";

export const todayRoutes = {
    /** Read-only context above a daily note (previous day's "zítra:", todos done that day). */
    "/api/today/daily-panel": {
        async POST(req: Request) {
            try {
                const args = DailyPanelInputSchema.parse(await req.json());
                return Response.json(await getDailyPanel(args));
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.error("[today-routes] daily-panel:", message);
                return Response.json({ error: message }, { status: 500 });
            }
        },
    },
};
