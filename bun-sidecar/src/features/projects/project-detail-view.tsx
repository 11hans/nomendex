import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    ArrowLeft,
    CheckCircle2,
    CheckSquare,
    ChevronDown,
    ChevronUp,
    Circle,
    Clock,
    ExternalLink,
    FileText,
    FolderKanban,
    type LucideIcon,
} from "lucide-react";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { useGoalsAPI } from "@/hooks/useGoalsAPI";
import { useTheme } from "@/hooks/useTheme";
import { GoalPicker } from "@/features/todos/pickers/GoalPicker";
import type { GoalRecord } from "@/features/goals/goal-types";
import type { ProjectConfig } from "@/features/projects/project-types";
import { todosPluginSerial } from "@/features/todos";
import { notesPluginSerial } from "@/features/notes";
import { TaskCardEditor } from "@/features/todos/TaskCardEditor";
import type { Todo } from "@/features/todos/todo-types";
import { isTimeblockTodo } from "@/features/todos/todo-filter-utils";
import type { Note } from "@/features/notes";
import { projectsPluginSerial, type ProjectDetailViewProps } from "./index";
import { toast } from "sonner";

const INITIAL_NOTES_LIMIT = 10;

function getStatusLabel(status: Todo["status"]): string {
    switch (status) {
        case "in_progress":
            return "In Progress";
        case "done":
            return "Done";
        case "later":
            return "Later";
        case "todo":
        default:
            return "Todo";
    }
}

function sortTodosByUpdatedDesc(input: Todo[]): Todo[] {
    return [...input].sort((a, b) => {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
        return bTime - aTime;
    });
}

interface SectionHeaderProps {
    title: string;
    count: number;
    icon: LucideIcon;
    color: string;
}

function SectionHeader({ title, count, icon: Icon, color }: SectionHeaderProps) {
    return (
        <div className="flex items-center gap-2 mb-2">
            <Icon size={14} style={{ color }} />
            <h3 className="text-xs font-medium uppercase tracking-[0.12em]" style={{ color }}>
                {title}
            </h3>
            <span className="text-caption">({count})</span>
        </div>
    );
}

