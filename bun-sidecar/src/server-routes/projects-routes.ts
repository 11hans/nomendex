import {
    listProjects,
    getProject,
    getProjectByName,
    createProject,
    updateProject,
    deleteProject,
    getProjectStats,
    renameProject,
    getBoardConfig,
    saveBoardConfig,
} from "@/features/projects/fx";

function jsonError(error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error instanceof Error && "statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number")
        ? (error as { statusCode: number }).statusCode
        : 500;
    return Response.json({ error: message }, { status });
}

export const projectsRoutes = {
    "/api/projects/list": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await listProjects(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/get": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await getProject(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/get-by-name": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await getProjectByName(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/create": {
        async POST(req: Request) {
            // Only allow project creation from UI (has X-Nomendex-UI header)
            const isFromUI = req.headers.get("X-Nomendex-UI") === "true";
            if (!isFromUI) {
                return Response.json(
                    { error: "Project creation via API is disabled. To create a project, open the 'Projects' view from the sidebar and click 'New Project'." },
                    { status: 403 }
                );
            }

            try {
                const args = await req.json();
                const result = await createProject(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/update": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await updateProject(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/delete": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await deleteProject(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/ensure": {
        async POST(_req: Request) {
            return Response.json(
                { error: "Implicit project creation is disabled. To create a project, open the 'Projects' view from the sidebar and click 'New Project'." },
                { status: 403 }
            );
        },
    },
    "/api/projects/stats": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await getProjectStats(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/rename": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await renameProject(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/board/get": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await getBoardConfig(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }
        },
    },
    "/api/projects/board/save": {
        async POST(req: Request) {
            try {
                const args = await req.json();
                const result = await saveBoardConfig(args);
                return Response.json(result);
            } catch (error) {
                return jsonError(error);
            }

        },
    },
};
