import { Settings, Trash2, Archive, ArchiveRestore, Copy, CalendarDays } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Todo, PRIORITY_CONFIG } from "./todo-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { parseLocalDateString } from "@/features/notes/date-utils";
import { DateTimePicker } from "./pickers";
import { useTheme } from "@/hooks/useTheme";

/**
 * TodoCard is a standalone display component for a single todo item.
 * Currently used in various parts of the app for displaying tasks in a card format.
 * 
 * Note: The Inbox view (inbox-view.tsx) currently uses its own inline implementation
 * of a todo item for custom styling, so changes here might not reflect there.
 */
export function TodoCard({
    todo,
    selected,
    onEdit,
    onDelete,
    onArchive,
    hideProject,
    onToggleDone,
    hideStatusIcon,
    onDateChange,
}: {
    todo: Todo;
    selected?: boolean;
    onEdit?: (todo: Todo) => void;
    onDelete?: (todo: Todo) => void;
    onArchive?: (todo: Todo) => void;
    hideProject?: boolean;
    onToggleDone?: (todo: Todo) => void;
    hideStatusIcon?: boolean;
    onDateChange?: (todo: Todo, dates: { dueDate?: string; startDate?: string }) => void;
}) {
    const { currentTheme } = useTheme();

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const content = todo.description
            ? `${todo.title}\n\n${todo.description}`
            : todo.title;

        try {
            await navigator.clipboard.writeText(content);
            toast("Todo copied to clipboard");
        } catch (error) {
            console.error("Failed to copy to clipboard:", error);
            toast("Failed to copy to clipboard");
        }
    };

    const isOverdue = Boolean(
        todo.dueDate
        && todo.status !== "done"
        && !Number.isNaN(new Date(todo.dueDate).getTime())
        && new Date(todo.dueDate).getTime() < Date.now()
    );
    const priorityColor = todo.priority ? PRIORITY_CONFIG.find((item) => item.value === todo.priority)?.color : undefined;

    return (
        <Card
            className={`mb-0 transition-colors duration-150 overflow-hidden ${todo.archived ? 'opacity-70' : ''}`}
            style={{
                backgroundColor: selected ? currentTheme.styles.surfaceAccent : currentTheme.styles.surfacePrimary,
                boxShadow: priorityColor ? `inset 3px 0 0 ${priorityColor}` : undefined,
            }}
        >
            <CardHeader className="pb-1 pt-2 px-3">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className={`text-sm font-medium leading-tight min-w-0 break-words [overflow-wrap:anywhere] flex-1 ${todo.status === "done" ? "line-through text-muted-foreground" : ""
                        }`} style={{ color: todo.status === "done" ? currentTheme.styles.contentTertiary : currentTheme.styles.contentPrimary }}>
                        {todo.title}
                    </CardTitle>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {todo.archived && (
                            <span
                                className="text-caption px-1 rounded"
                                style={{ color: currentTheme.styles.contentTertiary, backgroundColor: currentTheme.styles.surfaceSecondary }}
                            >
                                Archived
                            </span>
                        )}
                        {!hideStatusIcon && (
                            <Checkbox
                                checked={todo.status === "done"}
                                onCheckedChange={(checked) => {
                                    if (checked !== "indeterminate") onToggleDone?.(todo);
                                }}
                                onClick={(e) => { e.stopPropagation(); }}
                                title={todo.status === "done" ? "Mark as incomplete" : "Mark as done"}
                            />
                        )}
                    </div>
                </div>
                {!hideProject && todo.project && (
                    <p className="text-caption truncate" style={{ color: currentTheme.styles.contentAccent }}>
                        {todo.project}
                    </p>
                )}
                {todo.tags && todo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {todo.tags.map((tag) => (
                            <Badge
                                key={tag}
                                variant="outline"
                                className="text-caption px-1 py-0 h-4"
                                style={{ borderColor: currentTheme.styles.borderDefault, color: currentTheme.styles.contentSecondary }}
                            >
                                {tag}
                            </Badge>
                        ))}
                    </div>
                )}
            </CardHeader>
            {todo.description && (
                <CardContent className="pt-0 px-3 pb-1">
                    <p className="text-xs line-clamp-2 break-words [overflow-wrap:anywhere]" style={{ color: currentTheme.styles.contentTertiary }}>
                        {todo.description}
                    </p>
                </CardContent>
            )}
            <div className="px-3 pb-2 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                    {onDateChange ? (
                        <div
                            className={`inline-flex max-w-full ${!todo.dueDate ? 'opacity-0 group-hover/card:opacity-100' : ''} transition-opacity`}
                            onClick={(e) => { e.stopPropagation(); }}
                            onDoubleClick={(e) => { e.stopPropagation(); }}
                            onPointerDown={(e) => { e.stopPropagation(); }}
                        >
                            <DateTimePicker
                                dueDate={todo.dueDate}
                                startDate={todo.startDate}
                                onChange={(dates) => onDateChange(todo, dates)}
                                compact
                            />
                        </div>
                    ) : (
                        todo.dueDate ? (
                            <p
                                className="text-caption flex items-center gap-1 truncate"
                                style={{ color: isOverdue ? currentTheme.styles.semanticDestructive : currentTheme.styles.contentTertiary }}
                            >
                                <CalendarDays className="size-3 shrink-0" />
                                <span className="truncate">
                                    {parseLocalDateString(todo.dueDate.split('T')[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                    {(() => {
                                        const startTime = todo.startDate?.includes('T') ? todo.startDate.split('T')[1] : null;
                                        const dueTime = todo.dueDate.includes('T') ? todo.dueDate.split('T')[1] : null;
                                        if (startTime && dueTime) return ` ${startTime}–${dueTime}`;
                                        if (dueTime) return ` ${dueTime}`;
                                        return null;
                                    })()}
                                </span>
                            </p>
                        ) : (
                            <div />
                        )
                    )}
                </div>
                {/* Actions - show when selected */}
                <div className={`shrink-0 flex items-center gap-0.5 transition-opacity duration-150 ${selected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'}`}>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-surface-elevated"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit?.(todo);
                        }}
                        title="Edit"
                        aria-label="Edit todo"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        <Settings className="size-3" />
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-surface-elevated"
                        onClick={handleCopy}
                        title="Copy"
                        aria-label="Copy todo content"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        <Copy className="size-3" />
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-surface-elevated"
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onArchive?.(todo);
                        }}
                        title={todo.archived ? "Unarchive" : "Archive"}
                        aria-label={todo.archived ? "Unarchive todo" : "Archive todo"}
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        {todo.archived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center justify-center size-6 rounded hover:bg-destructive/10"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete?.(todo);
                        }}
                        title="Delete"
                        aria-label="Delete todo"
                        style={{ color: currentTheme.styles.semanticDestructive }}
                    >
                        <Trash2 className="size-3" />
                    </button>
                </div>
            </div>
        </Card >
    );
}
