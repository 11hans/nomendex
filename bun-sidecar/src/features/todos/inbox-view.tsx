import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useTheme } from "@/hooks/useTheme";
import { subscribe } from "@/lib/events";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
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
    FileSearch,
    Search,
} from "lucide-react";

type InboxFilter = "all" | "active" | "completed" | "archived";

const INBOX_PROJECT = "Inbox";

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

function DroppableGroup({
    groupName,
    children,
    borderColor,
    backgroundColor,
    dropHighlightColor,
}: {
    groupName: string;
    children: React.ReactNode;
    borderColor: string;
    backgroundColor: string;
    dropHighlightColor: string;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `project-group:${groupName}`,
    });

    return (
        <div
            ref={setNodeRef}
            className="overflow-hidden rounded-lg border transition-colors"
            style={{
                borderColor: isOver ? dropHighlightColor : borderColor,
                backgroundColor,
            }}
        >
            {children}
        </div>
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
                    className={`size-2 rounded-full shrink-0 ${
                        statusType === "active"
                            ? "bg-primary"
                            : statusType === "completed"
                                ? "bg-success"
                                : "bg-text-muted/40"
                    }`}
                />

                <span className="truncate text-xs" style={{ color: contentPrimary }}>{todo.title}</span>

                <span className="ml-auto flex items-center gap-2 text-[10px] shrink-0" style={{ color: contentTertiary }}>
                    {leadTag && <span>#{leadTag}</span>}
                    {dateLabel && <span>{dateLabel}</span>}
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
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        [INBOX_PROJECT]: true,
    });
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
        dueDate?: string;
        priority?: "high" | "medium" | "low" | "none";
        attachments?: Todo["attachments"];
    }>({
        title: "",
        description: "",
        project: "Inbox",
        status: "todo",
        tags: [],
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
                    dueDate: updatedTodo.dueDate,
                    priority: updatedTodo.priority,
                    startDate: updatedTodo.startDate,
                    duration: updatedTodo.duration,
                    attachments: updatedTodo.attachments,
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
                                dueDate: todo.dueDate,
                                priority: todo.priority,
                                startDate: todo.startDate,
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
    }, [todos, searchQuery, filter]);

    const groupedTodos = useMemo(() => {
        const grouped = projectGroups.reduce<Record<string, Todo[]>>((acc, groupName) => {
            acc[groupName] = [];
            return acc;
        }, {});

        for (const todo of filteredTodos) {
            const group = getGroupName(todo);
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push(todo);
        }

        return Object.entries(grouped).sort(([a], [b]) => compareGroupNames(a, b));
    }, [filteredTodos, projectGroups]);

    useEffect(() => {
        if (groupedTodos.length === 0) return;

        setExpandedGroups((prev) => {
            const next = { ...prev };
            for (const [groupName] of groupedTodos) {
                if (next[groupName] === undefined) {
                    next[groupName] = groupName === INBOX_PROJECT;
                }
            }
            return next;
        });
    }, [groupedTodos]);

    const counts = useMemo(() => ({
        all: todos.length,
        active: todos.filter((todo) => getFilterForTodo(todo) === "active").length,
        completed: todos.filter((todo) => getFilterForTodo(todo) === "completed").length,
        archived: todos.filter((todo) => getFilterForTodo(todo) === "archived").length,
    }), [todos]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-xs" style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentTertiary }}>
                loading inbox...
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto" style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}>
            <div className="mx-auto w-full max-w-[620px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    <FileSearch className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentPrimary }}>Inbox</span>
                    <span className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>{counts.all} items</span>

                    <div className="ml-auto">
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
                            projectLocked={false}
                            availableTags={availableTags}
                            availableProjects={availableProjects}
                            triggerLabel="+ new"
                            hideTriggerIcon
                            triggerVariant="default"
                            triggerClassName="h-7 px-2 text-[11px] font-medium rounded-md"
                        />
                    </div>
                </div>

                <div className="shrink-0 mt-2.5 flex items-center gap-1.5">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                        <Input
                            placeholder="search inbox..."
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
                                className={`h-7 rounded-md px-2 text-[10px] transition-colors`}
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

                <div className="mt-2.5">
                    {filteredTodos.length === 0 && (
                        <div className="py-3 text-center text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                            no tasks match current filters
                        </div>
                    )}

                    <DndContext
                        sensors={sensors}
                        onDragStart={handleDragStart}
                        onDragCancel={handleDragCancel}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="space-y-2 pb-2">
                            {groupedTodos.map(([groupName, groupItems]) => {
                                const expanded = expandedGroups[groupName] ?? true;
                                const isInbox = groupName === INBOX_PROJECT;

                                return (
                                    <DroppableGroup
                                        key={groupName}
                                        groupName={groupName}
                                        borderColor={currentTheme.styles.borderDefault}
                                        backgroundColor={currentTheme.styles.surfaceSecondary}
                                        dropHighlightColor={currentTheme.styles.surfaceAccent}
                                    >
                                        <button
                                            onClick={() => {
                                                setExpandedGroups((prev) => ({
                                                    ...prev,
                                                    [groupName]: !expanded,
                                                }));
                                            }}
                                            className="w-full px-2.5 py-1.5 flex items-center gap-1.5 text-left text-[10px] transition-colors"
                                            style={{ color: currentTheme.styles.contentTertiary }}
                                        >
                                            <ChevronRight className={`size-3 transition-transform opacity-70 ${expanded ? "rotate-90" : ""}`} />
                                            <span className="font-medium uppercase tracking-[0.08em]">{isInbox ? INBOX_PROJECT : groupName}</span>
                                            <span className="opacity-70">{groupItems.length}</span>
                                        </button>

                                        {expanded && (
                                            <div>
                                                {groupItems.length === 0 ? (
                                                    <div
                                                        className="border-t px-2.5 py-2 text-[10px]"
                                                        style={{ borderColor: currentTheme.styles.borderDefault, color: currentTheme.styles.contentTertiary }}
                                                    >
                                                        {draggedTodoId ? "drop task here to move into this project" : "no tasks"}
                                                    </div>
                                                ) : (
                                                    groupItems.map((todo) => (
                                                        <DraggableTodoRow
                                                            key={todo.id}
                                                            todo={todo}
                                                            selected={selectedTodoId === todo.id}
                                                            borderColor={currentTheme.styles.borderDefault}
                                                            selectedBackground={currentTheme.styles.surfaceAccent}
                                                            contentPrimary={currentTheme.styles.contentPrimary}
                                                            contentTertiary={currentTheme.styles.contentTertiary}
                                                            onOpen={openTodoForEdit}
                                                            onToggleArchive={(todoToArchive) => {
                                                                void toggleArchiveWithToast(todoToArchive);
                                                            }}
                                                        />
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </DroppableGroup>
                                );
                            })}
                        </div>
                    </DndContext>
                </div>
            </div>

            <TaskCardEditor
                todo={todoToEdit}
                open={editDialogOpen}
                onOpenChange={(open) => {
                    setEditDialogOpen(open);
                    if (!open) setTodoToEdit(null);
                }}
                onSave={handleSaveTodo}
                onDelete={deleteTodoWithToast}
                saving={editSaving}
                availableTags={availableTags}
                availableProjects={availableProjects}
            />
        </div>
    );
}
