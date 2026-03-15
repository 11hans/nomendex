import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { Todo } from "./todo-types";
import type { ProjectConfig } from "@/features/projects/project-types";
import { Input } from "@/components/ui/input";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { TodosBrowserView } from "./browser-view";
import {
    FolderKanban,
    Inbox,
    ListTodo,
    Search,
} from "lucide-react";

type ProjectFilter = "all" | "active" | "completed" | "archived";

const ALL_PROJECTS = "__all__";

interface ProjectStats {
    id: string;
    name: string;
    projectKey: string;
    isNoProject?: boolean;
    isArchived: boolean;
    description?: string;
    color?: string;
    createdAt?: string;
    updatedAt?: string;
    lastActivityAt?: string;
    todoCount: number;
    laterCount: number;
    inProgressCount: number;
    doneCount: number;
    archivedTodoCount: number;
    highPriorityCount: number;
    overdueCount: number;
    totalCount: number;
}

const NO_PROJECT_ID = "__no_project__";
const NO_PROJECT_LABEL = "Inbox";
const INBOX_PROJECT_ALIAS = "inbox";

function normalizeProjectKey(project?: string): string {
    const trimmed = project?.trim() ?? "";
    if (!trimmed) return "";
    if (trimmed.toLowerCase() === INBOX_PROJECT_ALIAS) return "";
    return trimmed;
}

function fuzzySearch(query: string, text?: string): boolean {
    if (!query) return true;
    if (!text) return false;

    const q = query.toLowerCase();
    const t = text.toLowerCase();

    let qIdx = 0;
    let tIdx = 0;

    while (qIdx < q.length && tIdx < t.length) {
        if (q[qIdx] === t[tIdx]) {
            qIdx++;
        }
        tIdx++;
    }

    return qIdx === q.length;
}

function getFilterForProject(stats: ProjectStats): Exclude<ProjectFilter, "all"> {
    const hasOpen = stats.todoCount + stats.inProgressCount > 0;
    const hasOnlyArchivedTodos = stats.archivedTodoCount > 0 && stats.archivedTodoCount === stats.totalCount;
    const isCompleted = stats.doneCount > 0 && !hasOpen;

    if (stats.isArchived || hasOnlyArchivedTodos) return "archived";
    if (isCompleted) return "completed";
    return "active";
}

function sortProjects(a: ProjectStats, b: ProjectStats): number {
    if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;

    const activeA = a.todoCount + a.inProgressCount;
    const activeB = b.todoCount + b.inProgressCount;
    if (activeB !== activeA) return activeB - activeA;

    const lastA = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const lastB = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    if (lastB !== lastA) return lastB - lastA;

    return a.name.localeCompare(b.name);
}

