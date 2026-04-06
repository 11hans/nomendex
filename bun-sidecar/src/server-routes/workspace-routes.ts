import { z } from "zod";
import { Result, ErrorCodes } from "../types/Result";
import { WorkspaceState, WorkspaceStateSchema, WorkspaceTab } from "../types/Workspace";
import { getNomendexPath, getRootPath, getNotesPath, getTodosPath, getUploadsPath, getSkillsPath, hasActiveWorkspace, initializePaths } from "../storage/root-path";
import { initializeNotesService } from "@/features/notes/fx";
import path from "path";
import { copyFile, mkdir } from "node:fs/promises";
import { INBOX_PROJECT_NAME } from "@/features/projects/inbox-project";

const ThemeRequestSchema = z.object({
    themeName: z.string(),
});

const LEGACY_NO_PROJECT_PREFERENCE_KEY = "__none__";

function getWorkspaceMigrationMarkerPath(): string {
    return path.join(getNomendexPath(), "migrations", "workspace-inbox-consolidation-v1.done");
}

function remapLegacyTab(tab: WorkspaceTab): { tab: WorkspaceTab; changed: boolean } {
    const pluginId = tab.pluginInstance.plugin.id;
    const viewId = tab.pluginInstance.viewId;

    const isLegacyTodosProjectsTab = pluginId === "todos" && (viewId === "default" || viewId === "projects");
    if (!isLegacyTodosProjectsTab) {
        return { tab, changed: false };
    }

    return {
        tab: {
            ...tab,
            title: "Projects",
            pluginInstance: {
                ...tab.pluginInstance,
                plugin: {
                    id: "projects",
                    name: "Projects",
                    icon: "workflow",
                },
                viewId: "browser",
                instanceProps: {},
            },
        },
        changed: true,
    };
}

function normalizeWorkspaceStateForInboxConsolidation(workspace: WorkspaceState): {
    workspace: WorkspaceState;
    changed: boolean;
    remappedTabCount: number;
    migratedProjectPreference: boolean;
} {
    let changed = false;
    let remappedTabCount = 0;

    const migratedProjectPreference = Object.prototype.hasOwnProperty.call(workspace.projectPreferences, LEGACY_NO_PROJECT_PREFERENCE_KEY);
    const nextProjectPreferences = { ...workspace.projectPreferences };

    if (migratedProjectPreference) {
        const legacyPreference = nextProjectPreferences[LEGACY_NO_PROJECT_PREFERENCE_KEY];
        const inboxPreference = nextProjectPreferences[INBOX_PROJECT_NAME];
        nextProjectPreferences[INBOX_PROJECT_NAME] = {
            hideLaterColumn: Boolean(legacyPreference?.hideLaterColumn || inboxPreference?.hideLaterColumn),
            sortByDate: Boolean(legacyPreference?.sortByDate || inboxPreference?.sortByDate),
        };
        delete nextProjectPreferences[LEGACY_NO_PROJECT_PREFERENCE_KEY];
        changed = true;
    }

    const nextTabs = workspace.tabs.map((tab) => {
        const remapped = remapLegacyTab(tab);
        if (remapped.changed) {
            changed = true;
            remappedTabCount += 1;
        }
        return remapped.tab;
    });

    const nextPanes = workspace.panes.map((pane) => {
        let paneChanged = false;
        const remappedTabs = pane.tabs.map((tab) => {
            const remapped = remapLegacyTab(tab);
            if (remapped.changed) {
                paneChanged = true;
                changed = true;
                remappedTabCount += 1;
            }
            return remapped.tab;
        });

        return paneChanged
            ? { ...pane, tabs: remappedTabs }
            : pane;
    });

    if (!changed) {
        return {
            workspace,
            changed: false,
            remappedTabCount: 0,
            migratedProjectPreference: false,
        };
    }

    return {
        workspace: {
            ...workspace,
            projectPreferences: nextProjectPreferences,
            tabs: nextTabs,
            panes: nextPanes,
        },
        changed: true,
        remappedTabCount,
        migratedProjectPreference,
    };
}

