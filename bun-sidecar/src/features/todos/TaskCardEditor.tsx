import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, X, Trash2, ListChecks, Bell, Plus } from "lucide-react";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useTheme } from "@/hooks/useTheme";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { Todo } from "./todo-types";
import { AttachmentThumbnail } from "@/components/AttachmentThumbnail";
import {
    KindPicker,
    StatusPicker,
    PriorityPicker,
    ProjectPicker,
    TagsPicker,
    DateTimePicker,
    ScheduledDateTimePicker,
    AttachmentPicker,
    GoalPicker,
} from "./pickers";
import type { GoalRecord } from "@/features/goals/goal-types";
import { applyTodoKindToDraft, getTodoKindLabel } from "./todo-kind-utils";

interface TaskCardEditorProps {
    todo: Todo | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (todo: Todo) => void;
    onDelete?: (todo: Todo) => void;
    onToggleCalendarReminder?: (todo: Todo) => void;
    saving: boolean;
    availableTags: string[];
    availableProjects: string[];
    goals?: GoalRecord[];
}

/**
 * TaskCardEditor is the primary popup/dialog component for editing todo details.
 * It is triggered when a user clicks on a todo in the Kanban board or Inbox view.
 */
export function TaskCardEditor({ todo, open, onOpenChange, onSave, onDelete, onToggleCalendarReminder, saving, availableTags, availableProjects, goals = [] }: TaskCardEditorProps) {
    const [editedTodo, setEditedTodo] = useState<Todo | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const descriptionRef = useRef<HTMLTextAreaElement>(null);
    const reminderAutoDisabledRef = useRef(false);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const api = useTodosAPI();

    // Subtask state
    const [subtasks, setSubtasks] = useState<Todo[]>([]);
    const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
    const [addingSubtask, setAddingSubtask] = useState(false);
    const newSubtaskInputRef = useRef<HTMLInputElement>(null);

    const fetchSubtasks = useCallback(async (parentId: string) => {
        const result = await api.getSubtasks({ parentTodoId: parentId });
        setSubtasks(result);
    }, [api]);

    useEffect(() => {
        if (!todo?.id || todo.parentTodoId) {
            setSubtasks([]);
            return;
        }
        fetchSubtasks(todo.id);
    }, [todo?.id, todo?.parentTodoId, fetchSubtasks]);

    useEffect(() => {
        if (addingSubtask) {
            requestAnimationFrame(() => newSubtaskInputRef.current?.focus());
        }
    }, [addingSubtask]);

    const hasTimedSchedule = (item: Pick<Todo, "scheduledStart" | "scheduledEnd">): boolean =>
        Boolean(item.scheduledStart?.includes("T") || item.scheduledEnd?.includes("T"));

    // Handle Cmd+Enter from native Mac app
    useNativeSubmit(() => {
        if (open && editedTodo?.title.trim() && !saving) {
            document.querySelector<HTMLButtonElement>('[data-task-editor-save]')?.click();
        }
    });

    useEffect(() => {
        if (!todo) {
            setEditedTodo(null);
            reminderAutoDisabledRef.current = false;
            return;
        }

        setEditedTodo({
            ...todo,
            goalRefs: Array.isArray(todo.goalRefs) ? todo.goalRefs : undefined,
        });
        reminderAutoDisabledRef.current = false;
    }, [todo]);

    const handleScheduledDateChange = (dates: { scheduledStart?: string; scheduledEnd?: string }) => {
        setEditedTodo((prev) => {
            if (!prev) return prev;

            const next: Todo = { ...prev, ...dates };
            const hadTimed = hasTimedSchedule(prev);
            const hasTimed = hasTimedSchedule(next);
            const wasActive = prev.calendarReminderPreset === "30-15";

            // If alerts were active and we remove time, temporarily disable alerts.
            // If time is added back in this edit session, restore the previous alert preset.
            if (hadTimed && !hasTimed && wasActive) {
                reminderAutoDisabledRef.current = true;
                next.calendarReminderPreset = "none";
            } else if (!hadTimed && hasTimed && reminderAutoDisabledRef.current && next.calendarReminderPreset !== "30-15") {
                next.calendarReminderPreset = "30-15";
                reminderAutoDisabledRef.current = false;
            }

            return next;
        });
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && open) {
                e.preventDefault();
                handleSave();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editedTodo]);

    const handleSave = () => {
        if (editedTodo && editedTodo.title.trim()) {
            onSave(editedTodo);
        }
    };

    const removeTag = (tagToRemove: string) => {
        if (!editedTodo) return;
        setEditedTodo({
            ...editedTodo,
            tags: editedTodo.tags?.filter(t => t !== tagToRemove) || [],
        });
    };

    const removeAttachment = (attachmentId: string) => {
        if (!editedTodo) return;
        setEditedTodo({
            ...editedTodo,
            attachments: (editedTodo.attachments || []).filter(a => a.id !== attachmentId),
        });
    };

    const insertChecklistItem = () => {
        if (!editedTodo) return;
        const textarea = descriptionRef.current;
        const currentDesc = editedTodo.description || "";
        const insertion = "- [ ] ";

        if (textarea) {
            const pos = textarea.selectionStart;
            const before = currentDesc.slice(0, pos);
            const after = currentDesc.slice(pos);
            const needsNewline = before.length > 0 && !before.endsWith('\n');
            const newDesc = before + (needsNewline ? '\n' : '') + insertion + after;
            setEditedTodo({ ...editedTodo, description: newDesc });
            // Focus and set cursor after the insertion
            const cursorPos = before.length + (needsNewline ? 1 : 0) + insertion.length;
            requestAnimationFrame(() => {
                textarea.focus();
                textarea.setSelectionRange(cursorPos, cursorPos);
            });
        } else {
            const needsNewline = currentDesc.length > 0 && !currentDesc.endsWith('\n');
            setEditedTodo({ ...editedTodo, description: currentDesc + (needsNewline ? '\n' : '') + insertion });
        }
    };

    const handleSubtaskToggle = async (subtask: Todo) => {
        const newStatus = subtask.status === "done" ? "todo" : "done";
        const updated = await api.updateTodo({ todoId: subtask.id, updates: { status: newStatus } });
        setSubtasks((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    };

    const handleAddSubtask = async () => {
        if (!editedTodo || !newSubtaskTitle.trim()) return;
        const created = await api.createTodo({
            title: newSubtaskTitle.trim(),
            parentTodoId: editedTodo.id,
            kind: "task",
            source: "user",
            status: "todo",
        });
        setSubtasks((prev) => [...prev, created]);
        setNewSubtaskTitle("");
    };

    const handleSubtaskKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleAddSubtask();
        } else if (e.key === "Escape") {
            setAddingSubtask(false);
            setNewSubtaskTitle("");
        }
    };

    if (!editedTodo) {
        return null;
    }

    const isSubtask = Boolean(editedTodo.parentTodoId);
    const isEventDraft = editedTodo.kind === "event";
    const itemLabel = isSubtask ? "Subtask" : getTodoKindLabel(editedTodo.kind);
    const canChangeKind = editedTodo.source === "user" && !isSubtask;

    const handleKindChange = (kind: Todo["kind"]) => {
        setEditedTodo((prev) => (prev ? applyTodoKindToDraft(prev, kind) : prev));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                showCloseButton={false}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: '720px',
                    maxWidth: '90vw',
                }}
            >
                <div
                    className="px-6 py-3 flex items-center justify-between"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderBottom: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium uppercase tracking-[0.08em]" style={{ color: styles.contentPrimary }}>
                            Edit {itemLabel}
                        </span>
                        {isSubtask && (
                            <span className="text-caption px-1.5 py-0.5 rounded" style={{ backgroundColor: styles.surfaceTertiary, color: styles.contentAccent }}>
                                subtask
                            </span>
                        )}
                    </div>
                    <span className="text-caption" style={{ color: styles.contentTertiary }}>
                        Cmd+Enter to save
                    </span>
                </div>

                <div className="px-6 pt-5 pb-4 space-y-4">
                    <div>
                        <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Type
                        </div>
                        <KindPicker
                            value={editedTodo.kind}
                            onChange={handleKindChange}
                            disabled={!canChangeKind}
                        />
                    </div>

                    <div>
                        <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Title
                        </div>
                        <Input
                            value={editedTodo.title}
                            onChange={(e) => setEditedTodo({ ...editedTodo, title: e.target.value })}
                            placeholder={`${itemLabel} title`}
                            className="h-10 text-title font-semibold border rounded-md px-3 focus-visible:ring-0 placeholder:font-normal"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                borderColor: styles.borderDefault,
                            }}
                            autoFocus
                        />
                    </div>

                    <div>
                        <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Description
                        </div>
                        <Textarea
                            ref={descriptionRef}
                            value={editedTodo.description || ""}
                            onChange={(e) => setEditedTodo({ ...editedTodo, description: e.target.value })}
                            placeholder="Add description..."
                            className="resize-none text-sm px-3 py-2.5 rounded-md focus-visible:ring-0"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                border: `1px solid ${styles.borderDefault}`,
                                minHeight: '150px',
                            }}
                        />
                    </div>

                    {!isSubtask && (
                        <div>
                            <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                                    Subtasks {subtasks.length > 0 && `(${subtasks.filter(s => s.status === "done").length}/${subtasks.length})`}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setAddingSubtask(true)}
                                    className="flex items-center gap-1 text-caption px-1.5 py-0.5 rounded transition-colors"
                                    style={{ color: styles.contentTertiary }}
                                >
                                    <Plus className="size-3" />
                                    Add
                                </button>
                            </div>
                            <div className="space-y-1">
                                {subtasks.map((subtask) => (
                                    <div
                                        key={subtask.id}
                                        className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md"
                                        style={{ backgroundColor: styles.surfaceSecondary }}
                                    >
                                        <Checkbox
                                            checked={subtask.status === "done"}
                                            onCheckedChange={() => handleSubtaskToggle(subtask)}
                                            className="size-3.5 shrink-0"
                                        />
                                        <span
                                            className="text-sm flex-1 min-w-0 truncate"
                                            style={{
                                                color: subtask.status === "done" ? styles.contentTertiary : styles.contentPrimary,
                                                textDecoration: subtask.status === "done" ? "line-through" : "none",
                                            }}
                                        >
                                            {subtask.title}
                                        </span>
                                    </div>
                                ))}
                                {addingSubtask && (
                                    <div
                                        className="flex items-center gap-2.5 px-2.5 py-1 rounded-md"
                                        style={{ backgroundColor: styles.surfaceSecondary }}
                                    >
                                        <div className="size-3.5 shrink-0" />
                                        <Input
                                            ref={newSubtaskInputRef}
                                            value={newSubtaskTitle}
                                            onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                            onKeyDown={handleSubtaskKeyDown}
                                            onBlur={() => {
                                                if (!newSubtaskTitle.trim()) {
                                                    setAddingSubtask(false);
                                                }
                                            }}
                                            placeholder="Subtask title…"
                                            className="h-7 text-sm border-0 px-0 shadow-none focus-visible:ring-0 bg-transparent"
                                            style={{ color: styles.contentPrimary }}
                                        />
                                    </div>
                                )}
                                {subtasks.length === 0 && !addingSubtask && (
                                    <p className="text-caption px-0.5" style={{ color: styles.contentTertiary }}>
                                        No subtasks yet
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {editedTodo.attachments && editedTodo.attachments.length > 0 && (
                        <div className="pt-1">
                            <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                                Attachments
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {editedTodo.attachments.map((attachment) => (
                                    <AttachmentThumbnail
                                        key={attachment.id}
                                        attachment={attachment}
                                        onRemove={() => removeAttachment(attachment.id)}
                                        size="md"
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {editedTodo.tags && editedTodo.tags.length > 0 && (
                        <div className="pt-1">
                            <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                                Tags
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {editedTodo.tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium"
                                        style={{
                                            backgroundColor: styles.surfaceTertiary,
                                            color: styles.contentPrimary,
                                        }}
                                    >
                                        {tag}
                                        <button
                                            type="button"
                                            onClick={() => removeTag(tag)}
                                            className="p-0.5 rounded-full transition-colors"
                                            style={{ backgroundColor: "transparent" }}
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div
                    className="px-6 py-3 space-y-2"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderTop: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {!isEventDraft && !isSubtask && (
                                <>
                                    <StatusPicker
                                        value={editedTodo.status}
                                        onChange={(status) => setEditedTodo({ ...editedTodo, status })}
                                    />
                                    <PriorityPicker
                                        value={editedTodo.priority}
                                        onChange={(priority) => setEditedTodo({ ...editedTodo, priority })}
                                    />
                                </>
                            )}
                            {isSubtask && (
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs border transition-colors"
                                    onClick={() => setEditedTodo({
                                        ...editedTodo,
                                        status: editedTodo.status === "done" ? "todo" : "done",
                                    })}
                                    style={{
                                        borderColor: styles.borderDefault,
                                        backgroundColor: editedTodo.status === "done" ? styles.surfaceAccent : styles.surfaceSecondary,
                                        color: editedTodo.status === "done" ? styles.contentAccent : styles.contentSecondary,
                                    }}
                                >
                                    {editedTodo.status === "done" ? "Done" : "Not done"}
                                </button>
                            )}
                            <div className="flex items-center gap-2">
                                <ScheduledDateTimePicker
                                    scheduledStart={editedTodo.scheduledStart}
                                    scheduledEnd={editedTodo.scheduledEnd}
                                    onChange={handleScheduledDateChange}
                                />
                                {!isEventDraft && (
                                    <DateTimePicker
                                        dueDate={editedTodo.dueDate}
                                        onChange={({ dueDate }) => setEditedTodo({ ...editedTodo, dueDate })}
                                    />
                                )}
                                {onToggleCalendarReminder && (() => {
                                    const hasTimed = editedTodo.scheduledStart?.includes("T") || editedTodo.scheduledEnd?.includes("T");
                                    const isActive = editedTodo.calendarReminderPreset === "30-15";
                                    const canToggle = hasTimed || isActive;
                                    return (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 px-2 rounded-md"
                                                    disabled={!canToggle}
                                                    onClick={() => {
                                                        const nextPreset = isActive ? "none" : "30-15";
                                                        // Optimistic local toggle so editor state isn't overwritten
                                                        // by stale server data while the dialog is open.
                                                        setEditedTodo({
                                                            ...editedTodo,
                                                            calendarReminderPreset: nextPreset,
                                                        });
                                                        if (nextPreset === "30-15") {
                                                            reminderAutoDisabledRef.current = false;
                                                        }
                                                        onToggleCalendarReminder({
                                                            ...editedTodo,
                                                            calendarReminderPreset: nextPreset,
                                                        });
                                                    }}
                                                    style={{
                                                        color: isActive ? "#fff" : styles.contentSecondary,
                                                        backgroundColor: isActive ? "#3b82f6" : "transparent",
                                                        opacity: canToggle ? 1 : 0.4,
                                                    }}
                                                >
                                                    <Bell className="size-4" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent
                                                className="z-[100]"
                                                style={{
                                                    backgroundColor: styles.surfaceTertiary,
                                                    color: styles.contentPrimary,
                                                    border: `1px solid ${styles.borderDefault}`,
                                                }}
                                            >
                                                {!hasTimed && !isActive
                                                    ? "Set a scheduled time to enable calendar alerts"
                                                    : isActive
                                                        ? "Remove 30/15 min calendar alerts"
                                                        : "Add 30 + 15 min calendar alerts"}
                                            </TooltipContent>
                                        </Tooltip>
                                    );
                                })()}
                            </div>

                            <div className="h-5 w-px mx-0.5" style={{ backgroundColor: styles.borderDefault }} />

                            <ProjectPicker
                                value={editedTodo.project}
                                onChange={(project) => setEditedTodo({ ...editedTodo, project })}
                                availableProjects={availableProjects}
                                disabled={isSubtask}
                            />
                            <TagsPicker
                                value={editedTodo.tags || []}
                                onChange={(tags) => setEditedTodo({ ...editedTodo, tags })}
                                availableTags={availableTags}
                            />
                            <AttachmentPicker
                                attachments={editedTodo.attachments || []}
                                onChange={(attachments) => setEditedTodo({ ...editedTodo, attachments })}
                            />
                            {(() => {
                                const isClosed = editedTodo.status === "done" || editedTodo.archived === true;
                                return (
                                    <GoalPicker
                                        mode="multi"
                                        value={editedTodo.goalRefs}
                                        onChange={(goalRefs) => setEditedTodo({ ...editedTodo, goalRefs })}
                                        goals={goals}
                                        disabled={isClosed}
                                        disabledReason="Goal link is frozen after completion/archive for historical reporting."
                                    />
                                );
                            })()}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2"
                                        onClick={insertChecklistItem}
                                        style={{ color: styles.contentSecondary }}
                                    >
                                        <ListChecks className="size-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent
                                    className="z-[100]"
                                    style={{
                                        backgroundColor: styles.surfaceTertiary,
                                        color: styles.contentPrimary,
                                        border: `1px solid ${styles.borderDefault}`,
                                    }}
                                >
                                    Add checklist item
                                </TooltipContent>
                            </Tooltip>
                        </div>

                        <div className="flex items-center gap-2 ml-auto">
                        {onDelete && (
                            <Button
                                onClick={() => {
                                    if (confirmDelete) {
                                        onDelete(editedTodo);
                                        onOpenChange(false);
                                        setConfirmDelete(false);
                                    } else {
                                        setConfirmDelete(true);
                                        setTimeout(() => setConfirmDelete(false), 3000);
                                    }
                                }}
                                variant={confirmDelete ? "destructive" : "ghost"}
                                size="sm"
                                className={`h-8 px-3 text-xs transition-all ${confirmDelete
                                    ? "bg-destructive hover:bg-destructive/90 text-primary-foreground"
                                    : "text-destructive hover:text-destructive hover:bg-destructive/10"
                                    }`}
                            >
                                <Trash2 className="size-3.5 mr-1.5" />
                                {confirmDelete ? "Sure?" : "Delete"}
                            </Button>
                        )}
                        <Button
                            onClick={() => onOpenChange(false)}
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 text-xs"
                        >
                            Cancel
                        </Button>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={handleSave}
                                    disabled={saving || !editedTodo.title.trim()}
                                    size="sm"
                                    className="h-8 px-3 text-xs"
                                    data-task-editor-save
                                >
                                    <Save className="size-3.5 mr-1.5" />
                                    {saving ? "Saving..." : "Save"}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent
                                className="z-[100]"
                                style={{
                                    backgroundColor: styles.surfaceTertiary,
                                    color: styles.contentPrimary,
                                    border: `1px solid ${styles.borderDefault}`,
                                }}
                            >
                                <KeyboardIndicator keys={["cmd", "enter"]} />
                            </TooltipContent>
                        </Tooltip>
                        </div>
                    </div>

                    <div className="text-[11px] leading-4" style={{ color: styles.contentTertiary }}>
                        {isEventDraft
                            ? "Schedule = when it happens. Events stay active until archived or deleted. Calendar alerts need a timed schedule."
                            : "Schedule = when you plan to do it. Deadline = when it should be done. Priority only affects task emphasis and filtering. Calendar alerts need a timed schedule."}
                    </div>
                </div>
            </DialogContent >
        </Dialog >
    );
}