export function ProjectBrowserView() {
    const { loading, setLoading } = usePlugin();
    const { activeTab, setTabName } = useWorkspaceContext();
    const todosAPI = useTodosAPI();
    const projectsAPI = useProjectsAPI();
    const { currentTheme } = useTheme();

    const [projectConfigs, setProjectConfigs] = useState<ProjectConfig[]>([]);
    const [allTodos, setAllTodos] = useState<Todo[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
    const [selectedProjectKey, setSelectedProjectKey] = useState<string>(ALL_PROJECTS);
    const hasSetTabNameRef = useRef<boolean>(false);
    const listContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (activeTab && activeTab.pluginInstance.plugin.id === "todos" && !hasSetTabNameRef.current) {
            setTabName(activeTab.id, "Todos");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab, setTabName]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [projects, activeTodos, archivedTodos] = await Promise.all([
                projectsAPI.listProjects({ includeArchived: true }),
                todosAPI.getTodos({}),
                todosAPI.getArchivedTodos({}).catch(() => []),
            ]);

            const normalizedActiveTodos = activeTodos.filter((todo) => !todo.archived);
            const normalizedArchivedTodos = archivedTodos.map((todo) => ({ ...todo, archived: true }));

            setProjectConfigs(projects);
            setAllTodos([...normalizedActiveTodos, ...normalizedArchivedTodos]);
        } catch (error) {
            console.error("Failed to load project browser data:", error);
        } finally {
            setLoading(false);
        }
    }, [projectsAPI, todosAPI, setLoading]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const projectStats: ProjectStats[] = useMemo(() => {
        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

        const normalizedConfigEntries = projectConfigs
            .map((config) => ({
                ...config,
                name: config.name.trim(),
            }))
            .filter((config) => config.name.length > 0);

        const inboxConfig = normalizedConfigEntries.find(
            (config) => config.name.toLowerCase() === INBOX_PROJECT_ALIAS
        );

        const regularProjectConfigs = normalizedConfigEntries.filter(
            (config) => config.name.toLowerCase() !== INBOX_PROJECT_ALIAS
        );

        const projectConfigByName = new Map<string, ProjectConfig>(
            regularProjectConfigs.map((config) => [config.name, config])
        );

        const todosByProject = allTodos.reduce<Map<string, Todo[]>>((acc, todo) => {
            const key = normalizeProjectKey(todo.project);
            const existing = acc.get(key);
            if (existing) {
                existing.push(todo);
            } else {
                acc.set(key, [todo]);
            }
            return acc;
        }, new Map());

        const buildStats = (name: string, projectKey: string, config?: ProjectConfig, isNoProject = false): ProjectStats => {
            const todos = todosByProject.get(projectKey) ?? [];
            const activeTodos = todos.filter((todo) => !todo.archived);

            const todoCount = activeTodos.filter((todo) => todo.status === "todo").length;
            const laterCount = activeTodos.filter((todo) => todo.status === "later").length;
            const inProgressCount = activeTodos.filter((todo) => todo.status === "in_progress").length;
            const doneCount = activeTodos.filter((todo) => todo.status === "done").length;
            const archivedTodoCount = todos.filter((todo) => Boolean(todo.archived)).length;
            const highPriorityCount = activeTodos.filter((todo) => todo.priority === "high" && todo.status !== "done").length;
            const overdueCount = activeTodos.filter((todo) => {
                if (!todo.dueDate || todo.status === "done") return false;
                const dueTime = new Date(todo.dueDate).getTime();
                if (Number.isNaN(dueTime)) return false;
                return dueTime < startOfToday;
            }).length;

            const todoActivityTimes = todos
                .map((todo) => new Date(todo.updatedAt).getTime())
                .filter((ts) => !Number.isNaN(ts));
            const configUpdatedAtTime = config?.updatedAt ? new Date(config.updatedAt).getTime() : 0;
            const latestTime = Math.max(configUpdatedAtTime || 0, ...todoActivityTimes);
            const lastActivityAt = latestTime > 0 ? new Date(latestTime).toISOString() : undefined;

            return {
                id: config?.id ?? (isNoProject ? NO_PROJECT_ID : `project:${projectKey}`),
                name,
                projectKey,
                isNoProject,
                isArchived: Boolean(config?.archived),
                description: config?.description,
                color: config?.color,
                createdAt: config?.createdAt,
                updatedAt: config?.updatedAt,
                lastActivityAt,
                todoCount: todoCount + laterCount,
                laterCount,
                inProgressCount,
                doneCount,
                archivedTodoCount,
                highPriorityCount,
                overdueCount,
                totalCount: todos.length,
            };
        };

        const noProjectStats = buildStats(
            NO_PROJECT_LABEL,
            "",
            inboxConfig,
            true
        );

        const projectNames = new Set<string>([
            ...regularProjectConfigs.map((config) => config.name),
            ...Array.from(todosByProject.keys()).filter((projectName) => projectName !== ""),
        ]);

        const projectStatsList = Array.from(projectNames).map((projectName) =>
            buildStats(projectName, projectName, projectConfigByName.get(projectName))
        );

        projectStatsList.sort(sortProjects);

        return [noProjectStats, ...projectStatsList];
    }, [projectConfigs, allTodos]);

    const filteredSidebarProjects = useMemo(() => {
        let filtered = projectStats;

        if (searchQuery.trim()) {
            filtered = filtered.filter((project) =>
                fuzzySearch(searchQuery, project.name)
                || fuzzySearch(searchQuery, project.description)
            );
        }

        if (projectFilter !== "all") {
            filtered = filtered.filter((project) => getFilterForProject(project) === projectFilter);
        }

        return filtered;
    }, [projectStats, searchQuery, projectFilter]);

    const projectFilterCounts = useMemo(() => ({
        all: projectStats.length,
        active: projectStats.filter((project) => getFilterForProject(project) === "active").length,
        completed: projectStats.filter((project) => getFilterForProject(project) === "completed").length,
        archived: projectStats.filter((project) => getFilterForProject(project) === "archived").length,
    }), [projectStats]);

    // Derive the project prop for TodosBrowserView
    // ALL_PROJECTS → no project filter (undefined), "" → Inbox/no-project, else → project name
    const boardProject = selectedProjectKey === ALL_PROJECTS ? undefined : selectedProjectKey;

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-xs" style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentTertiary }}>
                loading projects...
            </div>
        );
    }

    const { styles } = currentTheme;

    return (
        <div className="h-full flex flex-col" style={{ backgroundColor: styles.surfacePrimary, color: styles.contentPrimary }}>
            <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
                {/* Left Panel — Project Sidebar */}
                <ResizablePanel defaultSize={20} minSize={12} maxSize={35} className="flex flex-col min-h-0" style={{ backgroundColor: styles.surfaceSecondary }}>
                    {/* Search */}
                    <div className="shrink-0 p-2.5 pb-1.5">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3" style={{ color: styles.contentTertiary }} />
                            <Input
                                placeholder="search projects..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-8 pl-8 text-xs bg-transparent"
                                style={{ borderColor: styles.borderDefault, color: styles.contentPrimary }}
                            />
                        </div>
                    </div>

                    {/* Project filter buttons */}
                    <div className="shrink-0 px-2.5 pb-1.5 flex items-center gap-0.5">
                        {(["all", "active", "completed", "archived"] as const).map((value) => (
                            <button
                                key={value}
                                onClick={() => setProjectFilter(value)}
                                className="h-6 rounded-md px-1.5 text-[10px] transition-colors"
                                style={projectFilter === value ? {
                                    backgroundColor: styles.surfaceAccent,
                                    color: styles.contentPrimary,
                                } : {
                                    color: styles.contentTertiary,
                                }}
                            >
                                {value}
                                <span className="ml-0.5 opacity-70">{projectFilterCounts[value]}</span>
                            </button>
                        ))}
                    </div>

                    {/* All Tasks item */}
                    <div className="shrink-0 px-1.5 pb-0.5">
                        <button
                            onClick={() => setSelectedProjectKey(ALL_PROJECTS)}
                            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs rounded-md transition-colors"
                            style={{
                                backgroundColor: selectedProjectKey === ALL_PROJECTS ? styles.surfaceAccent : undefined,
                                color: selectedProjectKey === ALL_PROJECTS ? styles.contentPrimary : styles.contentTertiary,
                            }}
                        >
                            <ListTodo className="size-3.5 shrink-0" />
                            <span className="truncate font-medium">All Tasks</span>
                            <span
                                className="ml-auto text-caption tabular-nums shrink-0 px-1.5 py-0.5 rounded-full"
                                style={{
                                    color: styles.contentTertiary,
                                    backgroundColor: styles.surfaceAccent,
                                }}
                            >
                                {allTodos.filter((t) => !t.archived && t.status !== "done").length}
                            </span>
                        </button>
                    </div>

                    {/* Separator */}
                    <div className="shrink-0 mx-2.5 mb-1" style={{ borderTop: `1px solid ${styles.borderDefault}` }} />

                    {/* Projects list */}
                    <div ref={listContainerRef} className="flex-1 overflow-y-auto px-1.5 pb-2" tabIndex={0}>
                        {filteredSidebarProjects.length === 0 && (
                            <div className="px-3 py-2 text-[10px]" style={{ color: styles.contentTertiary }}>
                                no projects match filters
                            </div>
                        )}
                        {filteredSidebarProjects.map((project) => {
                            const isSelected = selectedProjectKey === project.projectKey;
                            const dotColor = project.color || (project.isNoProject
                                ? styles.contentTertiary
                                : styles.contentAccent);
                            const activeCount = project.todoCount + project.inProgressCount;

                            return (
                                <button
                                    key={project.id}
                                    onClick={() => setSelectedProjectKey(project.projectKey)}
                                    className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs rounded-md transition-colors"
                                    style={{
                                        backgroundColor: isSelected ? styles.surfaceAccent : undefined,
                                        color: isSelected ? styles.contentPrimary : styles.contentTertiary,
                                    }}
                                >
                                    {project.isNoProject
                                        ? <Inbox className="size-3.5 shrink-0" />
                                        : <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                                    }
                                    <span className="truncate font-medium" style={{ color: isSelected ? styles.contentPrimary : styles.contentTertiary }}>
                                        {project.name}
                                    </span>
                                    {project.isArchived && (
                                        <span className="text-[9px] uppercase tracking-[0.06em] opacity-60">arc</span>
                                    )}
                                    <span
                                        className="ml-auto text-caption tabular-nums shrink-0 px-1.5 py-0.5 rounded-full"
                                        style={{
                                            color: styles.contentTertiary,
                                            backgroundColor: activeCount > 0 ? styles.surfaceAccent : undefined,
                                        }}
                                    >
                                        {activeCount}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </ResizablePanel>

                <ResizableHandle />

                {/* Right Panel — Kanban Board */}
                <ResizablePanel className="flex flex-col min-w-0 min-h-0">
                    <TodosBrowserView
                        key={selectedProjectKey}
                        project={boardProject}
                        embedded
                    />
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
