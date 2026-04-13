import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle, ArrowLeft, CheckSquare, ExternalLink, FileText,
    FolderKanban, Target, Pencil, Check, X, Trash2, ChevronDown,
} from "lucide-react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { goalsAPI } from "@/hooks/useGoalsAPI";
import { notesAPI } from "@/hooks/useNotesAPI";
import { useTheme } from "@/hooks/useTheme";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { GoalRecord } from "./goal-types";
import type { GoalGraphView } from "./goals-view-types";
import { GoalDetailViewProps, goalsPluginSerial } from "./plugin";
import { projectsPluginSerial } from "@/features/projects";
import { todosPluginSerial } from "@/features/todos";
import { notesPluginSerial } from "@/features/notes";
import type { Todo } from "@/features/todos/todo-types";
import { statusLabel, getHorizonLabel, todoStatusColor } from "./goals-view-model";

const STATUS_OPTIONS: GoalRecord["status"][] = ["active", "completed", "paused", "dropped"];
const HORIZON_OPTIONS: GoalRecord["horizon"][] = ["vision", "yearly", "quarterly", "monthly"];

function InlineDropdown<T extends string>({
    value,
    options,
    labelFn,
    onSelect,
    styles,
}: {
    value: T;
    options: T[];
    labelFn: (v: T) => string;
    onSelect: (v: T) => void;
    styles: ReturnType<typeof useTheme>["currentTheme"]["styles"];
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption transition-colors hover:ring-1 hover:ring-offset-1"
                    style={{
                        backgroundColor: styles.surfaceTertiary,
                        color: styles.contentSecondary,
                    }}
                >
                    {labelFn(value)}
                    <ChevronDown className="size-2.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                {options.map((option) => (
                    <DropdownMenuItem
                        key={option}
                        onClick={() => onSelect(option as T)}
                        className={option === value ? "font-medium" : ""}
                    >
                        {labelFn(option as T)}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function EditableText({
    value,
    onSave,
    styles,
    className,
    placeholder,
    multiline,
}: {
    value: string;
    onSave: (v: string) => void;
    styles: ReturnType<typeof useTheme>["currentTheme"]["styles"];
    className?: string;
    placeholder?: string;
    multiline?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus({ preventScroll: true });
            inputRef.current?.select();
        }
    }, [editing]);

    const commit = () => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) {
            onSave(trimmed);
        } else {
            setDraft(value);
        }
        setEditing(false);
    };

    const cancel = () => {
        setDraft(value);
        setEditing(false);
    };

    if (!editing) {
        return (
            <button
                onClick={() => setEditing(true)}
                className={`group inline-flex items-center gap-1.5 text-left ${className ?? ""}`}
                title="Click to edit"
            >
                <span>{value || placeholder}</span>
                <Pencil className="size-2.5 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
            </button>
        );
    }

    const sharedProps = {
        value: draft,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
            if (e.key === "Escape") cancel();
        },
        className: `w-full rounded-md border px-2 py-1 text-xs bg-transparent ${className ?? ""}`,
        style: {
            borderColor: styles.borderDefault,
            color: styles.contentPrimary,
        } as React.CSSProperties,
    };

    return (
        <div className="flex items-start gap-1">
            {multiline ? (
                <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    {...sharedProps}
                    rows={3}
                    onChange={(e) => setDraft(e.target.value)}
                />
            ) : (
                <input
                    ref={inputRef as React.RefObject<HTMLInputElement>}
                    {...sharedProps}
                    onChange={(e) => setDraft(e.target.value)}
                />
            )}
            <button onClick={commit} className="p-0.5 rounded hover:bg-surface-elevated" title="Save">
                <Check className="size-3" style={{ color: styles.semanticSuccess }} />
            </button>
            <button onClick={cancel} className="p-0.5 rounded hover:bg-surface-elevated" title="Cancel">
                <X className="size-3" style={{ color: styles.contentTertiary }} />
            </button>
        </div>
    );
}

