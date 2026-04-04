import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { Todo } from "./todo-types";
import { filterAndSortTodos, isTimeblockTodo } from "./todo-filter-utils";
import { createDefaultFilterState } from "./todo-filter-types";
import type { TodoFilterCriteria } from "./todo-filter-types";
import type { ProjectConfig } from "@/features/projects/project-types";
import { Input } from "@/components/ui/input";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { TodosBrowserView } from "./browser-view";
import {
    Inbox,
    ListTodo,
    Search,
} from "lucide-react";

type ProjectFilter = "all" | "active" | "completed" | "archived";
type SystemListId = "today" | "upcoming" | "overdue" | "no_due" | "waiting";

const ALL_PROJECTS = "__all__";
const WAITING_TAG = "waiting";

const BASE_BOARD_CRITERIA: TodoFilterCriteria = {
    statusBucket: "all",
    selectedTags: [],
    selectedPriority: null,
    dueFilter: "any",
    selectedProject: null,
    quickPreset: "none",
};

const BASE_SYSTEM_CRITERIA: TodoFilterCriteria = {
    ...BASE_BOARD_CRITERIA,
    statusBucket: "active",
};

const SYSTEM_LISTS: Array<{ id: SystemListId; label: string; criteria: TodoFilterCriteria }> = [
    {
        id: "today",
        label: "Today",
        criteria: { ...BASE_SYSTEM_CRITERIA, dueFilter: "today_or_overdue" },
    },
    {
        id: "upcoming",
        label: "Upcoming",
        criteria: { ...BASE_SYSTEM_CRITERIA, dueFilter: "next_7_days" },
    },
    {
        id: "overdue",
        label: "Overdue",
        criteria: { ...BASE_SYSTEM_CRITERIA, dueFilter: "overdue" },
    },
    {
        id: "no_due",
        label: "No Due Date",
        criteria: { ...BASE_SYSTEM_CRITERIA, dueFilter: "no_due" },
    },
    {
        id: "waiting",
        label: "Waiting",
        criteria: { ...BASE_SYSTEM_CRITERIA, selectedTags: [WAITING_TAG] },
    },
];

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

function SidebarSection({
    title,
    children,
    contentTertiary,
    borderDefault,
    sectionSurface,
}: {
    title: string;
    children: ReactNode;
    contentTertiary: string;
    borderDefault: string;
    sectionSurface: string;
}) {
    return (
        <section>
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: contentTertiary }}>
                {title}
            </div>
            <div
                className="rounded-lg border p-1.5 space-y-0.5"
                style={{
                    borderColor: borderDefault,
                    backgroundColor: sectionSurface,
                }}
            >
                {children}
            </div>
        </section>
    );
}

