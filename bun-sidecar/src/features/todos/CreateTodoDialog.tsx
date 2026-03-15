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
    PriorityPicker,
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
    priority?: "high" | "medium" | "low" | "none";
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
    triggerLabel?: string;
    triggerClassName?: string;
    hideTriggerIcon?: boolean;
    triggerVariant?: React.ComponentProps<typeof Button>["variant"];
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
    availableProjects,
    triggerLabel = "Add Todo",
    triggerClassName,
    hideTriggerIcon = false,
    triggerVariant = "default",
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
                <Button className={triggerClassName} variant={triggerVariant}>
                    {!hideTriggerIcon && <Plus className="w-4 h-4 mr-2" />}
                    {triggerLabel}
                </Button>
            </DialogTrigger>
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
                        Create Task
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
                            value={newTodo.title}
                            onChange={(e) => onNewTodoChange({ ...newTodo, title: e.target.value })}
                            placeholder="Task title"
                            className="h-10 text-title font-semibold border rounded-md px-3 focus-visible:ring-0 placeholder:font-normal"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                borderColor: styles.borderDefault,
                            }}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />
                    </div>

                    <div>
                        <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Description
                        </div>
                        <Textarea
                            value={newTodo.description}
                            onChange={(e) => onNewTodoChange({ ...newTodo, description: e.target.value })}
                            placeholder="Add description..."
                            className="resize-none text-sm px-3 py-2.5 rounded-md focus-visible:ring-0"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                border: `1px solid ${styles.borderDefault}`,
                                minHeight: '150px',
                            }}
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                    {(newTodo.attachments && newTodo.attachments.length > 0) && (
                        <div className="pt-1">
                            <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                                Attachments
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {newTodo.attachments.map((attachment) => (
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

                    {newTodo.tags.length > 0 && (
                        <div className="pt-1">
                            <div className="mb-1 text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                                Tags
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
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
                            value={newTodo.status}
                            onChange={(status) => onNewTodoChange({ ...newTodo, status })}
                        />
                        <PriorityPicker
                            value={newTodo.priority}
                            onChange={(priority) => onNewTodoChange({ ...newTodo, priority })}
                        />

                        <div className="h-5 w-px mx-0.5" style={{ backgroundColor: styles.borderDefault }} />

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

                    <div className="flex items-center gap-2 ml-auto">
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
                                    onClick={onCreateTodo}
                                    disabled={loading || !newTodo.title.trim()}
                                    size="sm"
                                    className="h-8 px-3 text-xs"
                                >
                                    <Plus className="size-3.5 mr-1.5" />
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