function ProgressEditor({
    goal,
    computedProgress,
    onSave,
    styles,
}: {
    goal: GoalRecord;
    computedProgress: number;
    onSave: (updates: Record<string, unknown>) => void;
    styles: ReturnType<typeof useTheme>["currentTheme"]["styles"];
}) {
    if (goal.progressMode === "rollup" || goal.progressMode === "milestone") {
        return (
            <div
                className="text-xs"
                style={{ color: styles.contentTertiary }}
            >
                {computedProgress}% (computed from {goal.progressMode === "rollup" ? "linked work" : "milestones"})
            </div>
        );
    }

    if (goal.progressMode === "manual") {
        const val = "progressValue" in goal ? goal.progressValue : 0;
        return (
            <div className="flex items-center gap-2">
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={val}
                    onChange={(e) => onSave({ progressValue: Number(e.target.value) })}
                    className="flex-1 h-1.5 accent-current"
                    style={{ color: styles.contentAccent }}
                />
                <span className="text-xs tabular-nums w-8 text-right" style={{ color: styles.contentSecondary }}>
                    {val}%
                </span>
            </div>
        );
    }

    if (goal.progressMode === "metric") {
        const current = "progressCurrent" in goal ? goal.progressCurrent : 0;
        const target = "progressTarget" in goal ? goal.progressTarget : 100;
        return (
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    value={current}
                    onChange={(e) => onSave({ progressCurrent: Number(e.target.value) })}
                    className="w-16 rounded-md border px-2 py-0.5 text-xs bg-transparent"
                    style={{ borderColor: styles.borderDefault, color: styles.contentPrimary }}
                />
                <span className="text-xs" style={{ color: styles.contentTertiary }}>/</span>
                <input
                    type="number"
                    value={target}
                    onChange={(e) => onSave({ progressTarget: Number(e.target.value) })}
                    className="w-16 rounded-md border px-2 py-0.5 text-xs bg-transparent"
                    style={{ borderColor: styles.borderDefault, color: styles.contentPrimary }}
                />
                <span className="text-xs" style={{ color: styles.contentSecondary }}>
                    ({computedProgress}%)
                </span>
            </div>
        );
    }

    return null;
}