export function ProjectDetailView({ tabId, projectName }: { tabId: string } & ProjectDetailViewProps) {
    if (!tabId) {
        throw new Error("tabId is required");
    }

    const {
        activeTab,
        setTabName,
        addNewTab,
        setActiveTabId,
        getViewSelfPlacement,
        setSidebarTabId,
        replaceTabWithNewView,
    } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const { currentTheme } = useTheme();
    const placement = getViewSelfPlacement(tabId);
    const todosAPI = useTodosAPI();
    const notesAPI = useNotesAPI();
    const projectsAPI = useProjectsAPI();
    const goalsAPI = useGoalsAPI();

    const [todos, setTodos] = useState<Todo[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [showAllNotes, setShowAllNotes] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
    const [availableGoals, setAvailableGoals] = useState<GoalRecord[]>([]);
    const [goalSaving, setGoalSaving] = useState(false);
    const lastTabNameRef = useRef<string | null>(null);

    useEffect(() => {
        if (activeTab?.id !== tabId) return;
        if (lastTabNameRef.current === projectName) return;
        setTabName(tabId, projectName);
        lastTabNameRef.current = projectName;
    }, [activeTab?.id, tabId, projectName, setTabName]);

    useEffect(() => {
        setShowAllNotes(false);
    }, [projectName]);

    const loadProjectData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const [todosResult, notesResult, tagsResult, projectsResult, projectConfigResult, goalsResult] = await Promise.all([
                todosAPI.getTodos({ project: projectName }),
                notesAPI.getNotesByProject({ project: projectName }),
                todosAPI.getTags(),
                todosAPI.getProjects(),
                projectsAPI.getProjectByName({ name: projectName }).catch(() => null),
                goalsAPI.listGoals({ status: "active" }).catch(() => []),
            ]);

            notesResult.sort((a, b) => a.fileName.localeCompare(b.fileName));
            setTodos(todosResult);
            setNotes(notesResult);
            setAvailableTags(tagsResult);
            setAvailableProjects(projectsResult);
            setProjectConfig(projectConfigResult);
            setAvailableGoals(goalsResult);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to fetch project data";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [projectName, todosAPI, notesAPI, projectsAPI, goalsAPI, setLoading, setError]);

    useEffect(() => {
        loadProjectData();
    }, [loadProjectData]);

    useEffect(() => {
        const handleCalendarSync = () => {
            void loadProjectData();
        };

        window.addEventListener("calendar-sync-update", handleCalendarSync);
        return () => {
            window.removeEventListener("calendar-sync-update", handleCalendarSync);
        };
    }, [loadProjectData]);

    const openInPlacement = useCallback(
        (newTabId: string) => {
            if (placement === "sidebar") {
                setSidebarTabId(newTabId);
            } else {
                setActiveTabId(newTabId);
            }
        },
        [placement, setActiveTabId, setSidebarTabId]
    );

    const handleOpenNote = useCallback(
        async (noteFileName: string) => {
            const newTab = await addNewTab({
                pluginMeta: notesPluginSerial,
                view: "editor",
                props: { noteFileName, compact: true },
                preferExisting: true,
            });
            if (newTab) openInPlacement(newTab.id);
        },
        [addNewTab, openInPlacement]
    );

    const handleOpenKanban = useCallback(async () => {
        const newTab = await addNewTab({
            pluginMeta: todosPluginSerial,
            view: "browser",
            props: { project: projectName },
            preferExisting: true,
        });
        if (newTab) openInPlacement(newTab.id);
    }, [addNewTab, projectName, openInPlacement]);

    const handleBackToProjects = useCallback(() => {
        replaceTabWithNewView(tabId, projectsPluginSerial, { view: "browser" });
    }, [replaceTabWithNewView, tabId]);

    const handleOpenTodo = useCallback(
        (todoId: string) => {
            const todo = todos.find((t) => t.id === todoId);
            if (!todo) return;
            setTodoToEdit(todo);
            setEditDialogOpen(true);
        },
        [todos]
    );

    const handleSaveTodo = useCallback(
        async (updatedTodo: Todo) => {
            setEditSaving(true);
            try {
                await todosAPI.updateTodo({
                    todoId: updatedTodo.id,
                    updates: {
                        title: updatedTodo.title,
                        description: updatedTodo.description,
                        status: updatedTodo.status,
                        project: updatedTodo.project,
                        tags: updatedTodo.tags,
                        scheduledStart: updatedTodo.scheduledStart ?? null,
                        scheduledEnd: updatedTodo.scheduledEnd ?? null,
                        dueDate: updatedTodo.dueDate ?? null,
                        priority: updatedTodo.priority,
                        duration: updatedTodo.duration,
                        attachments: updatedTodo.attachments,
                        customColumnId: updatedTodo.customColumnId,
                        calendarReminderPreset: updatedTodo.calendarReminderPreset,
                        goalRefs: updatedTodo.goalRefs,
                    },
                });
                setEditDialogOpen(false);
                setTodoToEdit(null);
                setTodos(await todosAPI.getTodos({ project: projectName }));
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to save todo";
                setError(errorMessage);
            } finally {
                setEditSaving(false);
            }
        },
        [todosAPI, projectName, setError]
    );

    const handleGoalChange = useCallback(
        async (goalId: string | undefined) => {
            if (!projectConfig) return;
            setGoalSaving(true);
            try {
                const updated = await projectsAPI.updateProject({
                    projectId: projectConfig.id,
                    updates: { goalRef: goalId ?? null },
                });
                setProjectConfig(updated);
                const openTodoCount = todos.filter(t => !t.archived && t.status !== "done").length;
                if (openTodoCount > 0) {
                    toast.success(`Goal updated. Will recompute linkage for ${openTodoCount} open todo${openTodoCount !== 1 ? "s" : ""} in this project.`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to update goal";
                setError(msg);
                toast.error(msg);
            } finally {
                setGoalSaving(false);
            }
        },
        [projectConfig, projectsAPI, todos, setError]
    );

    const handleDeleteTodo = useCallback(
        async (todo: Todo) => {
            try {
                await todosAPI.deleteTodo({ todoId: todo.id });
                setTodos((prev) => prev.filter((t) => t.id !== todo.id));
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to delete todo";
                setError(errorMessage);
            }
        },
        [todosAPI, setError]
    );

    const handleToggleCalendarReminder = useCallback(
        async (todo: Todo) => {
            try {
                const updated = await todosAPI.updateTodo({
                    todoId: todo.id,
                    updates: { calendarReminderPreset: todo.calendarReminderPreset },
                });
                if (!updated) return;

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
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to update calendar alerts";
                setError(errorMessage);
                toast.error("Failed to update calendar alerts");
            }
        },
        [todosAPI, projectName, setError]
    );

    const sortedTodos = useMemo(() => sortTodosByUpdatedDesc(todos.filter((todo) => !isTimeblockTodo(todo))), [todos]);
    const inProgressTodos = useMemo(
        () => sortedTodos.filter((t) => t.status === "in_progress"),
        [sortedTodos]
    );
    const todoTodos = useMemo(
        () => sortedTodos.filter((t) => t.status === "todo" || t.status === "later"),
        [sortedTodos]
    );
    const doneTodos = useMemo(
        () => sortedTodos.filter((t) => t.status === "done"),
        [sortedTodos]
    );
    const otherTodos = useMemo(
        () => sortedTodos.filter((t) => !["in_progress", "todo", "later", "done"].includes(t.status)),
        [sortedTodos]
    );

    const totalItems = sortedTodos.length + notes.length;
    const completionRate = sortedTodos.length > 0 ? Math.round((doneTodos.length / sortedTodos.length) * 100) : 0;
    const displayedNotes = showAllNotes ? notes : notes.slice(0, INITIAL_NOTES_LIMIT);
    const hasMoreNotes = notes.length > INITIAL_NOTES_LIMIT;

    const renderTodoSection = (
        title: string,
        items: Todo[],
        icon: LucideIcon,
        color: string
    ) => {
        if (items.length === 0) return null;

        const Icon = icon;
        return (
            <section>
                <SectionHeader title={title} count={items.length} icon={Icon} color={color} />
                <div
                    className="rounded-md border overflow-hidden"
                    style={{ borderColor: currentTheme.styles.borderDefault }}
                >
                    {items.map((todo, index) => (
                        <button
                            key={todo.id}
                            onClick={() => handleOpenTodo(todo.id)}
                            className="w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/50"
                            style={{
                                backgroundColor: currentTheme.styles.surfacePrimary,
                                borderBottom: index < items.length - 1 ? `1px solid ${currentTheme.styles.borderDefault}` : undefined,
                            }}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div
                                        className="text-xs font-medium truncate"
                                        style={{ color: currentTheme.styles.contentPrimary }}
                                    >
                                        {todo.title}
                                    </div>
                                    {todo.description && (
                                        <div
                                            className="text-xs truncate mt-0.5"
                                            style={{ color: currentTheme.styles.contentTertiary }}
                                        >
                                            {todo.description}
                                        </div>
                                    )}
                                </div>
                                <span
                                    className="text-caption px-2 py-0.5 rounded-full shrink-0"
                                    style={{
                                        backgroundColor: currentTheme.styles.surfaceTertiary,
                                        color: todo.status === "done"
                                            ? currentTheme.styles.semanticSuccess
                                            : currentTheme.styles.contentSecondary,
                                    }}
                                >
                                    {getStatusLabel(todo.status)}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </section>
        );
    };

    if (loading && todos.length === 0 && notes.length === 0) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading project...</div>
            </div>
        );
    }

    if (error && todos.length === 0 && notes.length === 0) {
        return (
            <div className="p-4">
                <Alert variant="destructive">
                    <AlertDescription>Error: {error}</AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div
            className="project-detail flex-1 min-w-0 min-h-0 flex flex-col"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            <div
                className="shrink-0 px-4 py-2.5 border-b"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleBackToProjects}
                            aria-label="Back to Projects"
                            className="h-6 w-6"
                        >
                            <ArrowLeft size={14} />
                        </Button>
                        <FolderKanban size={16} style={{ color: currentTheme.styles.contentAccent }} />
                        <h2
                            className="text-xs font-medium uppercase tracking-[0.14em] shrink-0"
                            style={{ color: currentTheme.styles.contentPrimary }}
                        >
                            Project
                        </h2>
                        <span
                            className="text-xs font-medium truncate"
                            style={{ color: currentTheme.styles.contentPrimary }}
                        >
                            {projectName}
                        </span>
                    </div>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleOpenKanban}
                        className="h-7 px-2.5 text-xs font-medium rounded-md shrink-0"
                    >
                        <ExternalLink size={13} className="mr-1.5" />
                        Open Kanban
                    </Button>
                </div>

                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-caption">
                    <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            color: currentTheme.styles.contentTertiary,
                        }}
                    >
                        <FileText size={11} />
                        {notes.length} notes
                    </span>
                    <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            color: currentTheme.styles.contentAccent,
                        }}
                    >
                        <Clock size={11} />
                        {inProgressTodos.length} in progress
                    </span>
                    <span
                        className="px-1.5 py-0.5 rounded"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            color: currentTheme.styles.contentSecondary,
                        }}
                    >
                        {totalItems} total items
                    </span>
                    <span
                        className="px-1.5 py-0.5 rounded"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            color: currentTheme.styles.semanticSuccess,
                        }}
                    >
                        {completionRate}% done
                    </span>
                    <GoalPicker
                        mode="single"
                        value={projectConfig?.goalRef}
                        onChange={handleGoalChange}
                        goals={availableGoals}
                        disabled={goalSaving || !projectConfig}
                    />
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>Error: {error}</AlertDescription>
                    </Alert>
                )}

                {totalItems === 0 ? (
                    <div
                        className="flex items-center justify-center min-h-[240px] text-xs"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        No notes or todos in this project yet.
                    </div>
                ) : (
                    <>
                        {notes.length > 0 && (
                            <section>
                                <SectionHeader
                                    title="Notes"
                                    count={notes.length}
                                    icon={FileText}
                                    color={currentTheme.styles.contentAccent}
                                />
                                <div
                                    className="rounded-md border overflow-hidden"
                                    style={{ borderColor: currentTheme.styles.borderDefault }}
                                >
                                    {displayedNotes.map((note, index) => {
                                        const displayName = note.fileName.replace(/\.md$/, "");
                                        const preview = note.content.slice(0, 110).trim();

                                        return (
                                            <button
                                                key={note.fileName}
                                                onClick={() => handleOpenNote(note.fileName)}
                                                className="w-full text-left px-3 py-2.5 transition-colors hover:bg-accent/50"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfacePrimary,
                                                    borderBottom: index < displayedNotes.length - 1
                                                        ? `1px solid ${currentTheme.styles.borderDefault}`
                                                        : undefined,
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <FileText size={12} style={{ color: currentTheme.styles.contentTertiary }} />
                                                    <span
                                                        className="text-xs font-medium truncate"
                                                        style={{ color: currentTheme.styles.contentPrimary }}
                                                    >
                                                        {displayName}
                                                    </span>
                                                </div>
                                                {preview && (
                                                    <div
                                                        className="text-xs truncate mt-1 pl-5"
                                                        style={{ color: currentTheme.styles.contentTertiary }}
                                                    >
                                                        {preview}
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {hasMoreNotes && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowAllNotes((prev) => !prev)}
                                        className="mt-2 h-7 px-2 text-xs"
                                        style={{ color: currentTheme.styles.contentAccent }}
                                    >
                                        {showAllNotes ? (
                                            <>
                                                <ChevronUp size={13} className="mr-1.5" />
                                                Show less
                                            </>
                                        ) : (
                                            <>
                                                <ChevronDown size={13} className="mr-1.5" />
                                                Show all {notes.length} notes
                                            </>
                                        )}
                                    </Button>
                                )}
                            </section>
                        )}

                        {renderTodoSection(
                            "In Progress",
                            inProgressTodos,
                            Clock,
                            currentTheme.styles.contentAccent
                        )}
                        {renderTodoSection(
                            "Todo",
                            todoTodos,
                            Circle,
                            currentTheme.styles.contentSecondary
                        )}
                        {renderTodoSection(
                            "Done",
                            doneTodos,
                            CheckCircle2,
                            currentTheme.styles.semanticSuccess
                        )}
                        {renderTodoSection(
                            "Other",
                            otherTodos,
                            CheckSquare,
                            currentTheme.styles.contentTertiary
                        )}
                    </>
                )}
            </div>

            <TaskCardEditor
                todo={todoToEdit}
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                onSave={handleSaveTodo}
                onDelete={handleDeleteTodo}
                onToggleCalendarReminder={handleToggleCalendarReminder}
                saving={editSaving}
                availableTags={availableTags}
                availableProjects={availableProjects}
                goals={availableGoals}
            />
        </div>
    );
}

export default ProjectDetailView;
