import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useTheme } from "@/hooks/useTheme";
import { subscribe } from "@/lib/events";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { CreateTodoDialog } from "./CreateTodoDialog";
import { TaskCardEditor } from "./TaskCardEditor";
import { Todo } from "./todo-types";
import { syncTaskToCalendar, removeTaskFromCalendar } from "./calendar-bridge";
import { syncTaskToReminders, removeTaskFromReminders } from "./reminder-bridge";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import {
    DndContext,
    DragCancelEvent,
    DragEndEvent,
    DragStartEvent,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
    Archive,
    ArchiveRestore,
    ChevronRight,
    Inbox,
    ListTodo,
    Search,
} from "lucide-react";

type InboxFilter = "all" | "active" | "completed" | "archived";

const INBOX_PROJECT = "Inbox";
const ALL_TASKS = "__all__";

function normalizeProjectName(project?: string): string {
    const normalized = project?.trim();
    if (!normalized || normalized.toLowerCase() === "inbox") return INBOX_PROJECT;
    return normalized;
}

function compareGroupNames(a: string, b: string): number {
    if (a === INBOX_PROJECT && b !== INBOX_PROJECT) return -1;
    if (b === INBOX_PROJECT && a !== INBOX_PROJECT) return 1;
    return a.localeCompare(b);
}

function getFilterForTodo(todo: Todo): Exclude<InboxFilter, "all"> {
    if (todo.archived) return "archived";
    if (todo.status === "done") return "completed";
    return "active";
}

function getGroupName(todo: Todo): string {
    return normalizeProjectName(todo.project);
}

function formatRelativeDateLabel(dateString?: string): string {
    if (!dateString) return "";

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const daysDiff = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

    if (daysDiff === 0) return "today";
    if (daysDiff === 1) return "yesterday";

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
            className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs rounded-md transition-colors"
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
                    backgroundColor: count > 0 ? surfaceAccent : undefined,
                }}
            >
                {count}
            </span>
        </button>
    );
}