function SidebarItem({
    label,
    count,
    isSelected,
    onClick,
    leading,
    contentPrimary,
    contentTertiary,
    surfaceAccent,
    surfaceTertiary,
}: {
    label: string;
    count: number;
    isSelected: boolean;
    onClick: () => void;
    leading?: ReactNode;
    contentPrimary: string;
    contentTertiary: string;
    surfaceAccent: string;
    surfaceTertiary: string;
}) {
    return (
        <button
            onClick={onClick}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs rounded-md transition-colors hover:bg-surface-elevated"
            style={{
                backgroundColor: isSelected ? surfaceAccent : undefined,
                color: isSelected ? contentPrimary : contentTertiary,
            }}
        >
            {leading}
            <span className="truncate font-medium" style={{ color: isSelected ? contentPrimary : contentTertiary }}>
                {label}
            </span>
            <span
                className="ml-auto text-caption tabular-nums shrink-0 px-1.5 py-0.5 rounded-full"
                style={{
                    color: contentTertiary,
                    backgroundColor: isSelected ? surfaceAccent : surfaceTertiary,
                    opacity: count > 0 ? 1 : 0.65,
                }}
            >
                {count}
            </span>
        </button>
    );
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
    const [selectedSystemListId, setSelectedSystemListId] = useState<SystemListId | null>(null);
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

    useEffect(() => {
        const handleCalendarSync = () => {
            void loadData();
        };

        window.addEventListener("calendar-sync-update", handleCalendarSync);
        return () => {
            window.removeEventListener("calendar-sync-update", handleCalendarSync);
        };
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
            const trackedTodos = todos.filter((todo) => !isTimeblockTodo(todo));
            const activeTodos = trackedTodos.filter((todo) => !todo.archived);

            const todoCount = activeTodos.filter((todo) => todo.status === "todo").length;
            const laterCount = activeTodos.filter((todo) => todo.status === "later").length;
            const inProgressCount = activeTodos.filter((todo) => todo.status === "in_progress").length;
            const doneCount = activeTodos.filter((todo) => todo.status === "done").length;
            const archivedTodoCount = trackedTodos.filter((todo) => Boolean(todo.archived)).length;
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
                totalCount: trackedTodos.length,
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

    const projectItems = useMemo(
        () => filteredSidebarProjects.filter((project) => !project.isNoProject),
        [filteredSidebarProjects],
    );

    const inboxStats = useMemo(
        () => projectStats.find((project) => project.isNoProject),
        [projectStats],
    );

    const allActiveCount = useMemo(
        () => allTodos.filter((todo) => !todo.archived && todo.status !== "done" && !isTimeblockTodo(todo)).length,
        [allTodos],
    );

    const filterTodosWithCriteria = useCallback(
        (criteria: TodoFilterCriteria): Todo[] => {
            const state = createDefaultFilterState({
                ...criteria,
                searchQuery: "",
                sortMode: "urgency",
            });
            return filterAndSortTodos(allTodos, state);
        },
        [allTodos],
    );

    const systemListCounts = useMemo(() => {
        const counts: Record<SystemListId, number> = {
            today: 0,
            upcoming: 0,
            overdue: 0,
            no_due: 0,
            waiting: 0,
        };

        for (const systemList of SYSTEM_LISTS) {
            counts[systemList.id] = filterTodosWithCriteria(systemList.criteria).length;
        }

        return counts;
    }, [filterTodosWithCriteria]);

    const selectedSystemList = useMemo(
        () => SYSTEM_LISTS.find((item) => item.id === selectedSystemListId) ?? null,
        [selectedSystemListId],
    );

    const boardFilterCriteria = useMemo<TodoFilterCriteria>(() => {
        if (selectedSystemList) {
            return selectedSystemList.criteria;
        }

        if (selectedProjectKey === ALL_PROJECTS) {
            return BASE_BOARD_CRITERIA;
        }

        return {
            ...BASE_BOARD_CRITERIA,
            selectedProject: selectedProjectKey,
        };
    }, [selectedProjectKey, selectedSystemList]);

    const handleSelectProject = useCallback((projectKey: string) => {
        setSelectedSystemListId(null);
        setSelectedProjectKey(projectKey);
    }, []);

    const handleSelectSystemList = useCallback((systemListId: SystemListId) => {
        setSelectedSystemListId(systemListId);
        setSelectedProjectKey(ALL_PROJECTS);
    }, []);

    // Derive the project prop for TodosBrowserView
    // System list selection always runs across all projects.
    const boardProject = selectedSystemListId ? undefined : selectedProjectKey === ALL_PROJECTS ? undefined : selectedProjectKey;

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
                    <div className="shrink-0 px-2.5 pt-2.5 pb-1.5">
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

                    <div ref={listContainerRef} className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-2.5" tabIndex={0}>
                        <SidebarSection
                            title="Groups"
                            contentTertiary={styles.contentTertiary}
                            borderDefault={styles.borderDefault}
                            sectionSurface={styles.surfacePrimary}
                        >
                            <SidebarItem
                                label="All Tasks"
                                count={allActiveCount}
                                isSelected={selectedProjectKey === ALL_PROJECTS && !selectedSystemListId}
                                onClick={() => handleSelectProject(ALL_PROJECTS)}
                                leading={<ListTodo className="size-3.5 shrink-0" />}
                                contentPrimary={styles.contentPrimary}
                                contentTertiary={styles.contentTertiary}
                                surfaceAccent={styles.surfaceAccent}
                                surfaceTertiary={styles.surfaceTertiary}
                            />
                            <SidebarItem
                                label="Inbox"
                                count={(inboxStats?.todoCount ?? 0) + (inboxStats?.inProgressCount ?? 0)}
                                isSelected={selectedProjectKey === "" && !selectedSystemListId}
                                onClick={() => handleSelectProject("")}
                                leading={<Inbox className="size-3.5 shrink-0" />}
                                contentPrimary={styles.contentPrimary}
                                contentTertiary={styles.contentTertiary}
                                surfaceAccent={styles.surfaceAccent}
                                surfaceTertiary={styles.surfaceTertiary}
                            />
                        </SidebarSection>

                        <SidebarSection
                            title="System Lists"
                            contentTertiary={styles.contentTertiary}
                            borderDefault={styles.borderDefault}
                            sectionSurface={styles.surfacePrimary}
                        >
                            {SYSTEM_LISTS.map((systemList) => (
                                <SidebarItem
                                    key={systemList.id}
                                    label={systemList.label}
                                    count={systemListCounts[systemList.id]}
                                    isSelected={selectedSystemListId === systemList.id}
                                    onClick={() => handleSelectSystemList(systemList.id)}
                                    contentPrimary={styles.contentPrimary}
                                    contentTertiary={styles.contentTertiary}
                                    surfaceAccent={styles.surfaceAccent}
                                    surfaceTertiary={styles.surfaceTertiary}
                                />
                            ))}
                        </SidebarSection>

                        <SidebarSection
                            title="Projects"
                            contentTertiary={styles.contentTertiary}
                            borderDefault={styles.borderDefault}
                            sectionSurface={styles.surfacePrimary}
                        >
                            {projectItems.length === 0 && (
                                <div className="px-3 py-2 text-[10px]" style={{ color: styles.contentTertiary }}>
                                    no projects match filters
                                </div>
                            )}
                            {projectItems.map((project) => {
                                const isSelected = selectedProjectKey === project.projectKey && !selectedSystemListId;
                                const dotColor = project.color || styles.contentAccent;
                                const activeCount = project.todoCount + project.inProgressCount;

                                return (
                                    <button
                                        key={project.id}
                                        onClick={() => handleSelectProject(project.projectKey)}
                                        className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs rounded-md transition-colors hover:bg-surface-elevated"
                                        style={{
                                            backgroundColor: isSelected ? styles.surfaceAccent : undefined,
                                            color: isSelected ? styles.contentPrimary : styles.contentTertiary,
                                        }}
                                    >
                                        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
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
                                                backgroundColor: isSelected ? styles.surfaceAccent : styles.surfaceTertiary,
                                                opacity: activeCount > 0 ? 1 : 0.65,
                                            }}
                                        >
                                            {activeCount}
                                        </span>
                                    </button>
                                );
                            })}
                        </SidebarSection>
                    </div>
                </ResizablePanel>

                <ResizableHandle />

                {/* Right Panel — Kanban Board */}
                <ResizablePanel className="flex flex-col min-w-0 min-h-0">
                    <TodosBrowserView
                        key={`${selectedProjectKey}:${selectedSystemListId ?? "none"}`}
                        project={boardProject}
                        embedded
                        externalFilterCriteria={boardFilterCriteria}
                    />
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
