import {
    getGoals,
    getGoalById,
    createGoal,
    updateGoal,
    deleteGoal,
    getGoalGraph,
    getGoalForest,
} from "@/features/goals/fx";
import {
    parseGoalsFromMarkdown,
    parseProjectGoalLinks,
    buildMigrationPlan,
    executeMigration,
    MigrationPlanSchema,
} from "@/features/goals/migration";
import {
    generateGoalMirrorNote,
    generateProjectMirrorNote,
    syncAllGoalMirrors,
    syncAllProjectMirrors,
    generateAggregatedDashboards,
    importFromMirrorNote,
} from "@/features/goals/mirror-sync";
import { getNotesPath } from "@/storage/root-path";

function errorResponse(error: unknown, context: string): Response {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[goals-routes] ${context}:`, message, stack);
    return Response.json({ error: message, context }, { status: 500 });
}

export const goalsRoutes = {
    "/api/goals/list": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                return Response.json(await getGoals(args));
            } catch (e) { return errorResponse(e, "goals/list"); }
        },
    },
    "/api/goals/get": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                return Response.json(await getGoalById(args));
            } catch (e) { return errorResponse(e, "goals/get"); }
        },
    },
    "/api/goals/create": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                return Response.json(await createGoal(args));
            } catch (e) { return errorResponse(e, "goals/create"); }
        },
    },
    "/api/goals/update": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                return Response.json(await updateGoal(args));
            } catch (e) { return errorResponse(e, "goals/update"); }
        },
    },
    "/api/goals/delete": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                return Response.json(await deleteGoal(args));
            } catch (e) { return errorResponse(e, "goals/delete"); }
        },
    },
    "/api/goals/graph": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                if (!args?.goalId) {
                    return Response.json(
                        { error: "goalId required. For the full tree use /api/goals/graph/forest" },
                        { status: 400 },
                    );
                }
                return Response.json(await getGoalGraph(args));
            } catch (e) { return errorResponse(e, "goals/graph"); }
        },
    },
    "/api/goals/graph/forest": {
        async POST() {
            try {
                return Response.json(await getGoalForest());
            } catch (e) { return errorResponse(e, "goals/graph/forest"); }
        },
    },
    "/api/goals/migration/preview": {
        async POST() {
            try {
                const notesPath = getNotesPath();
                const candidates = await parseGoalsFromMarkdown(notesPath);
                const links = await parseProjectGoalLinks(notesPath);
                const plan = buildMigrationPlan(candidates, links);
                return Response.json(plan);
            } catch (e) { return errorResponse(e, "goals/migration/preview"); }
        },
    },
    "/api/goals/migration/execute": {
        async POST(req: Request) {
            try {
                const rawPlan = await req.json();
                const plan = MigrationPlanSchema.parse(rawPlan);
                return Response.json(await executeMigration(plan));
            } catch (e) { return errorResponse(e, "goals/migration/execute"); }
        },
    },
    "/api/goals/sync/goal": {
        async POST(req: Request) {
            try {
                const args: { goalId: string } = await req.json();
                return Response.json(await generateGoalMirrorNote({ goalId: args.goalId }));
            } catch (e) { return errorResponse(e, "goals/sync/goal"); }
        },
    },
    "/api/goals/sync/project": {
        async POST(req: Request) {
            try {
                const args: { projectId: string } = await req.json();
                return Response.json(await generateProjectMirrorNote({ projectId: args.projectId }));
            } catch (e) { return errorResponse(e, "goals/sync/project"); }
        },
    },
    "/api/goals/sync/all": {
        async POST() {
            try {
                const [goalResults, projectResults] = await Promise.all([
                    syncAllGoalMirrors(),
                    syncAllProjectMirrors(),
                ]);
                return Response.json({ goals: goalResults, projects: projectResults });
            } catch (e) { return errorResponse(e, "goals/sync/all"); }
        },
    },
    "/api/goals/sync/dashboards": {
        async POST() {
            try {
                const notesPath = getNotesPath();
                await generateAggregatedDashboards(notesPath);
                return Response.json({ success: true });
            } catch (e) { return errorResponse(e, "goals/sync/dashboards"); }
        },
    },
    "/api/goals/sync/import": {
        async POST(req: Request) {
            try {
                const args: { filePath: string } = await req.json();
                return Response.json(await importFromMirrorNote({ filePath: args.filePath }));
            } catch (e) { return errorResponse(e, "goals/sync/import"); }
        },
    },
    "/api/goals/migration/debug": {
        async POST() {
            try {
                const notesPath = getNotesPath();
                const goalsDir = `${notesPath}/Goals`;
                const yearlyPath = `${goalsDir}/1. Yearly Goals.md`;
                const file = Bun.file(yearlyPath);
                const exists = await file.exists();
                if (!exists) return Response.json({ error: "File not found", path: yearlyPath });
                const content = await file.text();
                const lines = content.split("\n");
                const checkboxLines = lines
                    .map((l, i) => ({ i, l }))
                    .filter(({ l }) => /\[[ x]\]/.test(l) || /\\?\[/.test(l))
                    .slice(0, 20);
                const sectionHeaders = lines
                    .map((l, i) => ({ i, l }))
                    .filter(({ l }) => /^##/.test(l))
                    .slice(0, 20);
                return Response.json({
                    notesPath,
                    yearlyPath,
                    fileSize: content.length,
                    totalLines: lines.length,
                    sectionHeaders,
                    checkboxLines,
                    first200chars: content.substring(0, 200),
                });
            } catch (e) { return errorResponse(e, "goals/migration/debug"); }
        },
    },
};
