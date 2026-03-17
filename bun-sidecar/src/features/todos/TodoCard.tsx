import { Settings, Trash2, Archive, ArchiveRestore, Copy, CalendarDays, Bell } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Todo, PRIORITY_CONFIG } from "./todo-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { parseLocalDateString } from "@/features/notes/date-utils";
import { ScheduledDateTimePicker } from "./pickers";
import { useTheme } from "@/hooks/useTheme";

function parseChecklistLines(description: string) {
    return description.split('\n')
        .map((line, index) => {
            const match = line.match(/^-\s*\[([ xX])\]\s*(.*)$/);
            if (!match) return null;
            return { index, checked: match[1] !== ' ', text: match[2] };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
}

function toggleChecklistItem(description: string, lineIndex: number): string {
    const lines = description.split('\n');
    const line = lines[lineIndex];
    if (line.includes('- [ ]')) {
        lines[lineIndex] = line.replace('- [ ]', '- [x]');
    } else if (/- \[[xX]\]/.test(line)) {
        lines[lineIndex] = line.replace(/- \[[xX]\]/, '- [ ]');
    }
    return lines.join('\n');
}

function hasChecklistItems(description?: string): boolean {
    return !!description && /^-\s*\[[ xX]\]/m.test(description);
}

function formatScheduleDisplay(start?: string, end?: string): string | null {
    if (!start && !end) return null;

    const formatDay = (value: string) =>
        parseLocalDateString(value.split("T")[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const formatTime = (value: string) => (value.includes("T") ? value.split("T")[1] : null);

    if (start && end) {
        const startDay = start.split("T")[0];
        const endDay = end.split("T")[0];
        const startTime = formatTime(start);
        const endTime = formatTime(end);

        if (startDay === endDay) {
            if (!startTime && !endTime) return formatDay(start);
            return `${formatDay(start)}${startTime ? `, ${startTime}` : ""} - ${endTime ?? "?"}`;
        }

        const startPart = `${formatDay(start)}${startTime ? `, ${startTime}` : ""}`;
        const endPart = `${formatDay(end)}${endTime ? `, ${endTime}` : ""}`;
        return `${startPart} - ${endPart}`;
    }

    if (start) {
        const time = formatTime(start);
        return `${formatDay(start)}${time ? ` ${time}` : ""}`;
    }

    if (end) {
        const time = formatTime(end);
        return `${formatDay(end)}${time ? ` ${time}` : ""}`;
    }

    return null;
}

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
    onChecklistToggle,
}: {
    todo: Todo;
    selected?: boolean;
    onEdit?: (todo: Todo) => void;
    onDelete?: (todo: Todo) => void;
    onArchive?: (todo: Todo) => void;
    hideProject?: boolean;
    onToggleDone?: (todo: Todo) => void;
    hideStatusIcon?: boolean;
    onDateChange?: (todo: Todo, dates: { scheduledStart?: string; scheduledEnd?: string }) => void;
    onChecklistToggle?: (todo: Todo, newDescription: string) => void;
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

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const isOverdue = Boolean(
        todo.dueDate
        && todo.status !== "done"
        && !Number.isNaN(new Date(todo.dueDate).getTime())
        && new Date(todo.dueDate).getTime() < startOfToday
    );
    const scheduleLabel = formatScheduleDisplay(todo.scheduledStart, todo.scheduledEnd);
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
                    {hasChecklistItems(todo.description) ? (() => {
                        const checklistItems = parseChecklistLines(todo.description!);
                        const nonChecklistText = todo.description!.split('\n')
                            .filter((_, i) => !checklistItems.some(item => item.index === i))
                            .join('\n').trim();
                        const checkedCount = checklistItems.filter(i => i.checked).length;
                        return (
                            <div className="space-y-1">
                                {nonChecklistText && (
                                    <p className="text-xs line-clamp-2 break-words [overflow-wrap:anywhere]" style={{ color: currentTheme.styles.contentTertiary }}>
                                        {nonChecklistText}
                                    </p>
                                )}
                                <div className="space-y-0.5">
                                    {checklistItems.map((item) => (
                                        <div key={item.index} className="flex items-center gap-1.5">
                                            <Checkbox
                                                checked={item.checked}
                                                onCheckedChange={() => {
                                                    if (onChecklistToggle && todo.description) {
                                                        onChecklistToggle(todo, toggleChecklistItem(todo.description, item.index));
                                                    }
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="size-3.5"
                                            />
                                            <span
                                                className="text-xs truncate"
                                                style={{
                                                    color: item.checked ? currentTheme.styles.contentTertiary : currentTheme.styles.contentPrimary,
                                                    textDecoration: item.checked ? 'line-through' : 'none',
                                                }}
                                            >
                                                {item.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                                    {checkedCount}/{checklistItems.length}
                                </p>
                            </div>
                        );
                    })() : (
                        <p className="text-xs line-clamp-2 break-words [overflow-wrap:anywhere]" style={{ color: currentTheme.styles.contentTertiary }}>
                            {todo.description}
                        </p>
                    )}
                </CardContent>
            )}
            <div className="px-3 pb-2 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                    {onDateChange ? (
                        <div
                            className={`inline-flex max-w-full ${!(todo.scheduledStart || todo.scheduledEnd) ? 'opacity-0 group-hover/card:opacity-100' : ''} transition-opacity`}
                            onClick={(e) => { e.stopPropagation(); }}
                            onDoubleClick={(e) => { e.stopPropagation(); }}
                            onPointerDown={(e) => { e.stopPropagation(); }}
                        >
                            <ScheduledDateTimePicker
                                scheduledStart={todo.scheduledStart}
                                scheduledEnd={todo.scheduledEnd}
                                onChange={(dates) => onDateChange(todo, dates)}
                                compact
                            />
                        </div>
                    ) : (
                        scheduleLabel || isOverdue ? (
                            <div className="flex items-center gap-2 min-w-0">
                                {scheduleLabel && (
                                    <p
                                        className="text-caption flex items-center gap-1 truncate"
                                        style={{ color: currentTheme.styles.contentTertiary }}
                                    >
                                        <CalendarDays className="size-3 shrink-0" />
                                        <span className="truncate">{scheduleLabel}</span>
                                    </p>
                                )}
                                {isOverdue && (
                                    <span
                                        className="text-caption shrink-0 font-medium"
                                        style={{ color: currentTheme.styles.semanticDestructive }}
                                    >
                                        Overdue
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div />
                        )
                    )}
                </div>
                {todo.calendarReminderPreset === "30-15" && (
                    <Bell className="size-3 shrink-0" style={{ color: "#3b82f6" }} />
                )}
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