export function GoalDetailView({ tabId, goalId }: { tabId: string } & GoalDetailViewProps) {
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
        updateTabProps,
    } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const { currentTheme } = useTheme();
    const placement = getViewSelfPlacement(tabId);
    const lastTabNameRef = useRef<string | null>(null);

    const [graph, setGraph] = useState<GoalGraphView | null>(null);
    const [parentGoal, setParentGoal] = useState<GoalRecord | null>(null);
    const [mirrorNoteFile, setMirrorNoteFile] = useState<string | null>(null);

    const loadGoalDetail = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const graphData = await goalsAPI.getGoalGraph({ goalId });
            setGraph(graphData);

            if (graphData.goal.parentGoalId) {
                const parent = await goalsAPI.getGoal({ goalId: graphData.goal.parentGoalId }).catch(() => null);
                setParentGoal(parent);
            } else {
                setParentGoal(null);
            }

            if (graphData.goal.mirrorNoteFile) {
                const mtime = await notesAPI.getNoteMtime({ fileName: graphData.goal.mirrorNoteFile }).catch(() => ({ mtime: null }));
                setMirrorNoteFile(mtime.mtime !== null ? graphData.goal.mirrorNoteFile : null);
            } else {
                setMirrorNoteFile(null);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to fetch goal detail";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [goalId, setError, setLoading]);

    useEffect(() => {
        void loadGoalDetail();
    }, [loadGoalDetail]);

    useEffect(() => {
        if (activeTab?.id !== tabId || !graph) return;
        if (lastTabNameRef.current === graph.goal.title) return;
        setTabName(tabId, graph.goal.title);
        lastTabNameRef.current = graph.goal.title;
    }, [activeTab?.id, graph, setTabName, tabId]);

    const handleUpdateGoal = useCallback(async (updates: Record<string, unknown>) => {
        if (!graph) return;
        try {
            const updated = await goalsAPI.updateGoal({ goalId, updates });
            setGraph((prev) => prev ? { ...prev, goal: updated } : prev);
            if (updates.title && typeof updates.title === "string") {
                setTabName(tabId, updates.title);
                lastTabNameRef.current = updates.title;
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update goal");
        }
    }, [goalId, graph, setTabName, tabId]);

    const handleDeleteGoal = useCallback(async () => {
        if (!graph) return;
        try {
            await goalsAPI.deleteGoal({ goalId });
            toast.success("Goal deleted");
            replaceTabWithNewView(tabId, goalsPluginSerial, { view: "browser" });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete goal");
        }
    }, [goalId, graph, replaceTabWithNewView, tabId]);

    const openInPlacement = useCallback((targetTabId: string) => {
        if (placement === "sidebar") {
            setSidebarTabId(targetTabId);
        } else {
            setActiveTabId(targetTabId);
        }
    }, [placement, setActiveTabId, setSidebarTabId]);

    const handleBackToGoals = useCallback(() => {
        replaceTabWithNewView(tabId, goalsPluginSerial, { view: "browser" });
    }, [replaceTabWithNewView, tabId]);

    const handleOpenChildGoal = useCallback(async (childGoalId: string) => {
        const tab = await addNewTab({
            pluginMeta: goalsPluginSerial,
            view: "detail",
            props: { goalId: childGoalId },
            preferExisting: true,
        });
        if (tab) openInPlacement(tab.id);
    }, [addNewTab, openInPlacement]);

    const handleOpenProject = useCallback(async (projectName: string) => {
        const tab = await addNewTab({
            pluginMeta: projectsPluginSerial,
            view: "detail",
            props: { projectName },
            preferExisting: true,
        });
        if (tab) openInPlacement(tab.id);
    }, [addNewTab, openInPlacement]);

    const handleOpenTodoContext = useCallback(async (todo: Todo) => {
        const nextProps: Record<string, unknown> = {
            selectedTodoId: todo.id,
        };
        if (todo.project) {
            nextProps.project = todo.project;
        }

        const tab = await addNewTab({
            pluginMeta: todosPluginSerial,
            view: "browser",
            props: nextProps,
            preferExisting: true,
        });

        if (tab) {
            updateTabProps(tab.id, nextProps);
            openInPlacement(tab.id);
        }
    }, [addNewTab, openInPlacement, updateTabProps]);

    const handleOpenMirrorNote = useCallback(async () => {
        if (!mirrorNoteFile) return;
        const tab = await addNewTab({
            pluginMeta: notesPluginSerial,
            view: "editor",
            props: { noteFileName: mirrorNoteFile },
            preferExisting: true,
        });
        if (tab) openInPlacement(tab.id);
    }, [addNewTab, mirrorNoteFile, openInPlacement]);

    const quickProject = graph?.linkedProjects[0] ?? null;
    const quickTodo = graph?.linkedTodos[0] ?? null;

    const sortedChildGoals = useMemo(
        () => [...(graph?.childGoals ?? [])].sort((a, b) => a.title.localeCompare(b.title)),
        [graph?.childGoals],
    );

    if (loading) {
        return (
            <div
                className="h-full flex items-center justify-center text-xs"
                style={{ color: currentTheme.styles.contentTertiary }}
            >
                loading goal detail...
            </div>
        );
    }

    if (error) {
        return (
            <div
                className="h-full flex items-center justify-center px-4 text-xs"
                style={{ color: currentTheme.styles.semanticDestructive }}
            >
                failed to load goal detail: {error}
            </div>
        );
    }

    if (!graph) {
        return (
            <div
                className="h-full flex items-center justify-center text-xs"
                style={{ color: currentTheme.styles.contentTertiary }}
            >
                goal not found
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col min-h-0" style={{ backgroundColor: currentTheme.styles.surfacePrimary }}>
            <div
                className="shrink-0 px-4 py-2.5 border-b"
                style={{
                    borderColor: currentTheme.styles.borderDefault,
                    backgroundColor: currentTheme.styles.surfacePrimary,
                }}
            >
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleBackToGoals}
                        className="rounded p-1 transition-colors hover:bg-surface-elevated"
                        aria-label="Back to Goals"
                    >
                        <ArrowLeft size={14} style={{ color: currentTheme.styles.contentSecondary }} />
                    </button>
                    <Target size={16} style={{ color: currentTheme.styles.contentAccent }} />
                    <div className="flex-1 min-w-0">
                        <EditableText
                            value={graph.goal.title}
                            onSave={(title) => { void handleUpdateGoal({ title }); }}
                            styles={currentTheme.styles}
                            className="text-xs font-medium"
                        />
                    </div>
                    <span
                        className="ml-auto rounded-full px-1.5 py-0.5 text-caption"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceTertiary,
                            color: currentTheme.styles.contentSecondary,
                        }}
                    >
                        {graph.computedProgress}%
                    </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <InlineDropdown
                        value={graph.goal.status}
                        options={STATUS_OPTIONS}
                        labelFn={statusLabel}
                        onSelect={(v) => { void handleUpdateGoal({ status: v }); }}
                        styles={currentTheme.styles}
                    />
                    <InlineDropdown
                        value={graph.goal.horizon}
                        options={HORIZON_OPTIONS}
                        labelFn={getHorizonLabel}
                        onSelect={(v) => { void handleUpdateGoal({ horizon: v }); }}
                        styles={currentTheme.styles}
                    />
                    <EditableText
                        value={graph.goal.area}
                        onSave={(area) => { void handleUpdateGoal({ area }); }}
                        styles={currentTheme.styles}
                        className="rounded-full px-1.5 py-0.5 text-caption"
                        placeholder="Set area..."
                    />
                    {parentGoal && (
                        <button
                            onClick={() => { void handleOpenChildGoal(parentGoal.id); }}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption transition-colors hover:bg-surface-elevated"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceTertiary,
                                color: currentTheme.styles.contentAccent,
                            }}
                            title="Open parent goal"
                        >
                            parent: {parentGoal.title}
                        </button>
                    )}
                </div>

                {(quickProject || quickTodo || mirrorNoteFile) ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {quickProject && (
                            <button
                                onClick={() => { void handleOpenProject(quickProject.name); }}
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-surface-elevated"
                                style={{ borderColor: currentTheme.styles.borderDefault }}
                            >
                                <FolderKanban className="size-3" />
                                {quickProject.name}
                            </button>
                        )}
                        {quickTodo && (
                            <button
                                onClick={() => { void handleOpenTodoContext(quickTodo); }}
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-surface-elevated"
                                style={{ borderColor: currentTheme.styles.borderDefault }}
                            >
                                <CheckSquare className="size-3" />
                                {quickTodo.title}
                            </button>
                        )}
                        {mirrorNoteFile && (
                            <button
                                onClick={() => { void handleOpenMirrorNote(); }}
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-surface-elevated"
                                style={{ borderColor: currentTheme.styles.borderDefault }}
                            >
                                <FileText className="size-3" />
                                Mirror Note
                            </button>
                        )}
                    </div>
                ) : (
                    <div
                        className="mt-2 text-caption"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        No linked projects, todos, or mirror note yet.
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                <section
                    className="rounded-md border px-3 py-2.5"
                    style={{
                        borderColor: currentTheme.styles.borderDefault,
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                    }}
                >
                    <div
                        className="text-caption uppercase tracking-[0.1em]"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        Description
                    </div>
                    <div className="mt-1">
                        <EditableText
                            value={graph.goal.description ?? ""}
                            onSave={(description) => { void handleUpdateGoal({ description }); }}
                            styles={currentTheme.styles}
                            className="text-xs"
                            placeholder="Add a description..."
                            multiline
                        />
                    </div>
                </section>

                <section
                    className="rounded-md border px-3 py-2.5"
                    style={{
                        borderColor: currentTheme.styles.borderDefault,
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                    }}
                >
                    <div
                        className="text-caption uppercase tracking-[0.1em]"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        Progress ({graph.goal.progressMode})
                    </div>
                    <div className="mt-1.5">
                        <ProgressEditor
                            goal={graph.goal}
                            computedProgress={graph.computedProgress}
                            onSave={(updates) => { void handleUpdateGoal(updates); }}
                            styles={currentTheme.styles}
                        />
                    </div>
                </section>

                <section className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                        <Target className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                        <span className="text-caption uppercase tracking-[0.12em]" style={{ color: currentTheme.styles.contentSecondary }}>
                            Child Goals
                        </span>
                        <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                            {sortedChildGoals.length}
                        </span>
                    </div>
                    {sortedChildGoals.length === 0 ? (
                        <div
                            className="rounded-md border px-2.5 py-2 text-xs"
                            style={{
                                borderColor: currentTheme.styles.borderDefault,
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                color: currentTheme.styles.contentTertiary,
                            }}
                        >
                            This goal has no child goals yet.
                        </div>
                    ) : (
                        <div
                            className="rounded-md border"
                            style={{ borderColor: currentTheme.styles.borderDefault }}
                        >
                            {sortedChildGoals.map((child, idx) => (
                                <button
                                    key={child.id}
                                    onClick={() => { void handleOpenChildGoal(child.id); }}
                                    className={`w-full border-t px-2.5 py-2 text-left transition-colors hover:bg-surface-elevated ${idx === 0 ? "border-t-0" : ""}`}
                                    style={{ borderColor: currentTheme.styles.borderDefault }}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                                            {child.title}
                                        </span>
                                        <span className="ml-auto text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                                            {statusLabel(child.status)}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                        <FolderKanban className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                        <span className="text-caption uppercase tracking-[0.12em]" style={{ color: currentTheme.styles.contentSecondary }}>
                            Linked Projects
                        </span>
                        <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                            {graph.linkedProjects.length}
                        </span>
                    </div>
                    {graph.linkedProjects.length === 0 ? (
                        <div
                            className="rounded-md border px-2.5 py-2 text-xs"
                            style={{
                                borderColor: currentTheme.styles.borderDefault,
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                color: currentTheme.styles.contentTertiary,
                            }}
                        >
                            No projects are linked to this goal.
                        </div>
                    ) : (
                        <div
                            className="rounded-md border"
                            style={{ borderColor: currentTheme.styles.borderDefault }}
                        >
                            {graph.linkedProjects.map((project, idx) => (
                                <button
                                    key={project.id}
                                    onClick={() => { void handleOpenProject(project.name); }}
                                    className={`w-full border-t px-2.5 py-2 text-left transition-colors hover:bg-surface-elevated ${idx === 0 ? "border-t-0" : ""}`}
                                    style={{ borderColor: currentTheme.styles.borderDefault }}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                                            {project.name}
                                        </span>
                                        <ExternalLink className="ml-auto size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                        <CheckSquare className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                        <span className="text-caption uppercase tracking-[0.12em]" style={{ color: currentTheme.styles.contentSecondary }}>
                            Linked Todos
                        </span>
                        <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                            {graph.linkedTodos.length}
                        </span>
                    </div>
                    {graph.linkedTodos.length === 0 ? (
                        <div
                            className="rounded-md border px-2.5 py-2 text-xs"
                            style={{
                                borderColor: currentTheme.styles.borderDefault,
                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                color: currentTheme.styles.contentTertiary,
                            }}
                        >
                            No todos are linked to this goal.
                        </div>
                    ) : (
                        <div
                            className="rounded-md border"
                            style={{ borderColor: currentTheme.styles.borderDefault }}
                        >
                            {graph.linkedTodos.map((todo, idx) => (
                                <button
                                    key={todo.id}
                                    onClick={() => { void handleOpenTodoContext(todo); }}
                                    className={`w-full border-t px-2.5 py-2 text-left transition-colors hover:bg-surface-elevated ${idx === 0 ? "border-t-0" : ""}`}
                                    style={{ borderColor: currentTheme.styles.borderDefault }}
                                >
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="size-1.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: todoStatusColor(todo.status, currentTheme.styles) }}
                                        />
                                        <span className="text-xs font-medium truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                                            {todo.title}
                                        </span>
                                        <span className="ml-auto shrink-0 text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                                            {todo.project ?? "Inbox"}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                {!mirrorNoteFile && (
                    <div
                        className="rounded-md border px-2.5 py-2 text-xs"
                        style={{
                            borderColor: currentTheme.styles.borderDefault,
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            color: currentTheme.styles.contentTertiary,
                        }}
                    >
                        <span className="inline-flex items-center gap-1">
                            <AlertTriangle className="size-3" />
                            Mirror note is not available for this goal yet.
                        </span>
                    </div>
                )}

                <div className="pt-2 border-t" style={{ borderColor: currentTheme.styles.borderDefault }}>
                    <button
                        onClick={() => { void handleDeleteGoal(); }}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-surface-elevated"
                        style={{ color: currentTheme.styles.semanticDestructive }}
                    >
                        <Trash2 className="size-3" />
                        Delete goal
                    </button>
                </div>
            </div>
        </div>
    );
}

export default GoalDetailView;
