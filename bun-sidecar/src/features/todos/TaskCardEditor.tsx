import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Save, X } from "lucide-react";
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
    saving: boolean;
    availableTags: string[];
    availableProjects: string[];
}

export function TaskCardEditor({ todo, open, onOpenChange, onSave, saving, availableTags, availableProjects }: TaskCardEditorProps) {
    const [editedTodo, setEditedTodo] = useState<Todo | null>(null);
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
                showCloseButton={false}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: '700px',
                    maxWidth: '90vw',
                }}
            >
                {/* Content Area */}
                <div className="px-6 pt-6 pb-4 space-y-4">
                    {/* Title */}
                    <Input
                        value={editedTodo.title}
                        onChange={(e) => setEditedTodo({ ...editedTodo, title: e.target.value })}
                        placeholder="Task title"
                        className="text-xl font-semibold border-0 px-0 h-auto focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/40"
                        style={{
                            color: styles.contentPrimary,
                            backgroundColor: 'transparent',
                        }}
                        autoFocus
                    />

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
                    {/* Metadata Pills — grouped with separator */}
                    <div className="flex items-center gap-2">
                        {/* Group 1: Status & Priority */}
                        <StatusPicker
                            value={editedTodo.status}
                            onChange={(status) => setEditedTodo({ ...editedTodo, status })}
                        />
                        <PriorityPicker
                            value={editedTodo.priority}
                            onChange={(priority) => setEditedTodo({ ...editedTodo, priority })}
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
                        <DateTimePicker
                            dueDate={editedTodo.dueDate}
                            startDate={editedTodo.startDate}
                            onChange={({ dueDate, startDate }) => setEditedTodo({ ...editedTodo, dueDate, startDate })}
                        />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => onOpenChange(false)}
                            variant="ghost"
                            size="sm"
                            className="h-9 px-4"
                        >
                            Cancel
                        </Button>
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
