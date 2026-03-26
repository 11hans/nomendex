import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, Calendar, Archive, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { TodoCard } from "./TodoCard";
import { TaskCardEditor } from "./TaskCardEditor";
import { Todo } from "./todo-types";
import { useTodoFilterState } from "./useTodoFilterState";
import { filterAndSortTodos, urgencyComparator } from "./todo-filter-utils";
import { TodoFilterToolbar } from "./TodoFilterToolbar";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/hooks/useTheme";
import {
    DndContext,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    verticalListSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import {
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function ArchivedBrowserView({ project }: { project?: string | null } = {}) {
    const filterProject = project;
    const { setLoading } = usePlugin();
    const { activeTab, setTabName, openTab } = useWorkspaceContext();

    const todosAPI = useTodosAPI();
    const [todos, setTodos] = useState<Todo[]>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const todoFilter = useTodoFilterState("archived", { defaultSortMode: "urgency" });
    const { currentTheme } = useTheme();
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const hasSetTabNameRef = useRef<boolean>(false);

    // Drag and drop state
    const [draggedTodo, setDraggedTodo] = useState<Todo | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    // Update the tab name based on the project - only once when component mounts
    useEffect(() => {
        if (activeTab && activeTab.pluginInstance.plugin.id === "todos" && !hasSetTabNameRef.current) {
            let tabName = "Archived Todos";
            if (filterProject && filterProject !== "") {
                tabName = `Archived: ${filterProject}`;
            } else if (filterProject === "") {
                tabName = "Archived: No Project";
            }

            setTabName(activeTab.id, tabName);
            hasSetTabNameRef.current = true;
        }
    }, [activeTab, filterProject, setTabName]);

    const loadTodos = useMemo(
        () => async () => {
            setLoading(true);
            try {
                const archivedData = await todosAPI.getArchivedTodos({ project: filterProject || undefined });
                setTodos(archivedData);

                // Load tags and projects
                const [tags, projects] = await Promise.all([
                    todosAPI.getTags(),
                    todosAPI.getProjects()
                ]);
                setAvailableTags(tags);
                setAvailableProjects(projects);
            } catch (error) {
                console.error("Failed to load archived todos:", error);
            } finally {
                setLoading(false);
            }
        },
        [todosAPI, setLoading, filterProject]
    );

    useEffect(() => {
        loadTodos();
    }, [loadTodos]);


    // Register keyboard shortcuts
    useKeyboardShortcuts([
        {
            id: 'archived-todos.refresh',
            name: 'Refresh Archived Todos',
            combo: { key: 'r', cmd: true },
            handler: () => {
                loadTodos();
            },
            category: 'Actions',
            priority: 10,
        }
    ], {
        context: 'plugin:todos:archived',
        onlyWhenActive: true,
        deps: [loadTodos]
    });

    const updateTodoStatus = useCallback(async (todoId: string, status: "todo" | "in_progress" | "done" | "later") => {
        try {
            await todosAPI.updateTodo({
                todoId,
                updates: { status },
            });
            await loadTodos();
        } catch (error) {
            console.error("Failed to update todo status:", error);
        }
    }, [todosAPI, loadTodos]);

    // Shared delete function with optimistic update and toast (no confirmation dialog)
    const deleteTodoWithToast = useCallback(async (todo: Todo) => {
        // Optimistic update - remove from list
        setTodos(prev => prev.filter(t => t.id !== todo.id));

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
                            // Recreate the todo (as archived)
                            await todosAPI.createTodo({
                                title: todo.title,
                                description: todo.description,
                                status: todo.status,
                                project: todo.project,
                                tags: todo.tags,
                                scheduledStart: todo.scheduledStart ?? null,
                                scheduledEnd: todo.scheduledEnd ?? null,
                                dueDate: todo.dueDate ?? null,
                                priority: todo.priority,
                                duration: todo.duration,
                                attachments: todo.attachments,
                                customColumnId: todo.customColumnId,
                            });
                            // Re-archive it since this is the archived view
                            const newTodos = await todosAPI.getTodos({});
                            const recreatedTodo = newTodos.find(t => t.title === todo.title);
                            if (recreatedTodo) {
                                await todosAPI.archiveTodo({ todoId: recreatedTodo.id });
                            }
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
    }, [todosAPI, loadTodos]);

    // Shared unarchive function with optimistic update and toast (for archived view)
    const unarchiveTodoWithToast = useCallback(async (todo: Todo) => {
        // Optimistic update - remove from list (it will move to active view)
        setTodos(prev => prev.filter(t => t.id !== todo.id));

        try {
            await todosAPI.unarchiveTodo({ todoId: todo.id });

            const truncatedTitle = todo.title.length > 30
                ? todo.title.slice(0, 30) + "…"
                : todo.title;
            toast(`Restored "${truncatedTitle}"`, {
                action: {
                    label: "Undo",
                    onClick: async () => {
                        try {
                            await todosAPI.archiveTodo({ todoId: todo.id });
                            await loadTodos();
                            toast.success("Archived again");
                        } catch (error) {
                            console.error("Failed to re-archive:", error);
                            toast.error("Failed to undo");
                        }
                    },
                },
            });
        } catch (error) {
            console.error("Failed to unarchive todo:", error);
            toast.error("Failed to restore");
            await loadTodos();
        }
    }, [todosAPI, loadTodos]);

    const handleOpenTodo = async (todoId: string) => {
        const todo = todos.find((t) => t.id === todoId);
        if (todo) {
            setTodoToEdit(todo);
            setEditDialogOpen(true);
        }
    };

    const handleSaveTodo = async (updatedTodo: Todo) => {
        setEditSaving(true);
        try {
            await todosAPI.updateTodo({
                todoId: updatedTodo.id,
                updates: {
                    title: updatedTodo.title,
                    description: updatedTodo.description,
                    status: updatedTodo.status,
                    project: updatedTodo.project,
                    archived: updatedTodo.archived,
                    tags: updatedTodo.tags,
                    scheduledStart: updatedTodo.scheduledStart ?? null,
                    scheduledEnd: updatedTodo.scheduledEnd ?? null,
                    dueDate: updatedTodo.dueDate ?? null,
                    priority: updatedTodo.priority,
                    duration: updatedTodo.duration,
                    attachments: updatedTodo.attachments,
                    customColumnId: updatedTodo.customColumnId,
                    calendarReminderPreset: updatedTodo.calendarReminderPreset,
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

    const openActiveView = () => {
        openTab({
            pluginMeta: { id: "todos", name: "Todos", icon: "list-todo" },
            view: "browser",
            props: { project: filterProject }
        });
    };

    // Drag and drop handlers
    const handleDragStart = useCallback((event: DragStartEvent) => {
        const todo = todos.find(t => t.id === event.active.id);
        setDraggedTodo(todo || null);
    }, [todos]);

    const handleDragOver = useCallback((_event: DragOverEvent) => {
        // We handle drag over for cross-column drops
    }, []);

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;
        setDraggedTodo(null);

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        // Find the dragged todo
        const activeIndex = todos.findIndex(t => t.id === activeId);
        if (activeIndex === -1) return;

        const activeTodo = todos[activeIndex];
        if (!activeTodo) return;

        // Determine if this is a cross-column drop or same-column reorder
        if (overId.startsWith('column-')) {
            // Cross-column drop - change status
            const newStatus = overId.replace('column-', '') as "todo" | "in_progress" | "done" | "later";
            if (newStatus !== activeTodo.status) {
                await updateTodoStatus(activeId, newStatus);
            }
        } else {
            // Same column reorder or cross-column with specific position
            const overIndex = todos.findIndex(t => t.id === overId);
            if (overIndex === -1) return;

            const overTodo = todos[overIndex];
            if (!overTodo) return;

            // If different status, update status first
            if (activeTodo.status !== overTodo.status) {
                await updateTodoStatus(activeId, overTodo.status);
                return;
            }

            // Same status - reorder within column
            if (activeIndex !== overIndex) {
                const statusTodos = todos.filter(t => t.status === activeTodo.status);
                const reorderedTodos = arrayMove(
                    statusTodos,
                    statusTodos.findIndex(t => t.id === activeId),
                    statusTodos.findIndex(t => t.id === overId)
                );

                // Create reorder updates
                const reorders = reorderedTodos.map((todo, index) => ({
                    todoId: todo.id,
                    order: index + 1,
                }));

                try {
                    await todosAPI.reorderTodos({ reorders });
                    await loadTodos();
                } catch (error) {
                    console.error("Failed to reorder todos:", error);
                }
            }
        }
    }, [todos, todosAPI, updateTodoStatus, loadTodos]);

    const todosByStatus = useMemo(() => {
        const filtered = filterAndSortTodos(todos, todoFilter.filterState, { skipStatusFilter: true });

        const grouped = {
            todo: filtered.filter((t) => t.status === "todo"),
            in_progress: filtered.filter((t) => t.status === "in_progress"),
            done: filtered.filter((t) => t.status === "done"),
            later: filtered.filter((t) => t.status === "later"),
        };

        // Apply urgency sort within each column
        if (todoFilter.filterState.sortMode !== "manual") {
            for (const key of Object.keys(grouped) as Array<keyof typeof grouped>) {
                grouped[key].sort(urgencyComparator);
            }
        }

        return grouped;
    }, [todos, todoFilter.filterState]);

    // Sortable Todo Card component
    function SortableTodoCard({ todo }: { todo: Todo }) {
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
            transition: isDragging ? transition : undefined,
            opacity: isDragging ? 0.5 : 1,
        };

        return (
            <div
                ref={setNodeRef}
                style={style}
                {...attributes}
                {...listeners}
                onClick={() => handleOpenTodo(todo.id)}
                className="cursor-move"
            >
                <TodoCard
                    todo={todo}
                    onEdit={(t) => handleOpenTodo(t.id)}
                    onDelete={deleteTodoWithToast}
                    onArchive={unarchiveTodoWithToast}
                    hideStatusIcon={true}
                />
            </div>
        );
    }

    function KanbanColumn({
        title,
        status,
        todos: columnTodos,
        icon,
    }: {
        title: string;
        status: "todo" | "in_progress" | "done" | "later";
        todos: Todo[];
        icon: React.ReactNode;
    }) {
        return (
            <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                    {icon}
                    <h3 className="font-semibold text-sm">{title}</h3>
                    <Badge variant="secondary" className="text-xs">
                        {columnTodos.length}
                    </Badge>
                </div>
                <SortableContext items={columnTodos.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    <div
                        id={`column-${status}`}
                        className="flex-1 space-y-2 bg-muted/30 rounded-lg p-3 transition-all duration-200 border-2 border-transparent min-h-24"
                    >
                        {columnTodos.map((todo) => (
                            <SortableTodoCard key={todo.id} todo={todo} />
                        ))}
                        {columnTodos.length === 0 && (
                            <div className="text-center text-muted-foreground text-sm py-8">
                                No archived items
                            </div>
                        )}
                    </div>
                </SortableContext>
            </div>
        );
    }

    return (
        <div className="px-6 py-4 space-y-6">
            <TodoFilterToolbar
                filterState={todoFilter.filterState}
                onSearchChange={todoFilter.setSearchQuery}
                onSortModeChange={todoFilter.setSortMode}
                onActivatePreset={todoFilter.activatePreset}
                onFilterChange={(partial) => {
                    if (partial.selectedTags !== undefined) todoFilter.setSelectedTags(partial.selectedTags);
                    if (partial.selectedPriority !== undefined) todoFilter.setSelectedPriority(partial.selectedPriority);
                    if (partial.dueFilter !== undefined) todoFilter.setDueFilter(partial.dueFilter);
                    if (partial.selectedProject !== undefined) todoFilter.setSelectedProject(partial.selectedProject);
                }}
                onClearAllFilters={todoFilter.clearAllFilters}
                availableTags={availableTags}
                availableProjects={availableProjects}
                showStatusBucket={false}
                allowedSortModes={["urgency", "recent"]}
                activeFilterChips={todoFilter.activeFilterChips}
                hasActiveFilters={todoFilter.hasActiveFilters}
                trailingActions={
                    <button
                        onClick={openActiveView}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                        style={{
                            color: currentTheme.styles.contentTertiary,
                            border: `1px solid ${currentTheme.styles.borderDefault}`,
                        }}
                    >
                        <ArrowLeft className="size-3.5" />
                        Back to Active
                    </button>
                }
            />

            {todos.length === 0 ? (
                <div className="text-center py-12">
                    <Archive className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-muted-foreground mb-2">No archived todos</h3>
                    <p className="text-sm text-muted-foreground">
                        Archive completed or outdated todos to keep your workspace organized.
                    </p>
                </div>
            ) : (
                /* Kanban Board */
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                >
                    <div className="flex gap-6 overflow-x-auto h-[calc(100vh-200px)]">
                        <KanbanColumn
                            title="Later"
                            status="later"
                            todos={todosByStatus.later}
                            icon={<Calendar className="w-4 h-4 text-purple" />}
                        />
                        <KanbanColumn title="To Do" status="todo" todos={todosByStatus.todo} icon={<AlertCircle className="w-4 h-4 text-muted-foreground" />} />
                        <KanbanColumn
                            title="In Progress"
                            status="in_progress"
                            todos={todosByStatus.in_progress}
                            icon={<Clock className="w-4 h-4 text-primary" />}
                        />
                        <KanbanColumn title="Done" status="done" todos={todosByStatus.done} icon={<CheckCircle2 className="w-4 h-4 text-success" />} />
                    </div>
                    <DragOverlay>
                        {draggedTodo ? (
                            <div className="transform rotate-2 opacity-80">
                                <TodoCard
                                    todo={draggedTodo}
                                    onEdit={() => { }}
                                    onDelete={() => { }}
                                    onArchive={() => { }}
                                    hideStatusIcon={true}
                                />
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}

            {/* Edit Todo Modal */}
            <TaskCardEditor todo={todoToEdit} open={editDialogOpen} onOpenChange={setEditDialogOpen} onSave={handleSaveTodo} onDelete={deleteTodoWithToast} saving={editSaving} availableTags={availableTags} availableProjects={availableProjects} />
        </div>
    );
}
