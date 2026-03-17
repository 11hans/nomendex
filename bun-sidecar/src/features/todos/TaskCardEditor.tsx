import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Save, X, Trash2, ListChecks, Bell } from "lucide-react";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useTheme } from "@/hooks/useTheme";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { Todo } from "./todo-types";
import { AttachmentThumbnail } from "@/components/AttachmentThumbnail";
import {
    StatusPicker,
    PriorityPicker,
    ProjectPicker,
    TagsPicker,
    DateTimePicker,
    ScheduledDateTimePicker,
    AttachmentPicker,
} from "./pickers";

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
}

/**
 * TaskCardEditor is the primary popup/dialog component for editing todo details.
 * It is triggered when a user clicks on a todo in the Kanban board or Inbox view.
 */
export function TaskCardEditor({ todo, open, onOpenChange, onSave, onDelete, onToggleCalendarReminder, saving, availableTags, availableProjects }: TaskCardEditorProps) {
    const [editedTodo, setEditedTodo] = useState<Todo | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const descriptionRef = useRef<HTMLTextAreaElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    // Handle Cmd+Enter from native Mac app
    useNativeSubmit(() => {
        if (open && editedTodo?.title.trim() && !saving) {
            document.querySelector<HTMLButtonElement>('[data-task-editor-save]')?.click();
        }
    });

    useEffect(() => {
        setEditedTodo(todo);
    }, [todo]);

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

    if (!editedTodo) {
        return null;
    }

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
                    <span className="text-xs font-medium uppercase tracking-[0.08em]" style={{ color: styles.contentPrimary }}>
                        Edit Task
                    </span>
                    <span className="text-caption" style={{ color: styles.contentTertiary }}>
                        Cmd+Enter to save
                    </span>
                </div>

                <div className="px-6 pt-5 pb-4 space-y-4">
                    <div>
                        <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Title
                        </div>
                        <Input
                            value={editedTodo.title}
                            onChange={(e) => setEditedTodo({ ...editedTodo, title: e.target.value })}
                            placeholder="Task title"
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
                    className="px-6 py-3 flex flex-wrap items-center justify-between gap-2"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderTop: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <StatusPicker
                            value={editedTodo.status}
                            onChange={(status) => setEditedTodo({ ...editedTodo, status })}
                        />
                        <PriorityPicker
                            value={editedTodo.priority}
                            onChange={(priority) => setEditedTodo({ ...editedTodo, priority })}
                        />
                        <div className="flex items-center gap-2">
                            <span className="text-caption" style={{ color: styles.contentTertiary }}>Scheduled</span>
                            <ScheduledDateTimePicker
                                compact
                                scheduledStart={editedTodo.scheduledStart}
                                scheduledEnd={editedTodo.scheduledEnd}
                                onChange={(dates) => setEditedTodo({ ...editedTodo, ...dates })}
                            />
                            <span className="text-caption" style={{ color: styles.contentTertiary }}>Deadline</span>
                            <DateTimePicker
                                compact
                                dueDate={editedTodo.dueDate}
                                onChange={({ dueDate }) => setEditedTodo({ ...editedTodo, dueDate })}
                            />
                        </div>

                        <div className="h-5 w-px mx-0.5" style={{ backgroundColor: styles.borderDefault }} />

                        <ProjectPicker
                            value={editedTodo.project}
                            onChange={(project) => setEditedTodo({ ...editedTodo, project })}
                            availableProjects={availableProjects}
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
                        {onToggleCalendarReminder && (() => {
                            const hasTimed = editedTodo.scheduledStart?.includes("T") || editedTodo.scheduledEnd?.includes("T");
                            const isActive = editedTodo.calendarReminderPreset === "30-15";
                            return (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 px-2 rounded-md"
                                            disabled={!hasTimed}
                                            onClick={() => onToggleCalendarReminder({
                                                ...editedTodo,
                                                calendarReminderPreset: isActive ? "none" : "30-15",
                                            })}
                                            style={{
                                                color: isActive ? "#fff" : styles.contentSecondary,
                                                backgroundColor: isActive ? "#3b82f6" : "transparent",
                                                opacity: hasTimed ? 1 : 0.4,
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
                                        {!hasTimed
                                            ? "Set a time to enable reminders"
                                            : isActive
                                                ? "Remove 30/15 min reminders"
                                                : "Add 30 + 15 min reminders"}
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })()}
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
            </DialogContent >
        </Dialog >
    );
}
