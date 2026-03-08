import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CheckSquare, Clock, Save } from "lucide-react";
import type { Todo } from "./todo-types";

const STATUS_OPTIONS = [
    { value: "todo", label: "To Do" },
    { value: "in_progress", label: "In Progress" },
    { value: "done", label: "Done" },
    { value: "later", label: "Later" },
] as const;

type TodoStatus = (typeof STATUS_OPTIONS)[number]["value"];

interface TodoDraft {
    title: string;
    description: string;
    status: TodoStatus;
    project: string;
}

function toDraft(todo: Todo): TodoDraft {
    return {
        title: todo.title,
        description: todo.description ?? "",
        status: todo.status,
        project: todo.project ?? "",
    };
}

function formatTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "n/a";
    return date.toLocaleString();
}

export function TodosView({ todoId, tabId }: { todoId: string; tabId: string }) {
    const { activeTab, setTabName, closeTab } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const { currentTheme } = useTheme();
    const todosAPI = useTodosAPI();

    const [todo, setTodo] = useState<Todo | null>(null);
    const [draft, setDraft] = useState<TodoDraft | null>(null);
    const [projectOptions, setProjectOptions] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const lastTabNameRef = useRef<string | null>(null);

    useEffect(() => {
        if (!todoId) {
            setError("Missing todo ID");
            return;
        }

        const loadTodo = async () => {
            try {
                setLoading(true);
                setError(null);

                const [todoData, projects] = await Promise.all([
                    todosAPI.getTodoById({ todoId }),
                    todosAPI.getProjects().catch(() => []),
                ]);

                setTodo(todoData);
                setDraft(toDraft(todoData));
                setProjectOptions(
                    projects
                        .map((project) => project.trim())
                        .filter((project) => project.length > 0)
                        .sort((a, b) => a.localeCompare(b))
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : "Failed to load todo";
                setError(message);
            } finally {
                setLoading(false);
            }
        };

        loadTodo();
    }, [todoId, todosAPI, setLoading, setError]);

    useEffect(() => {
        if (activeTab?.id !== tabId || !todo) return;
        const nextName = todo.title.trim() || "Todo";
        if (lastTabNameRef.current === nextName) return;
        setTabName(tabId, nextName);
        lastTabNameRef.current = nextName;
    }, [activeTab?.id, tabId, todo, setTabName]);

    const hasChanges = useMemo(() => {
        if (!todo || !draft) return false;
        const original = toDraft(todo);
        return (
            draft.title !== original.title
            || draft.description !== original.description
            || draft.status !== original.status
            || draft.project !== original.project
        );
    }, [todo, draft]);

    const handleSave = useCallback(async () => {
        if (!todo || !draft || !hasChanges) return;

        const trimmedTitle = draft.title.trim();
        if (!trimmedTitle) {
            setError("Title cannot be empty");
            return;
        }

        try {
            setSaving(true);
            setError(null);

            const updatedTodo = await todosAPI.updateTodo({
                todoId: todo.id,
                updates: {
                    title: trimmedTitle,
                    description: draft.description.trim() || undefined,
                    status: draft.status,
                    project: draft.project.trim() || undefined,
                },
            });

            setTodo(updatedTodo);
            setDraft(toDraft(updatedTodo));
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to save todo";
            setError(message);
        } finally {
            setSaving(false);
        }
    }, [todo, draft, hasChanges, todosAPI, setError]);

    if (!todoId) {
        return (
            <div className="p-4">
                <Alert variant="destructive">
                    <AlertDescription>Missing todo ID.</AlertDescription>
                </Alert>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading todo...</div>
            </div>
        );
    }

    if (!todo || !draft) {
        return (
            <div className="p-4">
                <Alert variant="destructive">
                    <AlertDescription>{error ?? `Todo "${todoId}" could not be loaded.`}</AlertDescription>
                </Alert>
            </div>
        );
    }

    const statusLabel = STATUS_OPTIONS.find((option) => option.value === draft.status)?.label ?? draft.status;
    const projectListId = `todo-projects-${tabId}`;

    return (
        <div
            className="todo-detail flex-1 min-w-0 min-h-0 flex flex-col"
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
                            onClick={() => closeTab(tabId)}
                            aria-label="Back to Todos"
                            className="h-6 w-6"
                        >
                            <ArrowLeft size={14} />
                        </Button>
                        <CheckSquare size={16} style={{ color: currentTheme.styles.contentAccent }} />
                        <h2
                            className="text-[11px] font-medium uppercase tracking-[0.14em] truncate"
                            style={{ color: currentTheme.styles.contentPrimary }}
                        >
                            Todo Detail
                        </h2>
                        <span
                            className="text-[10px] px-2 py-0.5 rounded-full"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceTertiary,
                                color: draft.status === "done" ? currentTheme.styles.semanticSuccess : currentTheme.styles.contentSecondary,
                            }}
                        >
                            {statusLabel}
                        </span>
                    </div>
                    <Button
                        onClick={handleSave}
                        disabled={saving || !hasChanges}
                        className="h-7 px-2.5 text-[11px] font-medium rounded-md"
                    >
                        <Save size={13} className="mr-1.5" />
                        {saving ? "Saving..." : "Save"}
                    </Button>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                    <span className="truncate">{todo.id}</span>
                    <span className="inline-flex items-center gap-1">
                        <Clock size={11} />
                        Created {formatTimestamp(todo.createdAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <Clock size={11} />
                        Updated {formatTimestamp(todo.updatedAt)}
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <section
                    className="rounded-lg border p-4 space-y-3"
                    style={{
                        backgroundColor: currentTheme.styles.surfacePrimary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-[0.12em]" style={{ color: currentTheme.styles.contentSecondary }}>
                            Title
                        </Label>
                        <Input
                            value={draft.title}
                            onChange={(e) => setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                            placeholder="What needs to be done?"
                            className="text-sm"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                borderColor: currentTheme.styles.borderDefault,
                                color: currentTheme.styles.contentPrimary,
                            }}
                        />
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-[0.12em]" style={{ color: currentTheme.styles.contentSecondary }}>
                            Description
                        </Label>
                        <Textarea
                            value={draft.description}
                            onChange={(e) => setDraft((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                            placeholder="Additional details..."
                            className="min-h-28 text-sm"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                borderColor: currentTheme.styles.borderDefault,
                                color: currentTheme.styles.contentPrimary,
                            }}
                        />
                    </div>
                </section>

                <section
                    className="rounded-lg border p-4"
                    style={{
                        backgroundColor: currentTheme.styles.surfacePrimary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-[11px] uppercase tracking-[0.12em]" style={{ color: currentTheme.styles.contentSecondary }}>
                                Status
                            </Label>
                            <Select
                                value={draft.status}
                                onValueChange={(value: TodoStatus) => setDraft((prev) => (prev ? { ...prev, status: value } : prev))}
                            >
                                <SelectTrigger
                                    className="text-sm"
                                    style={{
                                        backgroundColor: currentTheme.styles.surfaceSecondary,
                                        borderColor: currentTheme.styles.borderDefault,
                                        color: currentTheme.styles.contentPrimary,
                                    }}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-[11px] uppercase tracking-[0.12em]" style={{ color: currentTheme.styles.contentSecondary }}>
                                Project
                            </Label>
                            <Input
                                value={draft.project}
                                onChange={(e) => setDraft((prev) => (prev ? { ...prev, project: e.target.value } : prev))}
                                placeholder="Project name"
                                list={projectListId}
                                className="text-sm"
                                style={{
                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                    borderColor: currentTheme.styles.borderDefault,
                                    color: currentTheme.styles.contentPrimary,
                                }}
                            />
                            <datalist id={projectListId}>
                                {projectOptions.map((project) => (
                                    <option key={project} value={project} />
                                ))}
                            </datalist>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
