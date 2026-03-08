import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Save, X, Trash2 } from "lucide-react";
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
    AttachmentPicker,
} from "./pickers";

interface TaskCardEditorProps {
    todo: Todo | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (todo: Todo) => void;
    onDelete?: (todo: Todo) => void;
    saving: boolean;
    availableTags: string[];
    availableProjects: string[];
}

export function TaskCardEditor({ todo, open, onOpenChange, onSave, onDelete, saving, availableTags, availableProjects }: TaskCardEditorProps) {
    const [editedTodo, setEditedTodo] = useState<Todo | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
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

    if (!editedTodo) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: '700px',
                    maxWidth: '90vw',
                }}
            >
                {/* Content Area */}
                <div className="px-6 pt-6 pb-4 space-y-4">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-1.5">
                            <DateTimePicker
                                dueDate={editedTodo.dueDate}
                                startDate={editedTodo.startDate}
                                onChange={({ dueDate, startDate }) => setEditedTodo({ ...editedTodo, dueDate, startDate })}
                            />
                            <PriorityPicker
                                value={editedTodo.priority}
                                onChange={(priority) => setEditedTodo({ ...editedTodo, priority })}
                            />
                        </div>

                        {/* Title Row */}
                        <Input
                            value={editedTodo.title}
                            onChange={(e) => setEditedTodo({ ...editedTodo, title: e.target.value })}
                            placeholder="Task title"
                            className="text-2xl font-bold border-0 px-[13px] py-1.5 h-auto rounded-md hover:bg-black/5 dark:hover:bg-white/5 focus-visible:bg-black/5 dark:focus-visible:bg-white/5 focus-visible:border-black/10 dark:focus-visible:border-white/10 focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/40 w-full transition-all"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: 'transparent',
                                borderColor: 'transparent',
                                boxShadow: 'none',
                            }}
                            autoFocus
                        />
                    </div>

                    {/* Description */}
                    <Textarea
                        value={editedTodo.description || ""}
                        onChange={(e) => setEditedTodo({ ...editedTodo, description: e.target.value })}
                        placeholder="Add description..."
                        className="resize-none text-sm px-3 py-2.5 rounded-lg focus-visible:ring-1 placeholder:text-muted-foreground/40"
                        style={{
                            color: styles.contentPrimary,
                            backgroundColor: styles.surfaceSecondary,
                            border: `1px solid ${styles.borderDefault}`,
                            minHeight: '180px',
                        }}
                    />

                    {/* Attachments Row */}
                    {editedTodo.attachments && editedTodo.attachments.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            {editedTodo.attachments.map((attachment) => (
                                <AttachmentThumbnail
                                    key={attachment.id}
                                    attachment={attachment}
                                    onRemove={() => removeAttachment(attachment.id)}
                                    size="md"
                                />
                            ))}
                        </div>
                    )}

                    {/* Tags Row - displayed inline */}
                    {editedTodo.tags && editedTodo.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-2">
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
                                        className="p-0.5 rounded-full hover:bg-black/10 transition-colors"
                                    >
                                        <X className="size-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div
                    className="px-6 py-3 flex items-center justify-between"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderTop: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    {/* Metadata Pills */}
                    <div className="flex items-center gap-2">
                        <StatusPicker
                            value={editedTodo.status}
                            onChange={(status) => setEditedTodo({ ...editedTodo, status })}
                        />

                        {/* Separator */}
                        <div className="h-5 w-px mx-0.5" style={{ backgroundColor: styles.borderDefault }} />

                        {/* Group 2: Context & Metadata */}
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
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
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
                                className={`h-9 px-3 mr-auto transition-all ${confirmDelete
                                    ? "bg-destructive hover:bg-destructive/90 text-primary-foreground"
                                    : "text-destructive hover:text-destructive hover:bg-destructive/10"
                                    }`}
                            >
                                <Trash2 className="size-4 mr-2" />
                                {confirmDelete ? "Sure?" : "Delete"}
                            </Button>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={handleSave}
                                    disabled={saving || !editedTodo.title.trim()}
                                    size="sm"
                                    className="h-9 px-4"
                                    data-task-editor-save
                                >
                                    <Save className="size-4 mr-2" />
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
