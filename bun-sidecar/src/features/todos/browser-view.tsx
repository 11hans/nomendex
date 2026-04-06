import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, type ReactNode } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useGoalsAPI } from "@/hooks/useGoalsAPI";
import type { GoalRecord } from "@/features/goals/goal-types";
import { subscribe } from "@/lib/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertCircle, CheckCircle2, Clock, Calendar, Eye, EyeOff, MoreHorizontal, Archive, Plus, Settings, Circle, FileSearch } from "lucide-react";
import { toast } from "sonner";
import { TodoCard } from "./TodoCard";
import { CreateTodoDialog } from "./CreateTodoDialog";
import { TaskCardEditor } from "./TaskCardEditor";
import { Todo } from "./todo-types";
import { isEventTodo, isTaskTodo } from "./todo-kind-utils";
import { useTodoFilterState } from "./useTodoFilterState";
import { filterAndSortTodos, urgencyComparator } from "./todo-filter-utils";
import { buildTodoReorders } from "./todo-reorder";
import { getColumnIdForTodo } from "./todo-column-utils";
import { TodoFilterToolbar } from "./TodoFilterToolbar";
import type { TodoFilterCriteria } from "./todo-filter-types";
import { createDefaultFilterState } from "./todo-filter-types";
import { BoardConfig, BoardColumn, getDefaultColumns } from "@/features/projects/project-types";
import { BoardSettingsDialog } from "./BoardSettingsDialog";
import type { Attachment } from "@/types/attachments";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/hooks/useTheme";
import { canonicalizeTodoProject, INBOX_PROJECT_NAME } from "@/features/projects/inbox-project";
import {
    DndContext,
    DragCancelEvent,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    useDndContext,
} from "@dnd-kit/core";
import {
    SortableContext,
    verticalListSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import {
    useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const ALL_TODOS_GROUP = "__all__";
const WAITING_TAG = "waiting";

type SystemListId = "today" | "upcoming" | "overdue" | "no_due" | "waiting" | "events";

interface SystemListDefinition {
    id: SystemListId;
    label: string;
    criteria: TodoFilterCriteria;
    kindFilter?: Todo["kind"];
}

const BASE_SYSTEM_CRITERIA: TodoFilterCriteria = {
    statusBucket: "active",
    selectedTags: [],
    selectedPriority: null,
    dueFilter: "any",
    selectedProject: null,
    quickPreset: "none",
};

const SYSTEM_LISTS: SystemListDefinition[] = [
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
    {
        id: "events",
        label: "Events",
        criteria: { ...BASE_SYSTEM_CRITERIA },
        kindFilter: "event",
    },
];

function compareProjectGroupNames(a: string, b: string): number {
    if (a === INBOX_PROJECT_NAME && b !== INBOX_PROJECT_NAME) return -1;
    if (b === INBOX_PROJECT_NAME && a !== INBOX_PROJECT_NAME) return 1;
    return a.localeCompare(b);
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
        <section className="px-1.5">
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

function SidebarListItem({
    label,
    isSelected,
    count,
    onClick,
    contentPrimary,
    contentTertiary,
    surfaceAccent,
    surfaceTertiary,
}: {
    label: string;
    isSelected: boolean;
    count: number;
    onClick: () => void;
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

function DroppableProjectItem({
    groupName,
    label,
    isSelected,
    count,
    onClick,
    contentPrimary,
    contentTertiary,
    surfaceAccent,
    surfaceTertiary,
    borderDefault,
    isDragging,
}: {
    groupName: string;
    label: string;
    isSelected: boolean;
    count: number;
    onClick: () => void;
    contentPrimary: string;
    contentTertiary: string;
    surfaceAccent: string;
    surfaceTertiary: string;
    borderDefault: string;
    isDragging: boolean;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `project-group:${groupName}`,
    });

    return (
        <button
            ref={setNodeRef}
            onClick={onClick}
            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs rounded-md transition-colors hover:bg-surface-elevated"
            style={{
                backgroundColor: isOver
                    ? surfaceAccent
                    : isSelected
                        ? surfaceAccent
                        : undefined,
                color: isSelected ? contentPrimary : contentTertiary,
                outline: isOver ? `2px solid ${surfaceAccent}` : undefined,
                outlineOffset: isOver ? "-2px" : undefined,
                borderBottom: isDragging ? `1px dashed ${borderDefault}` : undefined,
            }}
        >
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

export function TodosBrowserView({
    project,
    selectedTodoId: initialSelectedTodoId,
    embedded,
    externalFilterCriteria,
    kindFilter,
}: {
    project?: string | null;
    selectedTodoId?: string | null;
    embedded?: boolean;
    externalFilterCriteria?: TodoFilterCriteria | null;
    kindFilter?: Todo["kind"];
} = {}) {
    // Support both 'project' and 'filterProject' prop names for backward compatibility
    const filterProject = project;
    const canonicalFilterProject = filterProject == null ? undefined : canonicalizeTodoProject(filterProject);
    const { loading, setLoading } = usePlugin();
    const { activeTab, activeTabId, setTabName, openTab, replaceTabWithNewView, getProjectPreferences, setProjectPreferences } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const isProjectScopedView = canonicalFilterProject !== undefined;
    const projectDisplayName = canonicalFilterProject;

    const todosAPI = useTodosAPI();
    const goalsAPI = useGoalsAPI();
    const [todos, setTodos] = useState<Todo[]>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const [sidebarSourceTodos, setSidebarSourceTodos] = useState<Todo[]>([]);
    const [sidebarProjectGroups, setSidebarProjectGroups] = useState<string[]>([INBOX_PROJECT_NAME]);
    const [sidebarGroupCounts, setSidebarGroupCounts] = useState<Record<string, number>>({
        [ALL_TODOS_GROUP]: 0,
        [INBOX_PROJECT_NAME]: 0,
    });
    const [activeSystemListId, setActiveSystemListId] = useState<SystemListId | null>(null);
    const [availableGoals, setAvailableGoals] = useState<GoalRecord[]>([]);
    const todoFilter = useTodoFilterState("browser", { defaultSortMode: "urgency" });
    const isManualSort = todoFilter.filterState.sortMode === "manual";
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const hasSetTabNameRef = useRef<boolean>(false);

    // Derive the project key for preferences storage:
    // - null/undefined => all-project board
    // - project value => canonical project key (Inbox included)
    const projectPreferencesKey = canonicalFilterProject ?? "__all__";
    const projectPrefs = getProjectPreferences(projectPreferencesKey);
    const showLaterColumn = !projectPrefs.hideLaterColumn;
    const [newTodo, setNewTodo] = useState<{
        title: string;
        description: string;
        project: string;
        kind: Todo["kind"];
        source: Todo["source"];
        status: "todo" | "in_progress" | "done" | "later";
        tags: string[];
        scheduledStart?: string;
        scheduledEnd?: string;
        dueDate?: string;
        priority?: "high" | "medium" | "low" | "none";
        attachments?: Attachment[];
        customColumnId?: string; // Add support for creating in specific column
        goalRefs?: string[];
    }>({
        title: "",
        description: "",
        project: canonicalFilterProject ?? INBOX_PROJECT_NAME,
        kind: "task",
        source: "user",
        status: "todo",
        tags: [],
        scheduledStart: undefined,
        scheduledEnd: undefined,
        dueDate: undefined,
        priority: undefined,
        attachments: undefined,
        customColumnId: undefined,
        goalRefs: undefined,
    });

    const resetNewTodoDraft = useCallback(() => {
        const projectValue = canonicalFilterProject ?? INBOX_PROJECT_NAME;
        setNewTodo({
            title: "",
            description: "",
            project: projectValue,
            kind: "task",
            source: "user",
            status: "todo",
            tags: [],
            scheduledStart: undefined,
            scheduledEnd: undefined,
            dueDate: undefined,
            priority: undefined,
            attachments: undefined,
            customColumnId: undefined,
            goalRefs: undefined,
        });
    }, [canonicalFilterProject]);

    const [boardConfig, setBoardConfig] = useState<BoardConfig | null>(null);
    const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);

    // Keyboard navigation state
    const [selectedTodoId, setSelectedTodoId] = useState<string | null>(initialSelectedTodoId ?? null);

    // Helper to open create dialog with specific status OR column
    const openCreateDialogWithStatus = useCallback((status: "todo" | "in_progress" | "done" | "later", columnId?: string) => {
        setNewTodo(prev => ({
            ...prev,
            kind: status === "todo" ? prev.kind : "task",
            source: "user",
            status,
            customColumnId: columnId,
        }));
        setCreateDialogOpen(true);
    }, []);

    // Drag and drop state
    const [draggedTodo, setDraggedTodo] = useState<Todo | null>(null);
    const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    useEffect(() => {
        if (!externalFilterCriteria) return;
        todoFilter.applyFilterCriteria(externalFilterCriteria, { clearSearch: true });
    }, [externalFilterCriteria, todoFilter.applyFilterCriteria]);

    const applyListCriteria = useCallback(
        (criteria: TodoFilterCriteria) => {
            todoFilter.applyFilterCriteria(criteria, { clearSearch: true });
        },
        [todoFilter.applyFilterCriteria],
    );

    const clearActiveSidebarListSelection = useCallback(() => {
        setActiveSystemListId(null);
    }, []);




    // Close all dialogs when tabs are being closed
    useEffect(() => {
        return subscribe("workspace:closeAllTabs", () => {
            setCreateDialogOpen(false);
            setEditDialogOpen(false);
        });
    }, []);

    // Toggle show/hide later column - persists to workspace.json
    const toggleShowLaterColumn = useCallback(() => {
        setProjectPreferences(projectPreferencesKey, { hideLaterColumn: !projectPrefs.hideLaterColumn });
    }, [setProjectPreferences, projectPreferencesKey, projectPrefs.hideLaterColumn]);

    // Update the tab name based on the project - only once when component mounts
    // Skip when embedded (parent manages tab name)
    useEffect(() => {
        if (embedded) return;
        if (activeTab && activeTab.pluginInstance.plugin.id === "todos" && !hasSetTabNameRef.current) {
            let tabName = "Todos";
            if (canonicalFilterProject) {
                tabName = canonicalFilterProject === INBOX_PROJECT_NAME
                    ? INBOX_PROJECT_NAME
                    : `Todos: ${canonicalFilterProject}`;
            }

            setTabName(activeTab.id, tabName);
            hasSetTabNameRef.current = true;
        }
    }, [activeTab, canonicalFilterProject, setTabName, embedded]); // Dependencies are fine since we check hasSetTabNameRef

    // Update the project field when filterProject changes
    useEffect(() => {
        const projectValue = canonicalFilterProject ?? INBOX_PROJECT_NAME;
        setNewTodo(prev => ({
            ...prev,
            project: projectValue
        }));
    }, [canonicalFilterProject]);

    // Load Board Config
    useEffect(() => {
        async function loadBoardConfig() {
            if (canonicalFilterProject === undefined) {
                setBoardConfig(null);
                return;
            }

            try {
                const config = await todosAPI.getBoardConfig({
                    projectName: canonicalFilterProject
                });
                setBoardConfig(config);
            } catch (error) {
                console.error("Failed to load board config:", error);
            }
        }
        loadBoardConfig();
    }, [canonicalFilterProject, todosAPI]);

    // Helper: Determine which column a todo belongs to.
    // IMPORTANT: This must be defined before handleDragEnd which uses it.
    //
    // Strict rule (custom board): column = first column (by order) whose status
    // matches todo.status. customColumnId is ignored for display placement.
    const getColumnForTodo = useCallback((todo: Todo): string => {
        if (boardConfig) {
            return getColumnIdForTodo(todo, boardConfig.columns);
        }
        // Legacy mode: column id equals status
        return todo.status;
    }, [boardConfig]);

    const loadTodos = useMemo(
        () => async () => {
            setLoading(true);
            try {
                const shouldLoadAllTodosForSidebar = !embedded && canonicalFilterProject !== undefined;

                const [todosData, tags, projects, projectsList, goals, allTodosForSidebar] = await Promise.all([
                    // Always load only active (non-archived) todos for the board itself
                    todosAPI.getTodos(canonicalFilterProject ? { project: canonicalFilterProject } : {}),
                    todosAPI.getTags().catch(() => []),
                    todosAPI.getProjects().catch(() => []),
                    !embedded ? todosAPI.getProjectsList().catch(() => []) : Promise.resolve([]),
                    goalsAPI.listGoals({ status: "active" }).catch(() => []),
                    shouldLoadAllTodosForSidebar ? todosAPI.getTodos({}) : Promise.resolve<Todo[] | null>(null),
                ]);

                // The getTodos API should already filter out archived items, but let's be explicit
                const activeTodos = todosData.filter(t => !t.archived);
                setTodos(activeTodos);
                setAvailableTags(tags);
                setAvailableGoals(goals);

                if (!embedded) {
                    const sidebarTodos = allTodosForSidebar ?? activeTodos;
                    setSidebarSourceTodos(sidebarTodos);
                    const projectsFromConfig = projectsList
                        .filter((project) => !project.archived)
                        .map((project) => project.name?.trim())
                        .filter((name): name is string => Boolean(name));
                    const projectsFromTodos = sidebarTodos.map((todo) => canonicalizeTodoProject(todo.project));
                    const normalizedProjects = projects.map((projectName) => canonicalizeTodoProject(projectName));
                    const mergedProjects = Array.from(
                        new Set([
                            INBOX_PROJECT_NAME,
                            ...(canonicalFilterProject ? [canonicalFilterProject] : []),
                            ...projectsFromConfig.map((name) => canonicalizeTodoProject(name)),
                            ...projectsFromTodos,
                            ...normalizedProjects,
                        ])
                    ).sort(compareProjectGroupNames);

                    const counts: Record<string, number> = {
                        [ALL_TODOS_GROUP]: 0,
                    };
                    for (const groupName of mergedProjects) {
                        counts[groupName] = 0;
                    }
                    for (const todo of sidebarTodos) {
                        if (todo.archived || !isTaskTodo(todo) || todo.status === "done") continue;
                        counts[ALL_TODOS_GROUP] = (counts[ALL_TODOS_GROUP] ?? 0) + 1;
                        const groupName = canonicalizeTodoProject(todo.project);
                        counts[groupName] = (counts[groupName] ?? 0) + 1;
                    }

                    setSidebarProjectGroups(mergedProjects);
                    setSidebarGroupCounts(counts);
                    setAvailableProjects(mergedProjects);
                } else {
                    setSidebarSourceTodos(activeTodos);
                    const normalizedProjects = Array.from(
                        new Set([
                            INBOX_PROJECT_NAME,
                            ...(canonicalFilterProject ? [canonicalFilterProject] : []),
                            ...projects.map((projectName) => canonicalizeTodoProject(projectName)),
                        ])
                    ).sort(compareProjectGroupNames);
                    setAvailableProjects(normalizedProjects);
                }
            } catch (error) {
                console.error("Failed to load todos:", error);
            } finally {
                setLoading(false);
            }
        },
        [canonicalFilterProject, embedded, goalsAPI, setLoading, todosAPI]
    );

    useEffect(() => {
        loadTodos();
    }, [loadTodos]);

    useEffect(() => {
        const handleCalendarSync = () => {
            console.log("Received calendar-sync-update event, reloading todos...");
            loadTodos();
        };

        window.addEventListener("calendar-sync-update", handleCalendarSync);
        return () => {
            window.removeEventListener("calendar-sync-update", handleCalendarSync);
        };
    }, [loadTodos, todosAPI]);

    async function createTodo() {
        if (!newTodo.title.trim()) return;

        setLoading(true);
        try {
            const createdTodo = await todosAPI.createTodo({
                title: newTodo.title,
                description: newTodo.description || undefined,
                project: newTodo.project || undefined,
                kind: newTodo.kind,
                source: newTodo.source,
                status: newTodo.status,
                tags: newTodo.tags.length > 0 ? newTodo.tags : undefined,
                scheduledStart: newTodo.scheduledStart ?? null,
                scheduledEnd: newTodo.scheduledEnd ?? null,
                dueDate: newTodo.dueDate,
                priority: newTodo.priority,
                attachments: newTodo.attachments,
                customColumnId: newTodo.customColumnId,
                goalRefs: newTodo.goalRefs,
            });

            resetNewTodoDraft();
            setCreateDialogOpen(false);
            await loadTodos();

            if (createdTodo?.id) {
                setSelectedTodoId(createdTodo.id);
            }
        } catch (error) {
            console.error("Failed to create todo:", error);
        } finally {
            setLoading(false);
        }
    }

    const handleOpenTodo = useCallback(async (todoId: string) => {
        const todo = todos.find((t) => t.id === todoId);
        if (todo) {
            setTodoToEdit(todo);
            setEditDialogOpen(true);
        }
    }, [todos]);

    const handleSaveTodo = async (updatedTodo: Todo) => {
        setEditSaving(true);
        try {
            // If status changed in custom board mode, sync customColumnId to the new status column
            let resolvedCustomColumnId = updatedTodo.customColumnId;
            if (boardConfig && todoToEdit && updatedTodo.status !== todoToEdit.status) {
                resolvedCustomColumnId = getColumnIdForTodo({ status: updatedTodo.status }, boardConfig.columns);
            }

            await todosAPI.updateTodo({
                todoId: updatedTodo.id,
                updates: {
                    title: updatedTodo.title,
                    description: updatedTodo.description,
                    kind: updatedTodo.kind,
                    status: updatedTodo.status,
                    project: updatedTodo.project,
                    tags: updatedTodo.tags,
                    scheduledStart: updatedTodo.scheduledStart ?? null,
                    scheduledEnd: updatedTodo.scheduledEnd ?? null,
                    dueDate: updatedTodo.dueDate ?? null,
                    priority: updatedTodo.priority,
                    duration: updatedTodo.duration ?? null,
                    attachments: updatedTodo.attachments,
                    customColumnId: resolvedCustomColumnId,
                    calendarReminderPreset: updatedTodo.calendarReminderPreset,
                    goalRefs: updatedTodo.goalRefs,
                },
            });
            setEditDialogOpen(false);
            setTodoToEdit(null);
            await loadTodos();
        } catch (error) {
            console.error("Failed to save todo:", error);
        } finally {
            setEditSaving(false);
        }
    };

    const handleToggleCalendarReminder = async (todo: Todo) => {
        try {
            const updated = await todosAPI.updateTodo({
                todoId: todo.id,
                updates: { calendarReminderPreset: todo.calendarReminderPreset },
            });
            if (updated) {
                setTodos((prev) => prev.map((item) =>
                    item.id === updated.id
                        ? { ...item, calendarReminderPreset: updated.calendarReminderPreset }
                        : item
                ));
                toast.success(
                    todo.calendarReminderPreset === "30-15"
                        ? "Calendar alerts set (30 + 15 min)"
                        : "Calendar alerts removed"
                );
            }
        } catch {
            toast.error("Failed to update calendar alerts");
        }
    };

    // Inline date change from kanban card (optimistic update + save)
    const handleInlineDateChange = useCallback(async (todo: Todo, dates: { scheduledStart?: string; scheduledEnd?: string }) => {
        const updatedTodo = {
            ...todo,
            scheduledStart: dates.scheduledStart,
            scheduledEnd: dates.scheduledEnd,
        };

        // Optimistic update
        setTodos(prev => prev.map(t => t.id === todo.id ? updatedTodo : t));

        try {
            await todosAPI.updateTodo({
                todoId: todo.id,
                updates: {
                    scheduledStart: dates.scheduledStart ?? null,
                    scheduledEnd: dates.scheduledEnd ?? null,
                },
            });
        } catch (error) {
            console.error("Failed to update todo date:", error);
            await loadTodos(); // Revert on error
        }
    }, [todosAPI, loadTodos]);

    const handleChecklistToggle = useCallback(async (todo: Todo, newDescription: string) => {
        // Optimistic update
        setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, description: newDescription } : t));

        try {
            await todosAPI.updateTodo({
                todoId: todo.id,
                updates: { description: newDescription },
            });
        } catch (error) {
            console.error("Failed to update checklist:", error);
            await loadTodos(); // Revert on error
        }
    }, [todosAPI, loadTodos]);

    const openArchivedView = () => {
        openTab({
            pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
            view: "archived",
            props: { project: canonicalFilterProject }
        });
    };

    const switchProjectBoard = useCallback((nextProject?: string) => {
        const canonicalNextProject = nextProject == null ? undefined : canonicalizeTodoProject(nextProject);
        if (canonicalNextProject === canonicalFilterProject) {
            return;
        }

        const nextProps: Record<string, unknown> = {};
        if (canonicalNextProject) {
            nextProps.project = canonicalNextProject;
        }

        if (activeTabId) {
            replaceTabWithNewView(activeTabId, { id: "todos", name: "Todos", icon: "list-todo" }, { view: "browser", ...nextProps });
            return;
        }

        openTab({
            pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
            view: "browser",
            props: nextProps,
        });
    }, [activeTabId, canonicalFilterProject, openTab, replaceTabWithNewView]);

    const handleSelectGroup = useCallback((groupName: string) => {
        setActiveSystemListId(null);
        if (groupName === ALL_TODOS_GROUP) {
            switchProjectBoard();
            return;
        }
        switchProjectBoard(groupName);
    }, [switchProjectBoard]);

    const handleSelectSystemList = useCallback((systemList: SystemListDefinition) => {
        setActiveSystemListId(systemList.id);
        applyListCriteria(systemList.criteria);
        switchProjectBoard();
    }, [applyListCriteria, switchProjectBoard]);

    const archiveAllDone = async () => {
        const doneTodos = todos.filter((todo) => isTaskTodo(todo) && todo.status === "done");
        if (doneTodos.length === 0) return;

        setLoading(true);
        try {
            await Promise.all(doneTodos.map(t => todosAPI.archiveTodo({ todoId: t.id })));
            await loadTodos();
        } catch (error) {
            console.error("Failed to archive done todos:", error);
        } finally {
            setLoading(false);
        }
    };

    const moveTodoToProject = useCallback(async (todo: Todo, targetGroupName: string) => {
        const currentProject = canonicalizeTodoProject(todo.project);
        const targetProject = canonicalizeTodoProject(targetGroupName);
        if (currentProject === targetProject) return;

        const now = new Date().toISOString();

        setSidebarProjectGroups((prev) => {
            if (prev.includes(targetProject)) return prev;
            return [...prev, targetProject].sort(compareProjectGroupNames);
        });

        setTodos((prev) =>
            prev.map((item) =>
                item.id === todo.id
                    ? { ...item, project: targetProject, updatedAt: now }
                    : item
            )
        );

        try {
            await todosAPI.updateTodo({
                todoId: todo.id,
                updates: { project: targetProject },
            });
            await loadTodos();
            toast.success(`Moved to ${targetProject}`);
        } catch (error) {
            console.error("Failed to move task to project:", error);
            setTodos((prev) =>
                prev.map((item) =>
                    item.id === todo.id
                        ? { ...item, project: todo.project, updatedAt: todo.updatedAt }
                        : item
                )
            );
            toast.error("Failed to move task");
        }
    }, [loadTodos, todosAPI]);

    // Drag and drop handlers
    const handleDragStart = useCallback((event: DragStartEvent) => {
        const todo = todos.find(t => t.id === event.active.id);
        setDraggedTodoId(String(event.active.id));
        setDraggedTodo(todo || null);
    }, [todos]);

    const handleDragCancel = useCallback((_event: DragCancelEvent) => {
        setDraggedTodo(null);
        setDraggedTodoId(null);
    }, []);

    const rejectEventStatusMove = useCallback(() => {
        toast.error("Events stay active. Move them by schedule or archive them.");
    }, []);

    const handleDragOver = useCallback((_event: DragOverEvent) => {
        // We handle drag over for cross-column drops
    }, []);

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;
        setDraggedTodo(null);
        setDraggedTodoId(null);

        if (!over) return;

        try {
            const activeId = active.id as string;
            const overId = over.id as string;

            if (overId.startsWith("project-group:")) {
                const targetGroupName = overId.substring("project-group:".length);
                const draggedTodo = todos.find((todo) => todo.id === activeId);
                if (!draggedTodo) return;
                await moveTodoToProject(draggedTodo, targetGroupName);
                return;
            }

            // Find the dragged todo
            const activeIndex = todos.findIndex(t => t.id === activeId);
            if (activeIndex === -1) return;

            const activeTodo = todos[activeIndex];
            if (!activeTodo) return;

            // Determine if this is a cross-column drop or same-column reorder
            if (overId.startsWith('column-')) {
                // Cross-column drop - change status or customColumnId depending on mode
                const newColumnId = overId.replace('column-', '');

                if (boardConfig) {
                    // Custom board mode - update customColumnId and optionally status
                    const currentColumnId = getColumnForTodo(activeTodo);
                    if (newColumnId !== currentColumnId) {
                        const targetColumnTodos = todos.filter(
                            (todo) => getColumnForTodo(todo) === newColumnId && todo.id !== activeId
                        );

                        // Determine target status: column's status, or "todo" for no-status columns
                        const targetColumn = boardConfig.columns.find(c => c.id === newColumnId);
                        const newStatus = targetColumn?.status ?? "todo";

                        if (isEventTodo(activeTodo) && newStatus !== "todo") {
                            rejectEventStatusMove();
                            return;
                        }

                        const reorders = buildTodoReorders([
                            ...targetColumnTodos,
                            {
                                ...activeTodo,
                                customColumnId: newColumnId,
                                status: newStatus,
                            },
                        ]);

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: {
                                    customColumnId: newColumnId,
                                    status: newStatus,
                                },
                            });
                            await todosAPI.reorderTodos({ reorders });
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to update todo column:", error);
                            await loadTodos();
                        }
                    }
                } else {
                    // Legacy mode - update status
                    const newStatus = newColumnId as "todo" | "in_progress" | "done" | "later";
                    if (newStatus !== activeTodo.status) {
                        const targetStatusTodos = todos.filter(
                            (todo) => todo.status === newStatus && todo.id !== activeId
                        );

                        if (isEventTodo(activeTodo) && newStatus !== "todo") {
                            rejectEventStatusMove();
                            return;
                        }

                        const reorders = buildTodoReorders([
                            ...targetStatusTodos,
                            { ...activeTodo, status: newStatus },
                        ]);

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: { status: newStatus },
                            });
                            await todosAPI.reorderTodos({ reorders });
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to update todo status:", error);
                            await loadTodos();
                        }
                    }
                }
            } else {
                // Dropping on a specific card - either same column reorder or cross-column with position
                const overIndex = todos.findIndex(t => t.id === overId);
                if (overIndex === -1) return;

                const overTodo = todos[overIndex];
                if (!overTodo) return;

                // Determine cross-column based on mode
                const activeColumnId = getColumnForTodo(activeTodo);
                const overColumnId = getColumnForTodo(overTodo);
                const isCrossColumn = activeColumnId !== overColumnId;

                if (isCrossColumn) {
                    // Cross-column drop onto a specific card
                    if (boardConfig) {
                        // Custom board mode - update customColumnId and position
                        const targetColumnTodos = todos.filter(
                            (todo) => getColumnForTodo(todo) === overColumnId && todo.id !== activeId
                        );
                        const overIndexInColumn = targetColumnTodos.findIndex(t => t.id === overId);
                        const insertIndex = overIndexInColumn === -1 ? targetColumnTodos.length : overIndexInColumn;

                        // Determine target status: column's status, or "todo" for no-status columns
                        const targetColumn = boardConfig.columns.find(c => c.id === overColumnId);
                        const newStatus = targetColumn?.status ?? "todo";

                        if (isEventTodo(activeTodo) && newStatus !== "todo") {
                            rejectEventStatusMove();
                            return;
                        }

                        const reorderedColumnTodos = [...targetColumnTodos];
                        reorderedColumnTodos.splice(insertIndex, 0, {
                            ...activeTodo,
                            customColumnId: overColumnId,
                            status: newStatus,
                        });
                        const reorders = buildTodoReorders(reorderedColumnTodos);

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: {
                                    customColumnId: overColumnId,
                                    status: newStatus,
                                },
                            });
                            await todosAPI.reorderTodos({ reorders });
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to move todo:", error);
                            await loadTodos();
                        }
                    } else {
                        // Legacy mode - update status AND position
                        const targetStatus = overTodo.status;
                        if (isEventTodo(activeTodo) && targetStatus !== "todo") {
                            rejectEventStatusMove();
                            return;
                        }
                        const targetColumnTodos = todos.filter(
                            (todo) => todo.status === targetStatus && todo.id !== activeId
                        );
                        const overIndexInColumn = targetColumnTodos.findIndex(t => t.id === overId);
                        const insertIndex = overIndexInColumn === -1 ? targetColumnTodos.length : overIndexInColumn;
                        const reorderedColumnTodos = [...targetColumnTodos];
                        reorderedColumnTodos.splice(insertIndex, 0, {
                            ...activeTodo,
                            status: targetStatus,
                        });
                        const reorders = buildTodoReorders(reorderedColumnTodos);

                        try {
                            await todosAPI.updateTodo({
                                todoId: activeId,
                                updates: { status: targetStatus },
                            });
                            await todosAPI.reorderTodos({ reorders });
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to move todo:", error);
                            await loadTodos();
                        }
                    }
                } else {
                    // Same column reorder - only in manual sort mode
                    if (isManualSort && activeIndex !== overIndex) {
                        const columnTodos = todos.filter((todo) => getColumnForTodo(todo) === activeColumnId);
                        const sourceIndex = columnTodos.findIndex((todo) => todo.id === activeId);
                        const targetIndex = columnTodos.findIndex((todo) => todo.id === overId);
                        if (sourceIndex === -1 || targetIndex === -1) {
                            return;
                        }
                        const reorderedTodos = arrayMove(columnTodos, sourceIndex, targetIndex);
                        const reorders = buildTodoReorders(reorderedTodos);

                        try {
                            await todosAPI.reorderTodos({ reorders });
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to reorder todos:", error);
                            await loadTodos();
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error in drag end handler:", error);
            await loadTodos();
        }
    }, [todos, moveTodoToProject, todosAPI, loadTodos, boardConfig, getColumnForTodo, isManualSort, rejectEventStatusMove]);

    // Convenience
    // --- Dynamic Columns Logic ---

    const displayColumns = useMemo<BoardColumn[]>(() => {
        if (boardConfig) {
            // Custom mode
            const cols = [...boardConfig.columns].sort((a, b) => a.order - b.order);
            // We don't filter out done/later here; the user configures them.
            // But if user wants to hide "Done" or something, that might be future work.
            // For now, if "showDone" is false in config, maybe filter? 
            // The spec says "showDone" preference.
            // But custom columns are flexible. 
            // Let's assume all configured columns are shown for now.
            return cols;
        } else {
            // Legacy mode
            const cols: BoardColumn[] = [
                { id: "todo", title: "To Do", order: 1 },
                { id: "in_progress", title: "In Progress", order: 2 },
                { id: "done", title: "Done", order: 3 },
            ];
            if (showLaterColumn) {
                cols.unshift({ id: "later", title: "Later", order: 0 });
            }
            return cols.sort((a, b) => a.order - b.order);
        }
    }, [boardConfig, showLaterColumn]);

    const activeSystemList = useMemo(
        () => (activeSystemListId ? SYSTEM_LISTS.find((item) => item.id === activeSystemListId) ?? null : null),
        [activeSystemListId]
    );

    const effectiveKindFilter = kindFilter ?? activeSystemList?.kindFilter;

    const kindScopedTodos = useMemo(() => {
        if (!effectiveKindFilter) return todos;
        return todos.filter((todo) => todo.kind === effectiveKindFilter);
    }, [todos, effectiveKindFilter]);

    const todosByColumn = useMemo(() => {
        // Filter todos using shared pipeline (skip status filter since columns handle it)
        const filteredTodos = filterAndSortTodos(kindScopedTodos, todoFilter.filterState, { skipStatusFilter: true });

        // Group by column
        const grouped: Record<string, Todo[]> = {};
        displayColumns.forEach(col => {
            grouped[col.id] = [];
        });

        filteredTodos.forEach(todo => {
            const colId = getColumnForTodo(todo);
            if (grouped[colId]) {
                grouped[colId].push(todo);
            } else {
                if (grouped['todo']) grouped['todo'].push(todo);
            }
        });

        // Sort within columns: urgency mode uses urgencyComparator, manual uses layout order from API
        if (!isManualSort) {
            for (const colId of Object.keys(grouped)) {
                grouped[colId].sort(urgencyComparator);
            }
        }

        return grouped;
    }, [kindScopedTodos, todoFilter.filterState, displayColumns, getColumnForTodo, isManualSort]);


    // Flattened list of all visible todos for keyboard navigation
    const flattenedTodos = useMemo(() => {
        const order: Todo[] = [];
        for (const col of displayColumns) {
            order.push(...(todosByColumn[col.id] || []));
        }
        return order;
    }, [todosByColumn, displayColumns]);

    const boardCounts = useMemo(() => {
        const actionableTodos = effectiveKindFilter === "event"
            ? kindScopedTodos
            : kindScopedTodos.filter((todo) => isTaskTodo(todo));
        return {
            all: actionableTodos.length,
            todo: actionableTodos.filter((todo) => todo.status === "todo" || todo.status === "later").length,
            inProgress: actionableTodos.filter((todo) => todo.status === "in_progress").length,
            done: actionableTodos.filter((todo) => todo.status === "done").length,
        };
    }, [kindScopedTodos, effectiveKindFilter]);

    const headerStats = useMemo(() => {
        const entityLabel = effectiveKindFilter === "event" ? "events" : "tasks";
        const stats: Array<{ key: string; label: string; value: number }> = [
            { key: "all", label: entityLabel, value: boardCounts.all },
            { key: "todo", label: "todo", value: boardCounts.todo },
            { key: "visible", label: "visible", value: flattenedTodos.length },
        ];

        if (boardCounts.inProgress > 0) {
            stats.splice(2, 0, { key: "inProgress", label: "in progress", value: boardCounts.inProgress });
        }
        if (boardCounts.done > 0) {
            stats.splice(stats.length - 1, 0, { key: "done", label: "done", value: boardCounts.done });
        }

        return stats;
    }, [boardCounts, flattenedTodos.length, effectiveKindFilter]);

    const sidebarProjects = useMemo(() => {
        return sidebarProjectGroups.filter((projectName) => projectName !== INBOX_PROJECT_NAME);
    }, [sidebarProjectGroups]);

    const filterTodosWithCriteria = useCallback(
        (
            sourceTodos: Todo[],
            criteria: TodoFilterCriteria,
            criteriaKindFilter?: Todo["kind"],
        ): Todo[] => {
            const baseState = createDefaultFilterState({
                ...criteria,
                searchQuery: "",
                sortMode: todoFilter.filterState.sortMode,
            });
            const filtered = filterAndSortTodos(sourceTodos, baseState);
            if (!criteriaKindFilter) return filtered;
            return filtered.filter((todo) => todo.kind === criteriaKindFilter);
        },
        [todoFilter.filterState.sortMode],
    );

    const systemListCounts = useMemo(() => {
        const counts: Record<SystemListId, number> = {
            today: 0,
            upcoming: 0,
            overdue: 0,
            no_due: 0,
            waiting: 0,
            events: 0,
        };

        for (const systemList of SYSTEM_LISTS) {
            counts[systemList.id] = filterTodosWithCriteria(sidebarSourceTodos, systemList.criteria, systemList.kindFilter).length;
        }

        return counts;
    }, [filterTodosWithCriteria, sidebarSourceTodos]);

    // Get column and index for a given todo
    const getTodoPosition = useCallback((todoId: string | null): { columnId: string; index: number } | null => {
        if (!todoId) return null;
        for (const col of displayColumns) {
            const index = (todosByColumn[col.id] || []).findIndex(t => t.id === todoId);
            if (index !== -1) {
                return { columnId: col.id, index };
            }
        }
        return null;
    }, [displayColumns, todosByColumn]);

    // Shared delete function with optimistic update and toast (no confirmation dialog)
    const deleteTodoWithToast = useCallback(async (todo: Todo) => {
        // Find next item to select if this todo is currently selected
        let nextSelectedId: string | null = null;
        if (selectedTodoId === todo.id) {
            const pos = getTodoPosition(todo.id);
            if (pos) {
                const columnTodos = todosByColumn[pos.columnId];
                if (columnTodos.length > 1) {
                    const nextIndex = pos.index < columnTodos.length - 1 ? pos.index + 1 : pos.index - 1;
                    nextSelectedId = columnTodos[nextIndex]?.id ?? null;
                }
            }
        }

        // Optimistic update - remove from list
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        if (selectedTodoId === todo.id) {
            setSelectedTodoId(nextSelectedId);
        }

        try {
            await todosAPI.deleteTodo({ todoId: todo.id });

            const truncatedTitle = todo.title.length > 30
                ? todo.title.slice(0, 30) + "…"
                : todo.title;
            toast(`Deleted "${truncatedTitle}"`, {
                action: {
                    label: "Undo",
                    onClick: async () => {
                        try {
                            // Recreate the todo
                            await todosAPI.createTodo({
                                title: todo.title,
                                description: todo.description,
                                kind: todo.kind,
                                source: todo.source,
                                status: todo.status,
                                project: todo.project,
                                tags: todo.tags,
                                scheduledStart: todo.scheduledStart ?? null,
                                scheduledEnd: todo.scheduledEnd ?? null,
                                dueDate: todo.dueDate,
                                priority: todo.priority,
                                attachments: todo.attachments,
                            });
                            await loadTodos();
                            toast.success("Restored");
                        } catch (error) {
                            console.error("Failed to restore:", error);
                            toast.error("Failed to restore");
                        }
                    },
                },
            });
        } catch (error) {
            console.error("Failed to delete todo:", error);
            toast.error("Failed to delete");
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos]);

    // Shared archive function with optimistic update and toast
    const archiveTodoWithToast = useCallback(async (todo: Todo) => {
        // Find next item to select if this todo is currently selected
        let nextSelectedId: string | null = null;
        if (selectedTodoId === todo.id) {
            const pos = getTodoPosition(todo.id);
            if (pos) {
                const columnTodos = todosByColumn[pos.columnId];
                if (columnTodos.length > 1) {
                    const nextIndex = pos.index < columnTodos.length - 1 ? pos.index + 1 : pos.index - 1;
                    nextSelectedId = columnTodos[nextIndex]?.id ?? null;
                }
            }
        }

        // Optimistic update - remove from list
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        if (selectedTodoId === todo.id) {
            setSelectedTodoId(nextSelectedId);
        }

        try {
            await todosAPI.archiveTodo({ todoId: todo.id });

            const truncatedTitle = todo.title.length > 30
                ? todo.title.slice(0, 30) + "…"
                : todo.title;
            toast(`Archived "${truncatedTitle}"`, {
                action: {
                    label: "Undo",
                    onClick: async () => {
                        try {
                            await todosAPI.unarchiveTodo({ todoId: todo.id });
                            await loadTodos();
                            setSelectedTodoId(todo.id);
                            toast.success("Restored");
                        } catch (error) {
                            console.error("Failed to unarchive:", error);
                            toast.error("Failed to restore");
                        }
                    },
                },
            });
        } catch (error) {
            console.error("Failed to archive todo:", error);
            toast.error("Failed to archive");
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos]);

    // Toggle done status and move to matching column if in custom board mode
    const toggleDoneWithToast = useCallback(async (todo: Todo) => {
        if (isEventTodo(todo)) {
            toast.error("Events stay active. Archive them when they are over.");
            return;
        }

        const newStatus = todo.status === "done" ? "todo" : "done";

        // Find target column with matching status (if in custom board mode)
        const newColumnId = boardConfig
            ? getColumnIdForTodo({ status: newStatus }, boardConfig.columns)
            : undefined;

        // Optimistic update
        setTodos(prev => prev.map(t =>
            t.id === todo.id
                ? { ...t, status: newStatus, ...(newColumnId && { customColumnId: newColumnId }) }
                : t
        ));

        try {
            await todosAPI.updateTodo({
                todoId: todo.id,
                updates: {
                    status: newStatus,
                    ...(newColumnId && { customColumnId: newColumnId }),
                },
            });
        } catch (error) {
            console.error("Failed to toggle todo status:", error);
            const message = error instanceof Error ? error.message : "Failed to update status";
            toast.error(message);
            await loadTodos();
        }
    }, [todosAPI, loadTodos, boardConfig]);

    // Update selection when filtered todos change
    useEffect(() => {
        if (flattenedTodos.length > 0) {
            // If current selection is not in list, select first item
            if (!selectedTodoId || !flattenedTodos.find(t => t.id === selectedTodoId)) {
                setSelectedTodoId(flattenedTodos[0].id);
            }
        } else {
            setSelectedTodoId(null);
        }
    }, [flattenedTodos, selectedTodoId]);


    // Navigation handlers - column-based
    const navigateDown = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            // No selection, select first todo in first non-empty column
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const columnTodos = todosByColumn[pos.columnId];
        if (pos.index < columnTodos.length - 1) {
            // Move down within column
            setSelectedTodoId(columnTodos[pos.index + 1].id);
        }
        // At bottom of column, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, todosByColumn]);

    const navigateUp = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const columnTodos = todosByColumn[pos.columnId];
        if (pos.index > 0) {
            // Move up within column
            setSelectedTodoId(columnTodos[pos.index - 1].id);
        }
        // At top of column, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, todosByColumn]);

    const navigateRight = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        // Find next column with items
        for (let i = currentColIndex + 1; i < displayColumns.length; i++) {
            const nextCol = displayColumns[i];
            const nextColTodos = todosByColumn[nextCol.id];
            if (nextColTodos.length > 0) {
                // Select same row index or last item if column is shorter
                const targetIndex = Math.min(pos.index, nextColTodos.length - 1);
                setSelectedTodoId(nextColTodos[targetIndex].id);
                return;
            }
        }
        // No column to the right with items, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, displayColumns, todosByColumn]);

    const navigateLeft = useCallback(() => {
        if (flattenedTodos.length === 0) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) {
            setSelectedTodoId(flattenedTodos[0].id);
            return;
        }
        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        // Find previous column with items
        for (let i = currentColIndex - 1; i >= 0; i--) {
            const prevCol = displayColumns[i];
            const prevColTodos = todosByColumn[prevCol.id];
            if (prevColTodos.length > 0) {
                // Select same row index or last item if column is shorter
                const targetIndex = Math.min(pos.index, prevColTodos.length - 1);
                setSelectedTodoId(prevColTodos[targetIndex].id);
                return;
            }
        }
        // No column to the left with items, stay put
    }, [flattenedTodos, selectedTodoId, getTodoPosition, displayColumns, todosByColumn]);

    const openSelectedTodo = useCallback(() => {
        if (selectedTodoId) {
            handleOpenTodo(selectedTodoId);
        }
    }, [selectedTodoId, handleOpenTodo]);

    // Move handlers - reorder with Shift+Arrow (only in manual sort mode)
    const moveUp = useCallback(async () => {
        if (!selectedTodoId || !isManualSort) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos || pos.index === 0) return; // Can't move up if at top

        const columnTodos = todosByColumn[pos.columnId];
        const reorderedTodos = arrayMove(columnTodos, pos.index, pos.index - 1);
        const reorders = buildTodoReorders(reorderedTodos);

        try {
            await todosAPI.reorderTodos({ reorders });
            await loadTodos();
        } catch (error) {
            console.error("Failed to reorder todos:", error);
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos, isManualSort]);

    const moveDown = useCallback(async () => {
        if (!selectedTodoId || !isManualSort) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) return;

        const columnTodos = todosByColumn[pos.columnId];
        if (pos.index >= columnTodos.length - 1) return; // Can't move down if at bottom

        const reorderedTodos = arrayMove(columnTodos, pos.index, pos.index + 1);
        const reorders = buildTodoReorders(reorderedTodos);

        try {
            await todosAPI.reorderTodos({ reorders });
            await loadTodos();
        } catch (error) {
            console.error("Failed to reorder todos:", error);
            await loadTodos();
        }
    }, [selectedTodoId, getTodoPosition, todosByColumn, todosAPI, loadTodos, isManualSort]);

    const moveRight = useCallback(async () => {
        if (!selectedTodoId) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) return;
        const selectedTodo = todos.find((todo) => todo.id === selectedTodoId);
        if (!selectedTodo) return;

        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        if (currentColIndex >= displayColumns.length - 1) return; // Can't move right if at rightmost

        const nextCol = displayColumns[currentColIndex + 1];

        // Optimistic update
        // Logic depends on column type: legacy status vs custom column
        if (boardConfig) {
            // Custom mode - change customColumnId and status (fallback to "todo" for no-status columns)
            const newStatus = nextCol.status ?? "todo";
            if (isEventTodo(selectedTodo) && newStatus !== "todo") {
                rejectEventStatusMove();
                return;
            }
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId
                    ? { ...t, customColumnId: nextCol.id, status: newStatus }
                    : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: {
                        customColumnId: nextCol.id,
                        status: newStatus,
                    },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        } else {
            // Legacy mode - change status
            const newStatus = nextCol.id as "todo" | "in_progress" | "done" | "later";
            if (isEventTodo(selectedTodo) && newStatus !== "todo") {
                rejectEventStatusMove();
                return;
            }
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId ? { ...t, status: newStatus } : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: { status: newStatus },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        }
    }, [selectedTodoId, getTodoPosition, displayColumns, todos, todosAPI, loadTodos, boardConfig, rejectEventStatusMove]);

    const moveLeft = useCallback(async () => {
        if (!selectedTodoId) return;
        const pos = getTodoPosition(selectedTodoId);
        if (!pos) return;
        const selectedTodo = todos.find((todo) => todo.id === selectedTodoId);
        if (!selectedTodo) return;

        const currentColIndex = displayColumns.findIndex(c => c.id === pos.columnId);
        if (currentColIndex <= 0) return; // Can't move left if at leftmost

        const prevCol = displayColumns[currentColIndex - 1];

        // Optimistic update
        if (boardConfig) {
            // Custom mode - change customColumnId and status (fallback to "todo" for no-status columns)
            const newStatus = prevCol.status ?? "todo";
            if (isEventTodo(selectedTodo) && newStatus !== "todo") {
                rejectEventStatusMove();
                return;
            }
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId
                    ? { ...t, customColumnId: prevCol.id, status: newStatus }
                    : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: {
                        customColumnId: prevCol.id,
                        status: newStatus,
                    },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        } else {
            // Legacy mode - change status
            const newStatus = prevCol.id as "todo" | "in_progress" | "done" | "later";
            if (isEventTodo(selectedTodo) && newStatus !== "todo") {
                rejectEventStatusMove();
                return;
            }
            setTodos(prev => prev.map(t =>
                t.id === selectedTodoId ? { ...t, status: newStatus } : t
            ));
            try {
                await todosAPI.updateTodo({
                    todoId: selectedTodoId,
                    updates: { status: newStatus },
                });
            } catch (error) {
                console.error("Failed to move todo:", error);
                await loadTodos();
            }
        }
    }, [selectedTodoId, getTodoPosition, displayColumns, todos, todosAPI, loadTodos, boardConfig, rejectEventStatusMove]);

    // Archive selected todo (keyboard shortcut handler - uses shared function)
    const archiveSelected = useCallback(async () => {
        if (!selectedTodoId) return;
        const todoToArchive = todos.find(t => t.id === selectedTodoId);
        if (!todoToArchive) return;
        await archiveTodoWithToast(todoToArchive);
    }, [selectedTodoId, todos, archiveTodoWithToast]);

    // Delete selected todo (keyboard shortcut handler - uses shared function)
    const deleteSelected = useCallback(async () => {
        if (!selectedTodoId) return;
        const todoToDelete = todos.find(t => t.id === selectedTodoId);
        if (!todoToDelete) return;
        await deleteTodoWithToast(todoToDelete);
    }, [selectedTodoId, todos, deleteTodoWithToast]);

    // Copy selected todo to clipboard (title and description)
    const copySelectedTodo = useCallback(async () => {
        if (!selectedTodoId) return;
        const todo = todos.find(t => t.id === selectedTodoId);
        if (!todo) return;

        const content = todo.description
            ? `${todo.title}\n\n${todo.description}`
            : todo.title;

        try {
            await navigator.clipboard.writeText(content);
            const truncatedTitle = todo.title.length > 30
                ? todo.title.slice(0, 30) + "…"
                : todo.title;
            toast.success(`Copied "${truncatedTitle}"`);
        } catch (error) {
            console.error("Failed to copy to clipboard:", error);
            toast.error("Failed to copy to clipboard");
        }
    }, [selectedTodoId, todos]);

    const isInputFocused = () => {
        const el = document.activeElement;
        return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };

    // Register keyboard shortcuts
    useKeyboardShortcuts([
        {
            id: 'todos.navigate-down',
            name: 'Navigate Down',
            combo: { key: 'ArrowDown' },
            handler: navigateDown,
            when: () => flattenedTodos.length > 0 && !isInputFocused(),
            category: 'Navigation',
        },
        {
            id: 'todos.navigate-up',
            name: 'Navigate Up',
            combo: { key: 'ArrowUp' },
            handler: navigateUp,
            when: () => flattenedTodos.length > 0 && !isInputFocused(),
            category: 'Navigation',
        },
        {
            id: 'todos.navigate-right',
            name: 'Navigate Right',
            combo: { key: 'ArrowRight' },
            handler: navigateRight,
            when: () => flattenedTodos.length > 0 && !isInputFocused(),
            category: 'Navigation',
        },
        {
            id: 'todos.navigate-left',
            name: 'Navigate Left',
            combo: { key: 'ArrowLeft' },
            handler: navigateLeft,
            when: () => flattenedTodos.length > 0 && !isInputFocused(),
            category: 'Navigation',
        },
        {
            id: 'todos.move-up',
            name: 'Move Up',
            combo: { key: 'ArrowUp', shift: true },
            handler: moveUp,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.move-down',
            name: 'Move Down',
            combo: { key: 'ArrowDown', shift: true },
            handler: moveDown,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.move-right',
            name: 'Move Right',
            combo: { key: 'ArrowRight', shift: true },
            handler: moveRight,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.move-left',
            name: 'Move Left',
            combo: { key: 'ArrowLeft', shift: true },
            handler: moveLeft,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.archive',
            name: 'Archive Todo',
            combo: { key: 'a' },
            handler: archiveSelected,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.delete',
            name: 'Delete Todo',
            combo: { key: 'Delete' },
            handler: deleteSelected,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.delete-backspace',
            name: 'Delete Todo',
            combo: { key: 'Backspace' },
            handler: deleteSelected,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.open',
            name: 'Open Todo',
            combo: { key: 'Enter' },
            handler: openSelectedTodo,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.escape-search',
            name: 'Clear Search / Blur',
            combo: { key: 'Escape' },
            handler: () => {
                if (isInputFocused()) {
                    if (todoFilter.filterState.searchQuery) {
                        todoFilter.setSearchQuery("");
                        return true;
                    }
                    (document.activeElement as HTMLElement)?.blur();
                    return true;
                }
                return false;
            },
            category: 'Navigation',
        },
        {
            id: 'todos.create',
            name: 'Create Todo',
            combo: { key: 'n', cmd: true },
            handler: () => {
                setCreateDialogOpen(true);
            },
            category: 'Actions',
            priority: 20,
        },
        {
            id: 'todos.create-c',
            name: 'Create Todo',
            combo: { key: 'c' },
            handler: () => {
                setCreateDialogOpen(true);
            },
            when: () => !isInputFocused(),
            category: 'Actions',
        },
        {
            id: 'todos.refresh',
            name: 'Refresh Todos',
            combo: { key: 'r', cmd: true },
            handler: () => {
                loadTodos();
            },
            category: 'Actions',
            priority: 10,
        },
        {
            id: 'todos.copy',
            name: 'Copy Todo',
            combo: { key: ';' },
            handler: copySelectedTodo,
            when: () => selectedTodoId !== null && !isInputFocused(),
            category: 'Actions',
        }
    ], {
        context: 'plugin:todos',
        onlyWhenActive: true,
        deps: [loadTodos, flattenedTodos, selectedTodoId, todoFilter.filterState.searchQuery, navigateDown, navigateUp, navigateLeft, navigateRight, openSelectedTodo, moveUp, moveDown, moveLeft, moveRight, archiveSelected, deleteSelected, copySelectedTodo]
    });

    // Refs for scrolling
    const selectedCardRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // Focus the kanban container when this tab becomes active
    // This ensures keyboard navigation works immediately after clicking the tab
    useEffect(() => {
        // Only focus if this tab is active and not loading
        if (activeTab?.pluginInstance?.viewId === "browser" && scrollContainerRef.current) {
            // Use requestAnimationFrame to ensure the DOM is ready
            requestAnimationFrame(() => {
                scrollContainerRef.current?.focus();
            });
        }
    }, [activeTab?.id, activeTab?.pluginInstance?.viewId]);

    // Scroll to selected item only if off-screen, scroll to top if first in column
    // useLayoutEffect ensures scroll happens synchronously after DOM update
    useLayoutEffect(() => {
        const el = selectedCardRef.current;
        const container = scrollContainerRef.current;
        if (!el || !selectedTodoId || !container) return;

        // Check if selected todo is first in its column
        const selectedTodo = flattenedTodos.find(t => t.id === selectedTodoId);
        if (!selectedTodo) return;

        const colId = getColumnForTodo(selectedTodo);
        const columnTodos = todosByColumn[colId] ?? [];
        const isFirstInColumn = columnTodos[0]?.id === selectedTodoId;

        if (isFirstInColumn) {
            container.scrollTo({ top: 0, behavior: "instant" });
            return;
        }

        // Check visibility relative to the scroll container, not the window
        const containerRect = container.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const isVisible = (
            rect.top >= containerRect.top &&
            rect.bottom <= containerRect.bottom
        );

        if (!isVisible) {
            el.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
    }, [selectedTodoId, flattenedTodos, todosByColumn, getColumnForTodo]);

    // Sortable Todo Card component with drop indicator and selection
    function SortableTodoCard({ todo, isOverThis, isSelected, hideProject }: { todo: Todo; isOverThis: boolean; isSelected: boolean; hideProject?: boolean }) {
        const {
            attributes,
            listeners,
            setNodeRef,
            transform,
            transition,
            isDragging,
        } = useSortable({ id: todo.id });

        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.3 : 1,
            zIndex: isDragging ? 1 : 0,
        };

        // Show drop indicator when hovering over this card (but not when dragging this card)
        const showIndicator = isOverThis && !isDragging;

        return (
            <div
                className="relative group/card"
                ref={isSelected ? selectedCardRef : undefined}
            >
                {/* Drop indicator line */}
                {showIndicator && (
                    <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded-full z-10 bg-accent" />
                )}
                <div
                    ref={setNodeRef}
                    style={style}
                    {...attributes}
                    {...listeners}
                    onClick={() => {
                        setSelectedTodoId(todo.id);
                    }}
                    onDoubleClick={() => handleOpenTodo(todo.id)}
                    className={`cursor-move rounded-lg ${isSelected ? 'outline outline-2 outline-offset-1 outline-accent' : ''}`}
                >
                    <TodoCard
                        todo={todo}
                        selected={isSelected}
                        onEdit={(t) => handleOpenTodo(t.id)}
                        onDelete={deleteTodoWithToast}
                        onArchive={archiveTodoWithToast}
                        onToggleDone={toggleDoneWithToast}
                        hideProject={hideProject}
                        onDateChange={handleInlineDateChange}
                        onChecklistToggle={handleChecklistToggle}
                    />
                </div>
            </div>
        );
    }

    function KanbanColumn({
        title,
        columnId,
        todos: columnTodos,
        icon,
        onAddTodo,
    }: {
        title: string;
        columnId: string;
        todos: Todo[];
        icon: React.ReactNode;
        onAddTodo: () => void;
    }) {
        const { setNodeRef, isOver } = useDroppable({
            id: `column-${columnId}`,
        });
        const [headerHovered, setHeaderHovered] = useState(false);

        // Get the currently dragged and hovered item from DndContext
        const { active, over } = useDndContext();
        const overId = over?.id as string | undefined;
        const activeId = active?.id as string | undefined;

        // Ensure columnTodos is always an array
        const safeColumnTodos = Array.isArray(columnTodos) ? columnTodos : [];

        return (
            <div className="flex-1 min-w-0 flex flex-col">
                <div
                    className="flex items-center gap-1.5 mb-2.5 flex-shrink-0 group cursor-pointer rounded-md px-1.5 py-1 transition-colors"
                    onMouseEnter={() => setHeaderHovered(true)}
                    onMouseLeave={() => setHeaderHovered(false)}
                    onClick={onAddTodo}
                    style={{ color: currentTheme.styles.contentSecondary }}
                >
                    {icon}
                    <h3 className="text-xs font-medium uppercase tracking-[0.08em]">{title}</h3>
                    <Badge variant="secondary" className="text-xs">
                        {safeColumnTodos.length}
                    </Badge>
                    <button
                        type="button"
                        className={`ml-auto p-1 rounded transition-opacity ${headerHovered ? 'opacity-100' : 'opacity-0'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddTodo();
                        }}
                        style={{
                            color: currentTheme.styles.contentSecondary,
                            backgroundColor: headerHovered ? currentTheme.styles.surfaceAccent : "transparent",
                        }}
                    >
                        <Plus className="size-4" />
                    </button>
                </div>
                <SortableContext items={safeColumnTodos.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    <div
                        ref={setNodeRef}
                        className="space-y-2 rounded-lg py-3 px-1.5 transition-colors border"
                        style={{
                            borderColor: isOver ? currentTheme.styles.surfaceAccent : currentTheme.styles.borderDefault,
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                        }}
                    >
                        {safeColumnTodos.map((todo) => (
                            <SortableTodoCard
                                key={todo.id}
                                todo={todo}
                                isOverThis={overId === todo.id && activeId !== todo.id}
                                isSelected={selectedTodoId === todo.id}
                                hideProject={isProjectScopedView}
                            />
                        ))}
                        {safeColumnTodos.length === 0 && (
                            <div className="text-center text-xs py-8" style={{ color: currentTheme.styles.contentTertiary }}>
                                Drop tasks here
                            </div>
                        )}
                    </div>
                </SortableContext>
            </div>
        );
    }

    return (
        <div
            className="h-full min-h-0 overflow-hidden flex"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}
        >
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                {embedded ? (
                    <div className="min-w-0 flex-1 overflow-y-auto">
                        <div className="mx-auto w-full max-w-[1400px] px-3 pt-3 pb-6 h-full min-h-0 flex flex-col">
                            <div className="shrink-0 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <FileSearch className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                                        <span className="text-xs font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentSecondary }}>
                                            {isProjectScopedView ? "Project Board" : "Todos Board"}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 min-w-0">
                                        {isProjectScopedView && (
                                            <span
                                                className="text-micro px-1.5 py-0.5 rounded uppercase tracking-[0.08em] shrink-0"
                                                style={{ color: currentTheme.styles.contentSecondary, backgroundColor: currentTheme.styles.surfaceSecondary }}
                                            >
                                                project
                                            </span>
                                        )}
                                        <h1 className="text-xl font-semibold truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                                            {isProjectScopedView ? projectDisplayName : "All Todos"}
                                        </h1>
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                        {headerStats.map((item) => (
                                            <span
                                                key={item.key}
                                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption font-medium"
                                                style={{ backgroundColor: currentTheme.styles.surfaceSecondary, color: currentTheme.styles.contentSecondary }}
                                            >
                                                <span className="tabular-nums" style={{ color: currentTheme.styles.contentPrimary }}>
                                                    {item.value}
                                                </span>
                                                <span>{item.label}</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                    <CreateTodoDialog
                                        open={createDialogOpen}
                                        onOpenChange={(open) => {
                                            setCreateDialogOpen(open);
                                            if (!open) {
                                                resetNewTodoDraft();
                                            }
                                        }}
                                        newTodo={newTodo}
                                        onNewTodoChange={setNewTodo}
                                        onCreateTodo={createTodo}
                                        loading={loading}
                                        projectLocked={isProjectScopedView}
                                        availableTags={availableTags}
                                        availableProjects={availableProjects}
                                        goals={availableGoals}
                                        triggerLabel="+ new"
                                        hideTriggerIcon
                                        triggerVariant="default"
                                        triggerClassName="h-7 px-2 text-xs font-medium rounded-md"
                                    />
                                </div>
                            </div>

                            <div className="shrink-0 mt-2.5">
                                <TodoFilterToolbar
                                    filterState={todoFilter.filterState}
                                    onSearchChange={(query) => {
                                        clearActiveSidebarListSelection();
                                        todoFilter.setSearchQuery(query);
                                    }}
                                    onSortModeChange={todoFilter.setSortMode}
                                    onActivatePreset={(preset) => {
                                        clearActiveSidebarListSelection();
                                        todoFilter.activatePreset(preset);
                                    }}
                                    onFilterChange={(partial) => {
                                        clearActiveSidebarListSelection();
                                        if (partial.selectedPriority !== undefined) todoFilter.setSelectedPriority(partial.selectedPriority);
                                        if (partial.dueFilter !== undefined) todoFilter.setDueFilter(partial.dueFilter);
                                        if (partial.selectedTags !== undefined) todoFilter.setSelectedTags(partial.selectedTags);
                                        if (partial.selectedProject !== undefined) todoFilter.setSelectedProject(partial.selectedProject);
                                    }}
                                    onClearAllFilters={() => {
                                        clearActiveSidebarListSelection();
                                        todoFilter.clearAllFilters();
                                    }}
                                    availableTags={availableTags}
                                    allowedSortModes={["urgency", "manual"]}
                                    showQuickPresets={false}
                                    showDueFilter={false}
                                    activeFilterChips={todoFilter.activeFilterChips}
                                    hasActiveFilters={todoFilter.hasActiveFilters}
                                    trailingActions={
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" size="sm" className="h-7 px-2">
                                                    <MoreHorizontal className="w-4 h-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={openArchivedView}>
                                                    <Archive className="w-4 h-4 mr-2" />
                                                    Open Archived
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={archiveAllDone}
                                                    disabled={todos.filter(t => t.status === "done").length === 0}
                                                >
                                                    <Archive className="w-4 h-4 mr-2" />
                                                    Archive All Done ({todos.filter(t => t.status === "done").length})
                                                </DropdownMenuItem>
                                                {canonicalFilterProject && (
                                                    <DropdownMenuItem onClick={() => setBoardSettingsOpen(true)}>
                                                        <Settings className="w-4 h-4 mr-2" />
                                                        {boardConfig ? "Board Settings" : "Setup Custom Board"}
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem onClick={toggleShowLaterColumn}>
                                                    {showLaterColumn ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                                                    {showLaterColumn ? "Hide Later Column" : "Show Later Column"}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    }
                                />
                            </div>

                            <div ref={scrollContainerRef} tabIndex={0} className="mt-2.5 flex gap-3 flex-1 min-h-0 overflow-x-auto overflow-y-auto outline-none pb-2">
                                {displayColumns.map((col) => {
                                    let Icon = Circle;
                                    if (col.id === "todo") Icon = AlertCircle;
                                    else if (col.id === "in_progress") Icon = Clock;
                                    else if (col.id === "done") Icon = CheckCircle2;
                                    else if (col.id === "later") Icon = Calendar;

                                    return (
                                        <KanbanColumn
                                            key={col.id}
                                            title={col.title}
                                            columnId={col.id}
                                            todos={todosByColumn[col.id] || []}
                                            icon={<Icon className="w-3.5 h-3.5" style={{ color: currentTheme.styles.contentTertiary }} />}
                                            onAddTodo={() => {
                                                if (boardConfig) {
                                                    openCreateDialogWithStatus(col.status ?? "todo", col.id);
                                                } else {
                                                    openCreateDialogWithStatus(col.id as any);
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
                        <ResizablePanel defaultSize={20} minSize={12} maxSize={35} className="flex flex-col min-h-0" style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}>
                            <div className="shrink-0 px-3 pt-2.5 pb-1.5">
                                <div className="px-1 py-0.5 text-[11px] font-semibold tracking-[0.01em]" style={{ color: currentTheme.styles.contentPrimary }}>
                                    Todos Navigations
                                </div>
                                <div className="px-1 text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                                    Views and projects
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto px-0.5 pb-2 space-y-2.5">
                                <SidebarSection
                                    title="Groups"
                                    contentTertiary={currentTheme.styles.contentTertiary}
                                    borderDefault={currentTheme.styles.borderDefault}
                                    sectionSurface={currentTheme.styles.surfacePrimary}
                                >
                                    <DroppableProjectItem
                                        groupName={ALL_TODOS_GROUP}
                                        label="All Todos"
                                        isSelected={!isProjectScopedView && !activeSystemListId}
                                        count={sidebarGroupCounts[ALL_TODOS_GROUP] ?? 0}
                                        onClick={() => handleSelectGroup(ALL_TODOS_GROUP)}
                                        contentPrimary={currentTheme.styles.contentPrimary}
                                        contentTertiary={currentTheme.styles.contentTertiary}
                                        surfaceAccent={currentTheme.styles.surfaceAccent}
                                        surfaceTertiary={currentTheme.styles.surfaceTertiary}
                                        borderDefault={currentTheme.styles.borderDefault}
                                        isDragging={!!draggedTodoId}
                                    />
                                    <DroppableProjectItem
                                        groupName={INBOX_PROJECT_NAME}
                                        label="Inbox"
                                        isSelected={canonicalFilterProject === INBOX_PROJECT_NAME && !activeSystemListId}
                                        count={sidebarGroupCounts[INBOX_PROJECT_NAME] ?? 0}
                                        onClick={() => handleSelectGroup(INBOX_PROJECT_NAME)}
                                        contentPrimary={currentTheme.styles.contentPrimary}
                                        contentTertiary={currentTheme.styles.contentTertiary}
                                        surfaceAccent={currentTheme.styles.surfaceAccent}
                                        surfaceTertiary={currentTheme.styles.surfaceTertiary}
                                        borderDefault={currentTheme.styles.borderDefault}
                                        isDragging={!!draggedTodoId}
                                    />
                                </SidebarSection>

                                <SidebarSection
                                    title="System Lists"
                                    contentTertiary={currentTheme.styles.contentTertiary}
                                    borderDefault={currentTheme.styles.borderDefault}
                                    sectionSurface={currentTheme.styles.surfacePrimary}
                                >
                                    {SYSTEM_LISTS.map((systemList) => (
                                        <SidebarListItem
                                            key={systemList.id}
                                            label={systemList.label}
                                            isSelected={activeSystemListId === systemList.id}
                                            count={systemListCounts[systemList.id]}
                                            onClick={() => handleSelectSystemList(systemList)}
                                            contentPrimary={currentTheme.styles.contentPrimary}
                                            contentTertiary={currentTheme.styles.contentTertiary}
                                            surfaceAccent={currentTheme.styles.surfaceAccent}
                                            surfaceTertiary={currentTheme.styles.surfaceTertiary}
                                        />
                                    ))}
                                </SidebarSection>

                                <SidebarSection
                                    title="Projects"
                                    contentTertiary={currentTheme.styles.contentTertiary}
                                    borderDefault={currentTheme.styles.borderDefault}
                                    sectionSurface={currentTheme.styles.surfacePrimary}
                                >
                                    {sidebarProjects.map((projectName) => (
                                        <DroppableProjectItem
                                            key={projectName}
                                            groupName={projectName}
                                            label={projectName}
                                            isSelected={canonicalFilterProject === projectName && !activeSystemListId}
                                            count={sidebarGroupCounts[projectName] ?? 0}
                                            onClick={() => handleSelectGroup(projectName)}
                                            contentPrimary={currentTheme.styles.contentPrimary}
                                            contentTertiary={currentTheme.styles.contentTertiary}
                                            surfaceAccent={currentTheme.styles.surfaceAccent}
                                            surfaceTertiary={currentTheme.styles.surfaceTertiary}
                                            borderDefault={currentTheme.styles.borderDefault}
                                            isDragging={!!draggedTodoId}
                                        />
                                    ))}
                                    {sidebarProjects.length === 0 && (
                                        <div className="px-3 py-2 text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                                            no projects yet
                                        </div>
                                    )}
                                </SidebarSection>
                            </div>
                        </ResizablePanel>

                        <ResizableHandle withHandle />

                        <ResizablePanel className="flex flex-col min-w-0 min-h-0">
                            <div className="min-w-0 flex-1 overflow-y-auto">
                                <div className="mx-auto w-full max-w-[1400px] px-3 pt-3 pb-6 h-full min-h-0 flex flex-col">
                <div className="shrink-0 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <FileSearch className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                            <span className="text-xs font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentSecondary }}>
                                {isProjectScopedView ? "Project Board" : "Todos Board"}
                            </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 min-w-0">
                            {isProjectScopedView && (
                                <span
                                    className="text-micro px-1.5 py-0.5 rounded uppercase tracking-[0.08em] shrink-0"
                                    style={{ color: currentTheme.styles.contentSecondary, backgroundColor: currentTheme.styles.surfaceSecondary }}
                                >
                                    project
                                </span>
                            )}
                                <h1 className="text-xl font-semibold truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                                    {isProjectScopedView ? projectDisplayName : "All Todos"}
                                </h1>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {headerStats.map((item) => (
                                <span
                                    key={item.key}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption font-medium"
                                    style={{ backgroundColor: currentTheme.styles.surfaceSecondary, color: currentTheme.styles.contentSecondary }}
                                >
                                    <span className="tabular-nums" style={{ color: currentTheme.styles.contentPrimary }}>
                                        {item.value}
                                    </span>
                                    <span>{item.label}</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        <CreateTodoDialog
                            open={createDialogOpen}
                            onOpenChange={(open) => {
                                setCreateDialogOpen(open);
                                if (!open) {
                                    resetNewTodoDraft();
                                }
                            }}
                            newTodo={newTodo}
                            onNewTodoChange={setNewTodo}
                            onCreateTodo={createTodo}
                            loading={loading}
                            projectLocked={isProjectScopedView}
                            availableTags={availableTags}
                            availableProjects={availableProjects}
                            goals={availableGoals}
                            triggerLabel="+ new"
                            hideTriggerIcon
                            triggerVariant="default"
                            triggerClassName="h-7 px-2 text-xs font-medium rounded-md"
                        />
                    </div>
                </div>

                <div className="shrink-0 mt-2.5">
                    <TodoFilterToolbar
                        filterState={todoFilter.filterState}
                        onSearchChange={(query) => {
                            clearActiveSidebarListSelection();
                            todoFilter.setSearchQuery(query);
                        }}
                        onSortModeChange={todoFilter.setSortMode}
                        onActivatePreset={(preset) => {
                            clearActiveSidebarListSelection();
                            todoFilter.activatePreset(preset);
                        }}
                        onFilterChange={(partial) => {
                            clearActiveSidebarListSelection();
                            if (partial.selectedPriority !== undefined) todoFilter.setSelectedPriority(partial.selectedPriority);
                            if (partial.dueFilter !== undefined) todoFilter.setDueFilter(partial.dueFilter);
                            if (partial.selectedTags !== undefined) todoFilter.setSelectedTags(partial.selectedTags);
                            if (partial.selectedProject !== undefined) todoFilter.setSelectedProject(partial.selectedProject);
                        }}
                        onClearAllFilters={() => {
                            clearActiveSidebarListSelection();
                            todoFilter.clearAllFilters();
                        }}
                        availableTags={availableTags}
                        allowedSortModes={["urgency", "manual"]}
                        showQuickPresets={false}
                        showDueFilter={false}
                        activeFilterChips={todoFilter.activeFilterChips}
                        hasActiveFilters={todoFilter.hasActiveFilters}
                        trailingActions={
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 px-2">
                                        <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={openArchivedView}>
                                        <Archive className="w-4 h-4 mr-2" />
                                        Open Archived
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={archiveAllDone}
                                        disabled={todos.filter(t => t.status === "done").length === 0}
                                    >
                                        <Archive className="w-4 h-4 mr-2" />
                                        Archive All Done ({todos.filter(t => t.status === "done").length})
                                    </DropdownMenuItem>
                                    {canonicalFilterProject && (
                                        <DropdownMenuItem onClick={() => setBoardSettingsOpen(true)}>
                                            <Settings className="w-4 h-4 mr-2" />
                                            {boardConfig ? "Board Settings" : "Setup Custom Board"}
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem onClick={toggleShowLaterColumn}>
                                        {showLaterColumn ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                                        {showLaterColumn ? "Hide Later Column" : "Show Later Column"}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        }
                    />
                </div>

                {/* Kanban Board */}
                <div ref={scrollContainerRef} tabIndex={0} className="mt-2.5 flex gap-3 flex-1 min-h-0 overflow-x-auto overflow-y-auto outline-none pb-2">
                        {displayColumns.map((col) => {
                            let Icon = Circle;
                            if (col.id === "todo") Icon = AlertCircle;
                            else if (col.id === "in_progress") Icon = Clock;
                            else if (col.id === "done") Icon = CheckCircle2;
                            else if (col.id === "later") Icon = Calendar;

                            return (
                                <KanbanColumn
                                    key={col.id}
                                    title={col.title}
                                    columnId={col.id}
                                    todos={todosByColumn[col.id] || []}
                                    icon={<Icon className="w-3.5 h-3.5" style={{ color: currentTheme.styles.contentTertiary }} />}
                                    onAddTodo={() => {
                                        if (boardConfig) {
                                            // Use column's actual status (fallback to "todo" for no-status columns)
                                            openCreateDialogWithStatus(col.status ?? "todo", col.id);
                                        } else {
                                            // Legacy: col.id is the status
                                            openCreateDialogWithStatus(col.id as any);
                                        }
                                    }}
                                />
                            );
                        })}
                </div>
            </div>
                            </div>
                        </ResizablePanel>
                    </ResizablePanelGroup>
                )}

                <DragOverlay>
                    {draggedTodo ? (
                        <div className="transform rotate-2 opacity-80">
                            <TodoCard
                                todo={draggedTodo}
                                onEdit={() => { }}
                                onDelete={() => { }}
                                onArchive={() => { }}
                                hideProject={isProjectScopedView}
                                hideStatusIcon={true}
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Edit Todo Modal */}
            <TaskCardEditor todo={todoToEdit} open={editDialogOpen} onOpenChange={setEditDialogOpen} onSave={handleSaveTodo} onDelete={deleteTodoWithToast} onToggleCalendarReminder={handleToggleCalendarReminder} saving={editSaving} availableTags={availableTags} availableProjects={availableProjects} goals={availableGoals} />

            {/* Board Settings Dialog - Show for project views */}
            {canonicalFilterProject && (
                <BoardSettingsDialog
                    open={boardSettingsOpen}
                    onOpenChange={setBoardSettingsOpen}
                    config={boardConfig || {
                        columns: getDefaultColumns(),
                        showDone: true,
                    }}
                    onSave={async (newConfig) => {
                        try {
                            const savedProject = await todosAPI.saveBoardConfig({
                                projectName: canonicalFilterProject,
                                board: newConfig
                            });
                            setBoardConfig(savedProject.board || null);
                            toast.success(boardConfig ? "Board settings saved" : "Custom board created!");
                            // Reload todos in case custom column IDs were mapped or logic changed
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to save board config", error);
                            toast.error("Failed to save settings");
                        }
                    }}
                    onDeleteColumn={async (columnId) => {
                        try {
                            // Backend migration of todos + column deletion
                            await todosAPI.deleteColumn({
                                projectId: canonicalFilterProject,
                                columnId: columnId,
                            });
                            // Refresh todos to see them in new columns
                            await loadTodos();
                        } catch (error) {
                            console.error("Failed to delete column", error);
                            toast.error("Failed to delete column");
                            throw error; // Re-throw to let dialog handle UI state if needed
                        }
                    }}
                />
            )}
        </div>
    );
}
