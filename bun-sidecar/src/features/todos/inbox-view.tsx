import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useTheme } from "@/hooks/useTheme";
import { subscribe } from "@/lib/events";

import { Button } from "@/components/ui/button";
import { Search, Plus, Archive } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { TodoCard } from "./TodoCard";
import { CreateTodoDialog } from "./CreateTodoDialog";
import { TaskCardEditor } from "./TaskCardEditor";
import { TagFilter } from "./TagFilter";
import { PriorityFilter } from "./PriorityFilter";
import { Todo } from "./todo-types";
import { removeTaskFromCalendar } from "./calendar-bridge";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";

export function InboxListView() {
    const { loading, setLoading } = usePlugin();
    const { activeTab, setTabName } = useWorkspaceContext();
    const { currentTheme } = useTheme();

    const todosAPI = useTodosAPI();
    const [todos, setTodos] = useState<Todo[]>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedPriority, setSelectedPriority] = useState<"high" | "medium" | "low" | "none" | null>(null);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
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

    // Search and keyboard navigation state
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Close all dialogs when tabs are being closed
    useEffect(() => {
        return subscribe("workspace:closeAllTabs", () => {
            setCreateDialogOpen(false);
            setEditDialogOpen(false);
        });
    }, []);

    // Update the tab name based on the project - only once when component mounts
    useEffect(() => {
        if (activeTab && activeTab.pluginInstance.plugin.id === "todos" && !hasSetTabNameRef.current) {
            setTabName(activeTab.id, "Inbox");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab, setTabName]);

    const loadTodos = useCallback(async () => {
        setLoading(true);
        try {
            const data = await todosAPI.getTodos({ project: "Inbox" });
            setTodos(data.filter(t => !t.archived));

            // Load tags and projects
            const [tags, projects] = await Promise.all([
                todosAPI.getTags(),
                todosAPI.getProjects()
            ]);
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
            await loadTodos();
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
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        try {
            await todosAPI.deleteTodo({ todoId: todo.id });
            removeTaskFromCalendar(todo.id).catch(() => { });

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

    const archiveTodoWithToast = useCallback(async (todo: Todo) => {
        setTodos(prev => prev.filter(t => t.id !== todo.id));
        try {
            await todosAPI.archiveTodo({ todoId: todo.id });
            removeTaskFromCalendar(todo.id).catch(() => { });

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
        } catch {
            toast.error("Failed to archive");
            await loadTodos();
        }
    }, [todosAPI, loadTodos]);

    const handleTagToggle = (tag: string) => {
        setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
        );
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

    const handleClearAllTags = () => setSelectedTags([]);

    const filteredTodos = useMemo(() => {
        let ft = todos;
        if (searchQuery.trim()) {
            ft = ft.filter((todo) =>
                fuzzySearch(searchQuery, todo.title) ||
                (todo.description && fuzzySearch(searchQuery, todo.description))
            );
        }
        if (selectedTags.length > 0) {
            ft = ft.filter((todo) =>
                todo.tags?.some((tag) => selectedTags.includes(tag))
            );
        }
        if (selectedPriority) {
            ft = ft.filter((todo) =>
                (todo.priority || "none") === selectedPriority
            );
        }
        // sort by newest first or just display order
        return ft;
    }, [todos, selectedTags, selectedPriority, searchQuery]);

    return (
        <div className="px-6 py-4 h-full flex flex-col overflow-hidden max-w-4xl mx-auto w-full">
            <h1 className="text-2xl font-bold mb-4 flex-shrink-0">Inbox</h1>

            <div className="flex items-center justify-between flex-shrink-0 mb-6 flex-wrap gap-4">
                <div className="flex items-center gap-3">
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
                    />
                    <div className="relative w-64">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: currentTheme.styles.contentTertiary }} />
                        <Input
                            ref={searchInputRef}
                            placeholder="Search inbox..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ color: currentTheme.styles.contentPrimary }}
                            className="pl-8 h-9"
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <TagFilter
                        availableTags={availableTags}
                        selectedTags={selectedTags}
                        onTagToggle={handleTagToggle}
                        onClearAll={handleClearAllTags}
                    />
                    <PriorityFilter
                        selectedPriority={selectedPriority}
                        onPriorityChange={setSelectedPriority}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto outline-none pr-2">
                <div className="space-y-3 pb-8">
                    {filteredTodos.map((todo) => (
                        <div key={todo.id} onClick={() => handleOpenTodo(todo.id)} className="cursor-pointer">
                            <TodoCard
                                todo={todo}
                                onEdit={(t) => handleOpenTodo(t.id)}
                                onDelete={deleteTodoWithToast}
                                onArchive={archiveTodoWithToast}
                                hideProject={true}
                            />
                        </div>
                    ))}
                    {filteredTodos.length === 0 && (
                        <div className="text-center py-16 px-4 bg-muted/20 rounded-xl border border-dashed border-border mt-8">
                            <div className="flex justify-center mb-4">
                                <div className="p-4 bg-muted/40 rounded-full">
                                    <Archive className="w-8 h-8 text-muted-foreground" />
                                </div>
                            </div>
                            <h3 className="text-lg font-medium text-foreground mb-2">Inbox is empty</h3>
                            <p className="text-muted-foreground max-w-sm mx-auto mb-6">
                                Any tasks added here without a specific project will appear in this list. Use this space to quickly dump ideas and organize them later.
                            </p>
                            <Button onClick={() => setCreateDialogOpen(true)}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Task
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <TaskCardEditor
                todo={todoToEdit}
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                onSave={handleSaveTodo}
                onDelete={deleteTodoWithToast}
                saving={editSaving}
                availableTags={availableTags}
                availableProjects={availableProjects}
            />
        </div>
    );
}