function DraggableTodoRow({
    todo,
    selected,
    borderColor,
    selectedBackground,
    contentPrimary,
    contentTertiary,
    onOpen,
    onToggleArchive,
}: {
    todo: Todo;
    selected: boolean;
    borderColor: string;
    selectedBackground: string;
    contentPrimary: string;
    contentTertiary: string;
    onOpen: (todo: Todo) => void;
    onToggleArchive: (todo: Todo) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: todo.id,
        disabled: todo.archived,
    });

    const statusType = getFilterForTodo(todo);
    const dateLabel = formatRelativeDateLabel(todo.updatedAt);
    const leadTag = todo.tags?.[0];

    return (
        <div
            ref={setNodeRef}
            className="group border-t px-2.5 py-0.5 flex items-center gap-1.5"
            style={{
                borderColor,
                backgroundColor: selected ? selectedBackground : undefined,
                transform: CSS.Translate.toString(transform),
                opacity: isDragging ? 0.55 : 1,
            }}
            {...attributes}
            {...listeners}
        >
            <button
                onClick={() => onOpen(todo)}
                className="flex-1 min-w-0 py-1.5 flex items-center gap-1.5 text-left"
            >
                <span
                    className={`size-2 rounded-full shrink-0 border ${
                        statusType === "active"
                            ? "border-primary"
                            : statusType === "completed"
                                ? "border-success bg-success"
                                : "border-text-muted/40"
                    }`}
                />

                <span className="truncate text-xs" style={{ color: contentPrimary }}>{todo.title}</span>

                <span className="ml-auto flex items-center gap-2 shrink-0" style={{ color: contentTertiary }}>
                    {leadTag && <span className="text-[10px]">#{leadTag}</span>}
                    {dateLabel && <span className="text-[10px]">{dateLabel}</span>}
                    <ChevronRight className="size-3 opacity-60" />
                </span>
            </button>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleArchive(todo);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                title={todo.archived ? "restore" : "archive"}
            >
                {todo.archived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
            </button>
        </div>
    );
}

export function InboxListView() {
    const { loading, setLoading } = usePlugin();
    const { activeTab, setTabName } = useWorkspaceContext();
    const { currentTheme } = useTheme();

    const todosAPI = useTodosAPI();
    const [todos, setTodos] = useState<Todo[]>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const [projectGroups, setProjectGroups] = useState<string[]>([INBOX_PROJECT]);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState<InboxFilter>("all");
    const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null);
    const [selectedGroup, setSelectedGroup] = useState<string>(ALL_TASKS);
    const hasSetTabNameRef = useRef<boolean>(false);
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const [newTodo, setNewTodo] = useState<{
        title: string;
        description: string;
        project: string;
        status: "todo" | "in_progress" | "done" | "later";
        tags: string[];
        scheduledStart?: string;
        scheduledEnd?: string;
        dueDate?: string;
        priority?: "high" | "medium" | "low" | "none";
        attachments?: Todo["attachments"];
    }>({
        title: "",
        description: "",
        project: "Inbox",
        status: "todo",
        tags: [],
        scheduledStart: undefined,
        scheduledEnd: undefined,
        dueDate: undefined,
        priority: undefined,
        attachments: undefined,
    });

    const resetNewTodoDraft = useCallback(() => {
        setNewTodo({
            title: "",
            description: "",
            project: "Inbox",
            status: "todo",
            tags: [],
            scheduledStart: undefined,
            scheduledEnd: undefined,
            dueDate: undefined,
            priority: undefined,
            attachments: undefined,
        });
    }, []);

    useEffect(() => {
        return subscribe("workspace:closeAllTabs", () => {
            setCreateDialogOpen(false);
            setEditDialogOpen(false);
            setTodoToEdit(null);
        });
    }, []);

    useEffect(() => {
        if (activeTab && activeTab.pluginInstance.plugin.id === "todos" && !hasSetTabNameRef.current) {
            setTabName(activeTab.id, "Inbox");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab, setTabName]);

    const loadTodos = useCallback(async () => {
        setLoading(true);
        try {
            const [activeTodos, archivedTodos, tags, projectsList, todoProjects] = await Promise.all([
                todosAPI.getTodos({}),
                todosAPI.getArchivedTodos({}),
                todosAPI.getTags(),
                todosAPI.getProjectsList().catch(() => []),
                todosAPI.getProjects().catch(() => []),
            ]);

            const allTodos = [
                ...activeTodos.filter((todo) => !todo.archived),
                ...archivedTodos.map((todo) => ({ ...todo, archived: true })),
            ];

            const projectsFromConfig = projectsList
                .filter((project) => !project.archived)
                .map((project) => project.name.trim())
                .filter(Boolean);

            const projectsFromTodos = allTodos.map((todo) => normalizeProjectName(todo.project));
            const normalizedTodoProjects = todoProjects.map((name) => normalizeProjectName(name));

            const mergedProjects = Array.from(
                new Set([
                    INBOX_PROJECT,
                    ...projectsFromConfig,
                    ...projectsFromTodos,
                    ...normalizedTodoProjects,
                ])
            ).sort(compareGroupNames);

            setTodos(allTodos);
            setAvailableTags(tags);
            setAvailableProjects(mergedProjects);
            setProjectGroups(mergedProjects);
        } catch (error) {
            console.error("Failed to load todos:", error);
        } finally {
            setLoading(false);
        }
    }, [todosAPI, setLoading]);

    useEffect(() => {
        loadTodos();
    }, [loadTodos]);

    useEffect(() => {
        if (!selectedTodoId) return;
        if (!todos.some((todo) => todo.id === selectedTodoId)) {
            setSelectedTodoId(null);
            setTodoToEdit(null);
        }
    }, [todos, selectedTodoId]);

    const handleSaveTodo = async (updatedTodo: Todo) => {
        setEditSaving(true);
        try {
            await todosAPI.updateTodo({
                todoId: updatedTodo.id,
                updates: {
                    title: updatedTodo.title,
                    description: updatedTodo.description,
                    status: updatedTodo.status,
                    project: updatedTodo.project === "" ? "Inbox" : updatedTodo.project,
                    archived: updatedTodo.archived,
                    tags: updatedTodo.tags,
                    scheduledStart: updatedTodo.scheduledStart ?? null,
                    scheduledEnd: updatedTodo.scheduledEnd ?? null,
                    dueDate: updatedTodo.dueDate ?? null,
                    priority: updatedTodo.priority,
                    duration: updatedTodo.duration,
                    attachments: updatedTodo.attachments,
                    calendarReminderPreset: updatedTodo.calendarReminderPreset,
                },
            });
            setEditDialogOpen(false);
            setTodoToEdit(null);
            setSelectedTodoId(updatedTodo.id);
            await loadTodos();
            syncTaskToCalendar(updatedTodo).catch(() => { });
            syncTaskToReminders(updatedTodo).catch(() => { });
        } catch (error) {
            console.error("Failed to save todo:", error);
            toast.error("Failed to save changes");
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
                setTodoToEdit(updated);
                await loadTodos();
                syncTaskToCalendar(updated).catch(() => { });
                toast.success(todo.calendarReminderPreset === "30-15" ? "Reminders set (30 + 15 min)" : "Reminders removed");
            }
        } catch {
            toast.error("Failed to update reminders");
        }
    };

    const createTodo = async () => {
        if (!newTodo.title.trim()) return;

        setLoading(true);
        try {
            const createdTodo = await todosAPI.createTodo({
                title: newTodo.title.trim(),
                description: newTodo.description,
                project: newTodo.project.trim() || undefined,
                status: newTodo.status,
                tags: newTodo.tags,
                scheduledStart: newTodo.scheduledStart ?? null,
                scheduledEnd: newTodo.scheduledEnd ?? null,
                dueDate: newTodo.dueDate,
                priority: newTodo.priority,
                attachments: newTodo.attachments,
            });

            resetNewTodoDraft();
            setCreateDialogOpen(false);
            await loadTodos();

            if (createdTodo?.id) {
                syncTaskToCalendar(createdTodo).catch(() => { });
                syncTaskToReminders(createdTodo).catch(() => { });
            }
        } catch (error) {
            console.error("Failed to create todo:", error);
        } finally {
            setLoading(false);
        }
    };

    const deleteTodoWithToast = useCallback(async (todo: Todo) => {
        setTodos((prev) => prev.filter((t) => t.id !== todo.id));

        try {
            await todosAPI.deleteTodo({ todoId: todo.id });
            removeTaskFromCalendar(todo.id).catch(() => { });
            removeTaskFromReminders(todo.id).catch(() => { });

            toast("Deleted task", {
                action: {
                    label: "Undo",
                    onClick: async () => {
                        try {
                            await todosAPI.createTodo({
                                title: todo.title,
                                description: todo.description,
                                status: todo.status,
                                project: todo.project,
                                tags: todo.tags,
                                scheduledStart: todo.scheduledStart ?? null,
                                scheduledEnd: todo.scheduledEnd ?? null,
                                dueDate: todo.dueDate,
                                priority: todo.priority,
                                duration: todo.duration,
                                attachments: todo.attachments,
                            });
                            await loadTodos();
                            toast.success("Restored");
                        } catch {
                            toast.error("Failed to restore");
                        }
                    },
                },
            });
        } catch {
            toast.error("Failed to delete");
            await loadTodos();
        }
    }, [todosAPI, loadTodos]);

    const toggleArchiveWithToast = useCallback(async (todo: Todo) => {
        const nextArchived = !todo.archived;

        setTodos((prev) =>
            prev.map((t) => (t.id === todo.id ? { ...t, archived: nextArchived } : t))
        );

        try {
            if (nextArchived) {
                await todosAPI.archiveTodo({ todoId: todo.id });
                removeTaskFromCalendar(todo.id).catch(() => { });
                removeTaskFromReminders(todo.id).catch(() => { });
                toast("Archived task", {
                    action: {
                        label: "Undo",
                        onClick: async () => {
                            try {
                                await todosAPI.unarchiveTodo({ todoId: todo.id });
                                await loadTodos();
                                toast.success("Restored");
                            } catch {
                                toast.error("Failed to restore");
                            }
                        },
                    },
                });
            } else {
                await todosAPI.unarchiveTodo({ todoId: todo.id });
                syncTaskToCalendar(todo).catch(() => { });
                syncTaskToReminders(todo).catch(() => { });
                toast("Restored task", {
                    action: {
                        label: "Undo",
                        onClick: async () => {
                            try {
                                await todosAPI.archiveTodo({ todoId: todo.id });
                                await loadTodos();
                                toast.success("Archived again");
                            } catch {
                                toast.error("Failed to undo");
                            }
                        },
                    },
                });
            }
        } catch {
            setTodos((prev) =>
                prev.map((t) => (t.id === todo.id ? { ...t, archived: todo.archived } : t))
            );
            toast.error(nextArchived ? "Failed to archive" : "Failed to restore");
        }
    }, [todosAPI, loadTodos]);

    const moveTodoToProject = useCallback(async (todo: Todo, targetGroupName: string) => {
        const currentProject = normalizeProjectName(todo.project);
        const targetProject = normalizeProjectName(targetGroupName);
        if (currentProject === targetProject) return;

        const now = new Date().toISOString();

        setProjectGroups((prev) => {
            if (prev.includes(targetProject)) return prev;
            return [...prev, targetProject].sort(compareGroupNames);
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
            const updatedTodo: Todo = { ...todo, project: targetProject, updatedAt: now };
            syncTaskToCalendar(updatedTodo).catch(() => { });
            syncTaskToReminders(updatedTodo).catch(() => { });
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
    }, [todosAPI]);

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setDraggedTodoId(String(event.active.id));
    }, []);

    const handleDragCancel = useCallback((_event: DragCancelEvent) => {
        setDraggedTodoId(null);
    }, []);

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        setDraggedTodoId(null);
        if (!event.over) return;

        const overId = String(event.over.id);
        if (!overId.startsWith("project-group:")) return;

        const targetGroupName = overId.substring("project-group:".length);
        const todoId = String(event.active.id);
        const draggedTodo = todos.find((todo) => todo.id === todoId);
        if (!draggedTodo) return;

        await moveTodoToProject(draggedTodo, targetGroupName);
    }, [todos, moveTodoToProject]);

    const openTodoForEdit = (todo: Todo) => {
        setSelectedTodoId(todo.id);
        setTodoToEdit(todo);
        setEditDialogOpen(true);
    };

    const fuzzySearch = (query: string, text: string): boolean => {
        if (!query) return true;
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
    };

    const filteredTodos = useMemo(() => {
        let filtered = todos;

        // Group filter
        if (selectedGroup !== ALL_TASKS) {
            filtered = filtered.filter((todo) => getGroupName(todo) === selectedGroup);
        }

        if (searchQuery.trim()) {
            filtered = filtered.filter((todo) =>
                fuzzySearch(searchQuery, todo.title)
                || (todo.description ? fuzzySearch(searchQuery, todo.description) : false)
                || (todo.project ? fuzzySearch(searchQuery, todo.project) : false)
                || (todo.tags?.some((tag) => fuzzySearch(searchQuery, tag)) ?? false)
            );
        }

        if (filter !== "all") {
            filtered = filtered.filter((todo) => getFilterForTodo(todo) === filter);
        }

        return filtered.sort((a, b) => {
            const aTime = new Date(a.updatedAt).getTime();
            const bTime = new Date(b.updatedAt).getTime();
            return bTime - aTime;
        });
    }, [todos, searchQuery, filter, selectedGroup]);

    // Counts per group (active tasks only, for sidebar badges)
    const groupCounts = useMemo(() => {
        const counts: Record<string, number> = { [ALL_TASKS]: 0 };
        for (const todo of todos) {
            if (todo.archived || todo.status === "done") continue;
            counts[ALL_TASKS] = (counts[ALL_TASKS] || 0) + 1;
            const group = getGroupName(todo);
            counts[group] = (counts[group] || 0) + 1;
        }
        return counts;
    }, [todos]);

    // Counts for filter buttons (scoped to current group selection)
    const filterCounts = useMemo(() => {
        let scoped = todos;
        if (selectedGroup !== ALL_TASKS) {
            scoped = scoped.filter((todo) => getGroupName(todo) === selectedGroup);
        }
        if (searchQuery.trim()) {
            scoped = scoped.filter((todo) =>
                fuzzySearch(searchQuery, todo.title)
                || (todo.description ? fuzzySearch(searchQuery, todo.description) : false)
                || (todo.project ? fuzzySearch(searchQuery, todo.project) : false)
                || (todo.tags?.some((tag) => fuzzySearch(searchQuery, tag)) ?? false)
            );
        }
        return {
            all: scoped.length,
            active: scoped.filter((todo) => getFilterForTodo(todo) === "active").length,
            completed: scoped.filter((todo) => getFilterForTodo(todo) === "completed").length,
            archived: scoped.filter((todo) => getFilterForTodo(todo) === "archived").length,
        };
    }, [todos, selectedGroup, searchQuery]);

    // Non-inbox projects for sidebar listing
    const sidebarProjects = useMemo(() =>
        projectGroups.filter((g) => g !== INBOX_PROJECT),
    [projectGroups]);

    const selectedGroupLabel = selectedGroup === ALL_TASKS
        ? "All Tasks"
        : selectedGroup;

    const isProjectLocked = selectedGroup !== ALL_TASKS;

    const handleOpenCreateDialog = useCallback((open: boolean) => {
        if (open && isProjectLocked) {
            setNewTodo((prev) => ({ ...prev, project: selectedGroup }));
        }
        setCreateDialogOpen(open);
        if (!open) {
            resetNewTodoDraft();
        }
    }, [isProjectLocked, selectedGroup, resetNewTodoDraft]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-xs" style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentTertiary }}>
                loading inbox...
            </div>
        );
    }

    const { styles } = currentTheme;

    return (
        <div className="h-full flex flex-col" style={{ backgroundColor: styles.surfacePrimary, color: styles.contentPrimary }}>
            <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
            >
                <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
                    {/* Left Panel — Sidebar */}
                    <ResizablePanel defaultSize={20} minSize={12} maxSize={35} className="flex flex-col min-h-0" style={{ backgroundColor: styles.surfaceSecondary }}>
                        {/* Search */}
                        <div className="shrink-0 p-2.5 pb-1.5">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3" style={{ color: styles.contentTertiary }} />
                                <Input
                                    placeholder="search tasks..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="h-8 pl-8 text-xs bg-transparent"
                                    style={{ borderColor: styles.borderDefault, color: styles.contentPrimary }}
                                />
                            </div>
                        </div>

                        {/* Fixed items */}
                        <div className="shrink-0 px-1.5 pb-1">
                            <DroppableProjectItem
                                groupName={ALL_TASKS}
                                label="All Tasks"
                                isSelected={selectedGroup === ALL_TASKS}
                                count={groupCounts[ALL_TASKS] || 0}
                                onClick={() => setSelectedGroup(ALL_TASKS)}
                                contentPrimary={styles.contentPrimary}
                                contentTertiary={styles.contentTertiary}
                                surfaceAccent={styles.surfaceAccent}
                                borderDefault={styles.borderDefault}
                                isDragging={!!draggedTodoId}
                            />
                            <DroppableProjectItem
                                groupName={INBOX_PROJECT}
                                label="Inbox"
                                isSelected={selectedGroup === INBOX_PROJECT}
                                count={groupCounts[INBOX_PROJECT] || 0}
                                onClick={() => setSelectedGroup(INBOX_PROJECT)}
                                contentPrimary={styles.contentPrimary}
                                contentTertiary={styles.contentTertiary}
                                surfaceAccent={styles.surfaceAccent}
                                borderDefault={styles.borderDefault}
                                isDragging={!!draggedTodoId}
                            />
                        </div>

                        {/* Separator */}
                        <div className="shrink-0 mx-2.5 mb-1" style={{ borderTop: `1px solid ${styles.borderDefault}` }} />

                        {/* Projects list */}
                        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
                            <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: styles.contentTertiary }}>
                                Projects
                            </div>
                            {sidebarProjects.map((groupName) => (
                                <DroppableProjectItem
                                    key={groupName}
                                    groupName={groupName}
                                    label={groupName}
                                    isSelected={selectedGroup === groupName}
                                    count={groupCounts[groupName] || 0}
                                    onClick={() => setSelectedGroup(groupName)}
                                    contentPrimary={styles.contentPrimary}
                                    contentTertiary={styles.contentTertiary}
                                    surfaceAccent={styles.surfaceAccent}
                                    borderDefault={styles.borderDefault}
                                    isDragging={!!draggedTodoId}
                                />
                            ))}
                            {sidebarProjects.length === 0 && (
                                <div className="px-3 py-2 text-[10px]" style={{ color: styles.contentTertiary }}>
                                    no projects yet
                                </div>
                            )}
                        </div>
                    </ResizablePanel>

                    <ResizableHandle />

                    {/* Right Panel — Detail */}
                    <ResizablePanel className="flex flex-col min-w-0 min-h-0">
                        {/* Header */}
                        <div
                            className="shrink-0 px-4 py-2.5 flex items-center gap-2"
                            style={{ borderBottom: `1px solid ${styles.borderDefault}` }}
                        >
                            {selectedGroup === INBOX_PROJECT && <Inbox className="size-3.5" style={{ color: styles.contentTertiary }} />}
                            {selectedGroup === ALL_TASKS && <ListTodo className="size-3.5" style={{ color: styles.contentTertiary }} />}
                            <span className="text-xs font-medium uppercase tracking-[0.1em]" style={{ color: styles.contentPrimary }}>
                                {selectedGroupLabel}
                            </span>
                            <span className="text-caption" style={{ color: styles.contentTertiary }}>
                                {filterCounts.all} items
                            </span>

                            <div className="ml-auto flex items-center gap-1.5">
                                <div className="flex items-center gap-0.5">
                                    {(["all", "active", "completed", "archived"] as const).map((value) => (
                                        <button
                                            key={value}
                                            onClick={() => setFilter(value)}
                                            className="h-7 rounded-md px-2 text-caption transition-colors"
                                            style={filter === value ? {
                                                backgroundColor: styles.surfaceAccent,
                                                color: styles.contentPrimary,
                                            } : {
                                                color: styles.contentTertiary,
                                            }}
                                        >
                                            {value}
                                            <span className="ml-1 opacity-70">{filterCounts[value]}</span>
                                        </button>
                                    ))}
                                </div>

                                <CreateTodoDialog
                                    open={createDialogOpen}
                                    onOpenChange={handleOpenCreateDialog}
                                    newTodo={newTodo}
                                    onNewTodoChange={setNewTodo}
                                    onCreateTodo={createTodo}
                                    loading={loading}
                                    projectLocked={isProjectLocked}
                                    availableTags={availableTags}
                                    availableProjects={availableProjects}
                                    triggerLabel="+ new"
                                    hideTriggerIcon
                                    triggerVariant="default"
                                    triggerClassName="h-7 px-2 text-xs font-medium rounded-md"
                                />
                            </div>
                        </div>

                        {/* Task list */}
                        <div className="flex-1 overflow-y-auto min-h-0">
                            {filteredTodos.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center gap-2">
                                    <ListTodo className="size-10 opacity-20" style={{ color: styles.contentTertiary }} />
                                    <span className="text-xs" style={{ color: styles.contentTertiary }}>
                                        {searchQuery.trim() || filter !== "all"
                                            ? "no tasks match current filters"
                                            : "no tasks yet"}
                                    </span>
                                </div>
                            ) : (
                                <div>
                                    {filteredTodos.map((todo) => (
                                        <DraggableTodoRow
                                            key={todo.id}
                                            todo={todo}
                                            selected={selectedTodoId === todo.id}
                                            borderColor={styles.borderDefault}
                                            selectedBackground={styles.surfaceAccent}
                                            contentPrimary={styles.contentPrimary}
                                            contentTertiary={styles.contentTertiary}
                                            onOpen={openTodoForEdit}
                                            onToggleArchive={(todoToArchive) => {
                                                void toggleArchiveWithToast(todoToArchive);
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </DndContext>

            <TaskCardEditor
                todo={todoToEdit}
                open={editDialogOpen}
                onOpenChange={(open) => {
                    setEditDialogOpen(open);
                    if (!open) setTodoToEdit(null);
                }}
                onSave={handleSaveTodo}
                onDelete={deleteTodoWithToast}
                onToggleCalendarReminder={handleToggleCalendarReminder}
                saving={editSaving}
                availableTags={availableTags}
                availableProjects={availableProjects}
            />
        </div>
    );
}
