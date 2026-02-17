import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, X } from "lucide-react";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useTheme } from "@/hooks/useTheme";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import type { Attachment } from "@/types/attachments";
import { AttachmentThumbnail } from "@/components/AttachmentThumbnail";
import {
    StatusPicker,
    ProjectPicker,
    TagsPicker,
    DateTimePicker,
    AttachmentPicker,
} from "./pickers";

interface NewTodo {
    title: string;
    description: string;
    project: string;
    status: "todo" | "in_progress" | "done" | "later";
    tags: string[];
    dueDate?: string;
    attachments?: Attachment[];
}

interface CreateTodoDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    newTodo: NewTodo;
    onNewTodoChange: (newTodo: NewTodo) => void;
    onCreateTodo: () => void;
    loading: boolean;
    projectLocked?: boolean;
    availableTags: string[];
    availableProjects: string[];
}

export function CreateTodoDialog({
    open,
    onOpenChange,
    newTodo,
    onNewTodoChange,
    onCreateTodo,
    loading,
    projectLocked = false,
    availableTags,
    availableProjects
}: CreateTodoDialogProps) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    // Handle Cmd+Enter from native Mac app
    useNativeSubmit(() => {
        if (open && newTodo.title.trim() && !loading) {
            onCreateTodo();
        }
    });

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && newTodo.title.trim() && !loading) {
            e.preventDefault();
            onCreateTodo();
        }
    };

    const removeTag = (tagToRemove: string) => {
        onNewTodoChange({
            ...newTodo,
            tags: newTodo.tags.filter(t => t !== tagToRemove),
        });
    };

    const removeAttachment = (attachmentId: string) => {
        onNewTodoChange({
            ...newTodo,
            attachments: (newTodo.attachments || []).filter(a => a.id !== attachmentId),
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Todo
                </Button>
            </DialogTrigger>
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
                        value={newTodo.title}
                        onChange={(e) => onNewTodoChange({ ...newTodo, title: e.target.value })}
                        placeholder="Task title"
                        className="text-xl font-semibold border-0 px-0 h-auto focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/40"
                        style={{
                            color: styles.contentPrimary,
                            backgroundColor: 'transparent',
                        }}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    />

                    {/* Description */}
                    <Textarea
                        value={newTodo.description}
                        onChange={(e) => onNewTodoChange({ ...newTodo, description: e.target.value })}
                        placeholder="Add description..."
                        className="resize-none text-sm px-3 py-2.5 rounded-lg focus-visible:ring-1 placeholder:text-muted-foreground/40"
                        style={{
                            color: styles.contentPrimary,
                            backgroundColor: styles.surfaceSecondary,
                            border: `1px solid ${styles.borderDefault}`,
                            minHeight: '180px',
                        }}
                        onKeyDown={handleKeyDown}
                    />

                    {/* Attachments Row */}
                    {(newTodo.attachments && newTodo.attachments.length > 0) && (
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            {newTodo.attachments.map((attachment) => (
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
                    {newTodo.tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-2">
                            {newTodo.tags.map((tag) => (
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
                        {/* Group 1: Status */}
                        <StatusPicker
                            value={newTodo.status}
                            onChange={(status) => onNewTodoChange({ ...newTodo, status })}
                        />

                        {/* Separator */}
                        <div className="h-5 w-px mx-0.5" style={{ backgroundColor: styles.borderDefault }} />

                        {/* Group 2: Context & Metadata */}
                        <ProjectPicker
                            value={newTodo.project || undefined}
                            onChange={(project) => onNewTodoChange({ ...newTodo, project })}
                            availableProjects={availableProjects}
                            disabled={projectLocked}
                        />
                        <TagsPicker
                            value={newTodo.tags}
                            onChange={(tags) => onNewTodoChange({ ...newTodo, tags })}
                            availableTags={availableTags}
                        />
                        <AttachmentPicker
                            attachments={newTodo.attachments || []}
                            onChange={(attachments) => onNewTodoChange({ ...newTodo, attachments })}
                        />
                        <DateTimePicker
                            dueDate={newTodo.dueDate}
                            startDate={undefined}
                            onChange={({ dueDate }) => onNewTodoChange({ ...newTodo, dueDate })}
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
                                    onClick={onCreateTodo}
                                    disabled={loading || !newTodo.title.trim()}
                                    size="sm"
                                    className="h-9 px-4"
                                >
                                    <Plus className="size-4 mr-2" />
                                    {loading ? "Creating..." : "Create"}
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
            </DialogContent>
        </Dialog>
    );
}