async function migrateWorkspaceFileIfNeeded(workspace: WorkspaceState): Promise<WorkspaceState> {
    const normalized = normalizeWorkspaceStateForInboxConsolidation(workspace);
    const markerPath = getWorkspaceMigrationMarkerPath();
    const markerFile = Bun.file(markerPath);
    const markerExists = await markerFile.exists();

    if (!normalized.changed) {
        if (!markerExists) {
            await mkdir(path.dirname(markerPath), { recursive: true });
            await Bun.write(markerPath, JSON.stringify({
                migratedAt: new Date().toISOString(),
                remappedTabCount: 0,
                migratedProjectPreference: false,
                backupPath: null,
            }, null, 2));
        }
        return workspace;
    }

    const workspacePath = `${getNomendexPath()}/workspace.json`;
    let backupPath: string | null = null;

    if (!markerExists) {
        const backupDir = path.join(getNomendexPath(), "backups");
        await mkdir(backupDir, { recursive: true });
        backupPath = path.join(backupDir, `workspace-inbox-consolidation-v1-${Date.now()}.json`);
        await copyFile(workspacePath, backupPath);
    }

    await Bun.write(workspacePath, JSON.stringify(normalized.workspace, null, 2));

    await mkdir(path.dirname(markerPath), { recursive: true });
    await Bun.write(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        remappedTabCount: normalized.remappedTabCount,
        migratedProjectPreference: normalized.migratedProjectPreference,
        backupPath,
    }, null, 2));

    return normalized.workspace;
}

export const workspaceRoutes = {
    "/api/workspace": {
        async GET() {
            try {
                const file = Bun.file(`${getNomendexPath()}/workspace.json`);
                const exists = await file.exists();

                if (!exists) {
                    const defaultWorkspace: WorkspaceState = {
                        tabs: [],
                        activeTabId: null,
                        sidebarTabId: null,
                        sidebarOpen: false,
                        panes: [],
                        activePaneId: null,
                        splitRatio: 0.5,
                        layoutMode: "single",
                        mcpServerConfigs: [],
                        projectPreferences: {},
                        gitAuthMode: "local",
                        notesLocation: "root",
                        autoSync: { enabled: true, syncOnChanges: true, intervalSeconds: 60, paused: false },
                        chatInputEnterToSend: true,
                        showHiddenFiles: false,
                        todoViewPreferences: {},
                    };
                    await Bun.write(`${getNomendexPath()}/workspace.json`, JSON.stringify(defaultWorkspace, null, 2));

                    const response: Result<WorkspaceState> = {
                        success: true,
                        data: defaultWorkspace,
                    };
                    return Response.json(response);
                }

                const workspaceRaw = await file.json();
                const workspaceValidated = WorkspaceStateSchema.parse(workspaceRaw);
                const migratedWorkspace = await migrateWorkspaceFileIfNeeded(workspaceValidated);

                const response: Result<WorkspaceState> = {
                    success: true,
                    data: migratedWorkspace,
                };

                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to read workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },

        async POST(req: Request) {
            try {
                const workspace = await req.json();
                const workspaceValidated = WorkspaceStateSchema.parse(workspace);
                const normalizedWorkspace = normalizeWorkspaceStateForInboxConsolidation(workspaceValidated).workspace;
                await Bun.write(`${getNomendexPath()}/workspace.json`, JSON.stringify(normalizedWorkspace, null, 2));

                const response: Result<{ success: boolean }> = {
                    success: true,
                    data: { success: true },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to save workspace: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    "/api/theme": {
        async GET() {
            try {
                const file = Bun.file(`${getNomendexPath()}/theme.json`);
                const exists = await file.exists();

                if (!exists) {
                    const response: Result<{ themeName: string }> = {
                        success: true,
                        data: { themeName: "Light" },
                    };
                    return Response.json(response);
                }

                const themeData = await file.json();
                const themeName = ThemeRequestSchema.parse(themeData).themeName;

                const response: Result<{ themeName: string }> = {
                    success: true,
                    data: { themeName },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to read theme: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },

        async POST(req: Request) {
            try {
                const body = await req.json();
                const { themeName } = ThemeRequestSchema.parse(body);

                await Bun.write(`${getNomendexPath()}/theme.json`, JSON.stringify({ themeName }, null, 2));

                const response: Result<{ themeName: string }> = {
                    success: true,
                    data: { themeName },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to save theme: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    "/api/workspace/paths": {
        async GET() {
            try {
                if (!hasActiveWorkspace()) {
                    const response: Result = {
                        success: false,
                        code: ErrorCodes.NOT_FOUND,
                        message: "No active workspace configured",
                    };
                    return Response.json(response, { status: 404 });
                }

                const paths = {
                    root: getRootPath(),
                    notes: getNotesPath(),
                    todos: getTodosPath(),
                    uploads: getUploadsPath(),
                    skills: getSkillsPath(),
                };

                const response: Result<typeof paths> = {
                    success: true,
                    data: paths,
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to get workspace paths: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },

    "/api/workspace/reinitialize": {
        async POST() {
            try {
                await initializePaths();
                await initializeNotesService();
                const response: Result<{ success: boolean }> = {
                    success: true,
                    data: { success: true },
                };
                return Response.json(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const response: Result = {
                    success: false,
                    code: ErrorCodes.INTERNAL_SERVER_ERROR,
                    message: `Failed to reinitialize paths: ${message}`,
                    error,
                };
                return Response.json(response, { status: 500 });
            }
        },
    },
};
