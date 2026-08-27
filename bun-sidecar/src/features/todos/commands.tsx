import React from "react";
import { Command } from "@/types/Commands";
import { CreateTodoCommandDialog } from "./CreateTodoCommandDialog";
import { TimeblockingDialog } from "@/features/timeblocking/TimeblockingDialog";
import { todosPluginSerial } from "./index";
import { WorkspaceTab } from "@/types/Workspace";
import { SerializablePlugin } from "@/types/Plugin";
import { todosAPI } from "@/hooks/useTodosAPI";
import { syncTasksToCalendarBatch, purgeCalendarEvents, reconcileCalendar, removeTaskFromCalendar } from "./calendar-bridge";
import { toast } from "sonner";

interface CommandContext {
    openDialog: (config: { title?: string; description?: string; content?: React.ReactNode; width?: string; maxHeight?: string }) => void;
    closeDialog: () => void;
    closeCommandMenu: () => void;
    addNewTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    openTab: (tab: { pluginMeta: SerializablePlugin; view: string; props?: Record<string, unknown> }) => WorkspaceTab | null;
    setActiveTabId: (id: string) => void;
    closeTab: (id: string) => void;
    activeTab?: WorkspaceTab | null;
    navigate: (path: string) => void;
    currentPath: string;
}

export async function getTodosCommands(context: CommandContext): Promise<Command[]> {
    // Fetch available projects
    let projects: string[] = [];
    try {
        projects = await todosAPI.getProjects();
    } catch (error) {
        console.error("Failed to fetch projects for commands:", error);
        projects = [];
    }

    const baseCommands: Command[] = [
        {
            id: "todos.open",
            name: "Open Todos",
            description: "Open the all-project todos board",
            icon: "ListTodo",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: todosPluginSerial,
                    view: "browser",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "todos.openBrowser",
            name: "Open All Todos",
            description: "Open the todos browser view",
            icon: "ListChecks",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: todosPluginSerial,
                    view: "browser",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "todos.openProjects",
            name: "Open Projects",
            description: "Open the projects browser",
            icon: "FolderOpen",
            callback: () => {
                context.closeCommandMenu();
                context.openTab({
                    pluginMeta: {
                        id: "projects",
                        name: "Projects",
                        icon: "workflow",
                    },
                    view: "browser",
                    props: {},
                });

                // Navigate to workspace if not already there
                if (context.currentPath !== "/") {
                    context.navigate("/");
                }
            },
        },
        {
            id: "todos.create",
            name: "Create New Todo",
            description: "Create a new todo item",
            icon: "Plus",
            callback: () => {
                context.closeCommandMenu();
                context.openDialog({
                    content: <CreateTodoCommandDialog />,
                    width: '700px',
                    maxHeight: '90vh',
                });
            },
        },
        {
            id: "todos.timeblocking",
            name: "Plan Week (Timeblocking)",
            description: "Generate this week's timeblock events from your day templates",
            icon: "Calendar",
            callback: () => {
                context.closeCommandMenu();
                context.openDialog({
                    content: <TimeblockingDialog />,
                    width: '640px',
                    maxHeight: '85vh',
                });
            },
        },
        {
            id: "todos.syncCalendar",
            name: "Force Sync All to Calendar",
            description: "Sync all todos with dates to Apple Calendar (useful after import)",
            icon: "CalendarPlus",
            callback: async () => {
                context.closeCommandMenu();
                try {
                    toast.info("Fetching todos...");
                    const allTodos = await todosAPI.getTodos();
                    const toSync = allTodos.filter(t => t.scheduledStart || t.scheduledEnd);

                    if (toSync.length === 0) {
                        toast.info("No todos with dates found to sync.");
                        return;
                    }

                    // Wipe all Nomendex calendars first, then recreate from scratch
                    await purgeCalendarEvents();

                    toast.info(`Syncing ${toSync.length} items to calendar...`);

                    const result = await syncTasksToCalendarBatch(toSync);
                    if (!result) {
                        toast.error("Calendar sync unavailable or timed out.");
                        return;
                    }
                    toast.success(`Synced ${result.synced} items to Calendar.${result.failed ? ` ${result.failed} failed.` : ""}`);
                } catch (error) {
                    console.error("Sync failed", error);
                    toast.error("Failed to sync to calendar.");
                }
            },
        },
        {
            id: "todos.reconcileCalendar",
            name: "Reconcile Calendar",
            description: "Remove duplicate/orphaned calendar events and refresh live todos (non-destructive)",
            icon: "CheckCheck",
            callback: async () => {
                context.closeCommandMenu();
                try {
                    toast.info("Reconciling calendar...");
                    const result = await reconcileCalendar();
                    if (!result) {
                        toast.error("Calendar reconcile unavailable.");
                        return;
                    }

                    const allTodos = await todosAPI.getTodos();
                    const liveById = new Map(allTodos.map(t => [t.id, t]));

                    const orphanIds = result.taskIds.filter(id => !liveById.has(id));
                    for (const id of orphanIds) {
                        try { await removeTaskFromCalendar(id); } catch (e) { console.error("orphan remove failed", id, e); }
                    }

                    const toSync = allTodos.filter(t => t.scheduledStart || t.scheduledEnd);
                    const refresh = await syncTasksToCalendarBatch(toSync);

                    toast.success(
                        `Reconcile done: ${result.removed} duplicate(s) removed, ${orphanIds.length} orphan(s) cleared, ${refresh?.synced ?? 0} todo(s) refreshed.`
                    );
                } catch (error) {
                    console.error("Reconcile failed", error);
                    toast.error("Failed to reconcile calendar.");
                }
            },
        },
    ];

    // Add project-specific commands
    const projectCommands: Command[] = projects.map(project => ({
        id: `todos.openProject.${project}`,
        name: `Open Todos: ${project}`,
        description: `Open todos filtered by project "${project}"`,
        icon: "FolderOpen",
        callback: () => {
            context.closeCommandMenu();
            context.openTab({
                pluginMeta: todosPluginSerial,
                view: "browser",
                props: { project },
            });

            // Navigate to workspace if not already there
            if (context.currentPath !== "/") {
                context.navigate("/");
            }
        },
    }));

    return [...baseCommands, ...projectCommands];
}
