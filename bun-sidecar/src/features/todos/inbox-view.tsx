import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
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
    Archive,
    ArchiveRestore,
    ChevronRight,
    FileSearch,
    Search,
} from "lucide-react";

type InboxFilter = "all" | "active" | "completed" | "archived";

function getFilterForTodo(todo: Todo): Exclude<InboxFilter, "all"> {
    if (todo.archived) return "archived";
    if (todo.status === "done") return "completed";
    return "active";
}

function getGroupName(todo: Todo): string {
    const project = todo.project?.trim();
    if (!project || project.toLowerCase() === "inbox") return "uncategorized";
    return project;
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

export function InboxListView() {
    const { loading, setLoading } = usePlugin();
    const { activeTab, setTabName } = useWorkspaceContext();

    const todosAPI = useTodosAPI();
    const [todos, setTodos] = useState<Todo[]>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState<InboxFilter>("all");
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const hasSetTabNameRef = useRef<boolean>(false);

    const [newTodo, setNewTodo] = useState<{
        title: string;
        description: string;
        project: string;
        status: "todo" | "in_progress" | "done" | "later";
        tags: string[];
    }>({
        title: "",
        description: "",
        project: "Inbox",
        status: "todo",
        tags: [],
    });

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
            const [activeTodos, archivedTodos, tags, projects] = await Promise.all([
                todosAPI.getTodos({ project: "Inbox" }),
                todosAPI.getArchivedTodos({ project: "Inbox" }),
                todosAPI.getTags(),
                todosAPI.getProjects(),
            ]);

            const allTodos = [
                ...activeTodos.filter((todo) => !todo.archived),
                ...archivedTodos.map((todo) => ({ ...todo, archived: true })),
            ];

            setTodos(allTodos);
            setAvailableTags(tags);
            setAvailableProjects(projects);
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
            await todosAPI.createTodo({
                title: newTodo.title.trim(),
                description: newTodo.description,
                project: newTodo.project.trim() || undefined,
                status: newTodo.status,
                tags: newTodo.tags,
            });

            setNewTodo({
                title: "",
                description: "",
                project: "Inbox",
                status: "todo",
                tags: [],
            });
            setCreateDialogOpen(false);
            await loadTodos();
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
        const grouped = filteredTodos.reduce<Record<string, Todo[]>>((acc, todo) => {
            const group = getGroupName(todo);
            if (!acc[group]) acc[group] = [];
            acc[group].push(todo);
            return acc;
        }, {});

        return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
    }, [filteredTodos]);

    useEffect(() => {
        if (groupedTodos.length === 0) return;

        setExpandedGroups((prev) => {
            const next = { ...prev };
            for (const [groupName] of groupedTodos) {
                if (next[groupName] === undefined) next[groupName] = true;
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
            <div className="h-full flex items-center justify-center text-xs text-text-muted">
                loading inbox...
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 bg-bg text-text overflow-y-auto">
            <div className="mx-auto w-full max-w-[620px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    <FileSearch className="size-3 text-text-muted" />
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em]">Inbox</span>
                    <span className="text-[10px] text-text-muted">{counts.all} items</span>

                    <div className="ml-auto">
                        <CreateTodoDialog
                            open={createDialogOpen}
                            onOpenChange={setCreateDialogOpen}
                            newTodo={newTodo}
                            onNewTodoChange={setNewTodo}
                            onCreateTodo={createTodo}
                            loading={loading}
                            projectLocked={true}
                            availableTags={availableTags}
                            availableProjects={availableProjects}
                            triggerLabel="+ new"
                            hideTriggerIcon
                            triggerVariant="outline"
                            triggerClassName="h-7 px-2 text-[11px] font-medium rounded-md"
                        />
                    </div>
                </div>

                <div className="shrink-0 mt-2.5 flex items-center gap-1.5">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-text-muted" />
                        <Input
                            placeholder="search inbox..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 pl-8 text-xs border-border/70 bg-transparent"
                        />
                    </div>

                    <div className="flex items-center gap-0.5">
                        {(["all", "active", "completed", "archived"] as const).map((value) => (
                            <button
                                key={value}
                                onClick={() => setFilter(value)}
                                className={`h-7 rounded-md px-2 text-[10px] transition-colors ${
                                    filter === value
                                        ? "bg-surface-elevated text-text shadow-sm"
                                        : "text-text-muted hover:text-text"
                                }`}
                            >
                                {value}
                                <span className="ml-1 opacity-70">{counts[value]}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mt-2.5">
                    {groupedTodos.length === 0 ? (
                        <div className="py-8 text-center text-[11px] text-text-muted">
                            <div className="mb-1">no tasks found</div>
                            <p className="text-[10px] opacity-70">create a task or change filters</p>
                        </div>
                    ) : (
                        <div className="space-y-2 pb-2">
                            {groupedTodos.map(([groupName, groupItems]) => {
                                const expanded = expandedGroups[groupName] ?? true;

                                return (
                                    <div
                                        key={groupName}
                                        className="overflow-hidden rounded-lg border border-border/80 bg-surface"
                                    >
                                        <button
                                            onClick={() => {
                                                setExpandedGroups((prev) => ({
                                                    ...prev,
                                                    [groupName]: !expanded,
                                                }));
                                            }}
                                            className="w-full px-2.5 py-1.5 flex items-center gap-1.5 text-left text-[10px] text-text-muted hover:text-text transition-colors"
                                        >
                                            <ChevronRight className={`size-3 transition-transform opacity-70 ${expanded ? "rotate-90" : ""}`} />
                                            <span className="font-medium uppercase tracking-[0.08em]">{groupName}</span>
                                            <span className="opacity-70">{groupItems.length}</span>
                                        </button>

                                        {expanded && (
                                            <div>
                                                {groupItems.map((todo) => {
                                                    const statusType = getFilterForTodo(todo);
                                                    const dateLabel = formatRelativeDateLabel(todo.updatedAt);
                                                    const leadTag = todo.tags?.[0];

                                                    return (
                                                        <div
                                                            key={todo.id}
                                                            className={`group border-t border-border/60 px-2.5 py-0.5 flex items-center gap-1.5 ${
                                                                selectedTodoId === todo.id ? "bg-surface-elevated/70" : ""
                                                            }`}
                                                        >
                                                            <button
                                                                onClick={() => openTodoForEdit(todo)}
                                                                className="flex-1 min-w-0 py-1.5 flex items-center gap-1.5 text-left"
                                                            >
                                                                <span
                                                                    className={`size-2 rounded-full shrink-0 ${
                                                                        statusType === "active"
                                                                            ? "bg-blue-500"
                                                                            : statusType === "completed"
                                                                                ? "bg-green-500"
                                                                                : "bg-text-muted/40"
                                                                    }`}
                                                                />

                                                                <span className="truncate text-xs text-text">{todo.title}</span>

                                                                <span className="ml-auto flex items-center gap-2 text-[10px] text-text-muted shrink-0">
                                                                    {leadTag && <span>#{leadTag}</span>}
                                                                    {dateLabel && <span>{dateLabel}</span>}
                                                                    <ChevronRight className="size-3 opacity-60" />
                                                                </span>
                                                            </button>

                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    void toggleArchiveWithToast(todo);
                                                                }}
                                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-text-muted hover:text-text hover:bg-surface-elevated"
                                                                title={todo.archived ? "restore" : "archive"}
                                                            >
                                                                {todo.archived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
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
