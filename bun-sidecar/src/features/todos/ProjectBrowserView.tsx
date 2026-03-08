import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { todosPluginSerial } from "./index";
import { Button } from "@/components/ui/button";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { Todo } from "./todo-types";
import type { ProjectConfig } from "@/features/projects/project-types";
import { Input } from "@/components/ui/input";
import { FolderKanban, Search, ChevronRight } from "lucide-react";

type ProjectFilter = "all" | "active" | "completed" | "archived";

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

function formatRelativeDateLabel(dateString?: string): string {
    if (!dateString) return "n/a";

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "n/a";

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const daysDiff = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

    if (daysDiff === 0) return "today";
    if (daysDiff === 1) return "yesterday";

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    const { replaceTabWithNewView, activeTabId } = useWorkspaceContext();
    const todosAPI = useTodosAPI();
    const projectsAPI = useProjectsAPI();
    const { currentTheme } = useTheme();

    const [projectConfigs, setProjectConfigs] = useState<ProjectConfig[]>([]);
    const [allTodos, setAllTodos] = useState<Todo[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState<ProjectFilter>("all");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listContainerRef = useRef<HTMLDivElement>(null);

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

    useEffect(() => {
        if (!loading && listContainerRef.current) {
            listContainerRef.current.focus();
        }
    }, [loading]);

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

    const openProject = useCallback(
        (project: ProjectStats) => {
            if (activeTabId) {
                replaceTabWithNewView(activeTabId, todosPluginSerial, {
                    view: "browser",
                    project: project.projectKey,
                });
            }
        },
        [activeTabId, replaceTabWithNewView]
    );

    const filteredProjects = useMemo(() => {
        let filtered = projectStats;

        if (searchQuery.trim()) {
            filtered = filtered.filter((project) =>
                fuzzySearch(searchQuery, project.name)
                || fuzzySearch(searchQuery, project.description)
                || fuzzySearch(searchQuery, project.projectKey)
            );
        }

        if (filter !== "all") {
            filtered = filtered.filter((project) => getFilterForProject(project) === filter);
        }

        return filtered;
    }, [projectStats, searchQuery, filter]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [searchQuery, filter]);

    useEffect(() => {
        if (selectedIndex < filteredProjects.length) return;
        setSelectedIndex(Math.max(filteredProjects.length - 1, 0));
    }, [filteredProjects, selectedIndex]);

    useEffect(() => {
        if (!listContainerRef.current) return;
        const selectedItem = listContainerRef.current.querySelector(`[data-index="${selectedIndex}"]`);
        if (selectedItem instanceof HTMLElement) {
            selectedItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [selectedIndex]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            // Don't handle keyboard events if a dialog is open
            if (document.querySelector('[role="dialog"]')) {
                return;
            }

            switch (e.key) {
                case "ArrowDown":
                case "j":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.min(prev + 1, Math.max(filteredProjects.length - 1, 0)));
                    break;
                case "ArrowUp":
                case "k":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    e.preventDefault();
                    if (filteredProjects[selectedIndex]) {
                        openProject(filteredProjects[selectedIndex]);
                    }
                    break;
            }
        },
        [filteredProjects, selectedIndex, openProject]
    );

    const counts = useMemo(() => ({
        all: projectStats.length,
        active: projectStats.filter((project) => getFilterForProject(project) === "active").length,
        completed: projectStats.filter((project) => getFilterForProject(project) === "completed").length,
        archived: projectStats.filter((project) => getFilterForProject(project) === "archived").length,
    }), [projectStats]);

    const totalTaskCount = useMemo(() => allTodos.length, [allTodos]);
    const totalOpenTasksCount = useMemo(
        () => allTodos.filter((todo) => !todo.archived && (todo.status === "todo" || todo.status === "later" || todo.status === "in_progress")).length,
        [allTodos]
    );

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-xs" style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentTertiary }}>
                loading projects...
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto" style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}>
            <div className="mx-auto w-full max-w-[620px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    <FolderKanban className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentPrimary }}>Projects</span>
                    <span className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                        {counts.all} items
                    </span>
                    <span className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                        {totalTaskCount} tasks
                    </span>
                    <span className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                        {totalOpenTasksCount} open
                    </span>
                    <div className="ml-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px] font-medium rounded-md"
                            onClick={() => {
                                if (activeTabId) {
                                    replaceTabWithNewView(activeTabId, todosPluginSerial, {
                                        view: "browser",
                                    });
                                }
                            }}
                        >
                            view all
                        </Button>
                    </div>
                </div>

                <div className="shrink-0 mt-2.5 flex items-center gap-1.5">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                        <Input
                            placeholder="search projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 pl-8 text-xs bg-transparent"
                            style={{ borderColor: currentTheme.styles.borderDefault, color: currentTheme.styles.contentPrimary }}
                        />
                    </div>

                    <div className="flex items-center gap-0.5">
                        {(["all", "active", "completed", "archived"] as const).map((value) => (
                            <button
                                key={value}
                                onClick={() => setFilter(value)}
                                className="h-7 rounded-md px-2 text-[10px] transition-colors"
                                style={filter === value ? {
                                    backgroundColor: currentTheme.styles.surfaceAccent,
                                    color: currentTheme.styles.contentPrimary,
                                } : {
                                    color: currentTheme.styles.contentTertiary,
                                }}
                            >
                                {value}
                                <span className="ml-1 opacity-70">{counts[value]}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div ref={listContainerRef} tabIndex={0} onKeyDown={handleKeyDown} className="mt-2.5 outline-none space-y-2 pb-2">
                    {filteredProjects.length === 0 && (
                        <div className="py-3 text-center text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                            no projects match current filters
                        </div>
                    )}

                    {filteredProjects.map((project, index) => {
                        const isSelected = index === selectedIndex;
                        const lastActivityLabel = formatRelativeDateLabel(project.lastActivityAt);
                        const updatedLabel = formatRelativeDateLabel(project.updatedAt);
                        const createdLabel = formatRelativeDateLabel(project.createdAt);
                        const description = project.description?.trim()
                            || (project.isNoProject
                                ? "Tasks without explicit project assignment."
                                : "No project description.");
                        const dotColor = project.color || (project.isNoProject
                            ? currentTheme.styles.contentTertiary
                            : currentTheme.styles.contentAccent);

                        return (
                            <div
                                key={project.id}
                                data-index={index}
                                className="overflow-hidden rounded-lg border transition-colors"
                                style={{
                                    borderColor: isSelected ? currentTheme.styles.surfaceAccent : currentTheme.styles.borderDefault,
                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                }}
                                onMouseEnter={() => setSelectedIndex(index)}
                            >
                                <button
                                    onClick={() => openProject(project)}
                                    className="w-full px-2.5 py-2 text-left"
                                    style={{
                                        backgroundColor: isSelected ? currentTheme.styles.surfaceAccent : "transparent",
                                    }}
                                >
                                    <div className="flex items-start gap-2">
                                        <span className="mt-[5px] size-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="truncate text-xs font-medium" style={{ color: currentTheme.styles.contentPrimary }}>
                                                    {project.name}
                                                </span>
                                                {project.isArchived && (
                                                    <span className="text-[9px] uppercase tracking-[0.08em]" style={{ color: currentTheme.styles.semanticDestructive }}>
                                                        archived
                                                    </span>
                                                )}
                                                <ChevronRight className="ml-auto size-3 opacity-60 shrink-0" style={{ color: currentTheme.styles.contentTertiary }} />
                                            </div>

                                            <div className="mt-0.5 text-[10px] truncate" style={{ color: currentTheme.styles.contentTertiary }}>
                                                {description}
                                            </div>

                                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                                                <span>{project.totalCount} tasks</span>
                                                <span>{project.inProgressCount} in progress</span>
                                                <span>{project.todoCount} todo</span>
                                                <span>{project.doneCount} done</span>
                                                {project.archivedTodoCount > 0 && <span>{project.archivedTodoCount} archived tasks</span>}
                                                {project.highPriorityCount > 0 && <span>{project.highPriorityCount} high priority</span>}
                                                {project.overdueCount > 0 && (
                                                    <span style={{ color: currentTheme.styles.semanticDestructive }}>
                                                        {project.overdueCount} overdue
                                                    </span>
                                                )}
                                            </div>

                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                                                <span>activity {lastActivityLabel}</span>
                                                {!project.isNoProject && <span>updated {updatedLabel}</span>}
                                                {!project.isNoProject && <span>created {createdLabel}</span>}
                                                {project.color && <span>color {project.color}</span>}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
