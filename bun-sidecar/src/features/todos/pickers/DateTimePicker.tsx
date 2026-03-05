import { useState, useRef, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { useTheme } from "@/hooks/useTheme";
import { CalendarDays, Clock, X } from "lucide-react";
import { toLocalDateString, parseLocalDateString } from "@/features/notes/date-utils";
import type { DateRange, DayButton } from "react-day-picker";
import { cn } from "@/lib/utils";

function PickerDayButton({ className, day: _day, modifiers, style, ...props }: React.ComponentProps<typeof DayButton>) {
    const ref = useRef<HTMLButtonElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    useEffect(() => { if (modifiers.focused) ref.current?.focus(); }, [modifiers.focused]);

    const isEndpoint = modifiers.range_start || modifiers.range_end;
    const isSingleSelected = modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle;

    const bgColor = isEndpoint || isSingleSelected ? styles.semanticPrimary : undefined;
    const textColor = isEndpoint || isSingleSelected
        ? styles.semanticPrimaryForeground
        : modifiers.today && !modifiers.selected
            ? styles.contentAccent
            : modifiers.outside
                ? styles.contentTertiary
                : styles.contentPrimary;

    return (
        <button
            ref={ref}
            className={cn(
                "flex aspect-square size-auto w-full min-w-[var(--cell-size,2rem)] items-center justify-center text-sm transition-colors focus:outline-none",
                modifiers.today && !modifiers.selected && "font-bold",
                isSingleSelected && "rounded-md",
                modifiers.range_start && "rounded-l-md rounded-r-none",
                modifiers.range_end   && "rounded-r-md rounded-l-none",
                modifiers.range_middle && "rounded-none",
                modifiers.disabled && "opacity-40 cursor-not-allowed pointer-events-none",
                modifiers.outside && "opacity-30",
                className
            )}
            style={{ backgroundColor: bgColor, color: textColor, ...style }}
            {...props}
        />
    );
}

interface DateTimePickerProps {
    dueDate: string | undefined;
    startDate: string | undefined;
    onChange: (dates: { dueDate?: string; startDate?: string }) => void;
    compact?: boolean;
}

export function DateTimePicker({ dueDate, startDate, onChange, compact }: DateTimePickerProps) {
    const [open, setOpen] = useState(false);
    const [localFrom, setLocalFrom] = useState<Date | undefined>();
    const [localTo, setLocalTo] = useState<Date | undefined>();
    const [localTime, setLocalTime] = useState<string>("");
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const initLocalState = () => {
        if (startDate) {
            setLocalFrom(parseLocalDateString(startDate.split('T')[0]));
        } else if (dueDate) {
            setLocalFrom(parseLocalDateString(dueDate.split('T')[0]));
        } else {
            setLocalFrom(undefined);
        }

        if (dueDate && startDate && dueDate.split('T')[0] !== startDate.split('T')[0]) {
            setLocalTo(parseLocalDateString(dueDate.split('T')[0]));
        } else {
            setLocalTo(undefined);
        }

        setLocalTime(dueDate?.includes('T') ? dueDate.split('T')[1] : "");
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) initLocalState();
        setOpen(nextOpen);
    };

    const isSingleDay = !localTo || (
        localFrom !== undefined && toLocalDateString(localFrom) === toLocalDateString(localTo)
    );

    const handleRangeSelect = (range: DateRange | undefined) => {
        const from = range?.from;
        const to = range?.to;

        // If a range is already selected, any new click starts fresh from the clicked day.
        // This overrides react-day-picker's built-in range logic (which can behave
        // unexpectedly when clicking inside an existing range or on endpoints).
        if (localFrom && localTo && toLocalDateString(localFrom) !== toLocalDateString(localTo)) {
            // Use whichever end of the reported range is the "new" click
            const clicked = (from && to) ? (toLocalDateString(from) !== toLocalDateString(localFrom) ? from : to) : (from ?? to);
            setLocalFrom(clicked);
            setLocalTo(undefined);
            return;
        }

        // No existing range — normal first/second click behaviour.
        // If the library reports to < from (e.g. user clicked an earlier day as second click),
        // treat it as a fresh start on that day.
        if (from && to && to < from) {
            setLocalFrom(to);
            setLocalTo(undefined);
            return;
        }

        setLocalFrom(from);
        setLocalTo(to);
        // Note: we intentionally do NOT clear localTime here so the user
        // doesn't lose a previously entered time if they later collapse back to a single day.
    };

    const handleSave = () => {
        if (!localFrom) {
            setOpen(false);
            return;
        }
        const fromStr = toLocalDateString(localFrom);
        if (!isSingleDay && localTo) {
            const toStr = toLocalDateString(localTo);
            onChange({ startDate: fromStr, dueDate: toStr });
        } else {
            const newDueDate = localTime ? `${fromStr}T${localTime}` : fromStr;
            onChange({ dueDate: newDueDate, startDate: undefined });
        }
        setOpen(false);
    };

    const handleCancel = () => {
        setOpen(false);
    };

    const handleClearLocal = () => {
        setLocalFrom(undefined);
        setLocalTo(undefined);
        setLocalTime("");
    };

    const handleClear = () => {
        onChange({ dueDate: undefined, startDate: undefined });
        setOpen(false);
    };

    const renderDateLabel = () => {
        if (!dueDate) return null;

        if (startDate) {
            const startDay = startDate.split('T')[0];
            const dueDay = dueDate.split('T')[0];
            const startFormatted = parseLocalDateString(startDay).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const dueFormatted = parseLocalDateString(dueDay).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const startTime = startDate.includes('T') ? startDate.split('T')[1] : null;
            const dueTime = dueDate.includes('T') ? dueDate.split('T')[1] : null;

            if (startDay !== dueDay) {
                return (
                    <span className="whitespace-nowrap">
                        {startFormatted}{startTime ? `, ${startTime}` : ''}
                        {' - '}
                        {dueFormatted}{dueTime ? `, ${dueTime}` : ''}
                    </span>
                );
            }
            if (!startTime && !dueTime) {
                return <span className="whitespace-nowrap">{startFormatted}</span>;
            }
            return (
                <span className="whitespace-nowrap">
                    {startFormatted}
                    {startTime ? `, ${startTime}` : ''}
                    {' - '}
                    {dueTime ?? '?'}
                </span>
            );
        }

        return (
            <span className="whitespace-nowrap">
                {parseLocalDateString(dueDate.split('T')[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {dueDate.includes('T') && ` ${dueDate.split('T')[1]}`}
            </span>
        );
    };

    const getDateColor = () => {
        if (!dueDate) return styles.contentTertiary;
        if (compact) return styles.contentPrimary;
        const dueDay = dueDate.split('T')[0];
        const todayDay = toLocalDateString(new Date());
        if (dueDay < todayDay) return '#ef4444';
        if (dueDay === todayDay) return '#3b82f6';
        return styles.contentPrimary;
    };

    const selectedRange: DateRange | undefined = localFrom
        ? { from: localFrom, to: localTo }
        : undefined;

    return (
        <div
            className={`flex items-center gap-0.5 ${compact ? 'p-0' : 'p-0.5'} rounded-md transition-colors`}
            style={compact ? undefined : { backgroundColor: styles.surfaceTertiary }}
        >
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className={`flex items-center gap-1 ${compact ? 'px-0 py-0 text-[10px]' : 'px-2 py-1 text-sm'} rounded font-medium transition-colors hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-offset-1`}
                        style={{ color: getDateColor() }}
                    >
                        <CalendarDays className={compact ? "size-3 shrink-0" : "size-4 shrink-0"} />
                        {renderDateLabel()}
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-auto p-3 z-[100]"
                    align="start"
                    style={{
                        backgroundColor: styles.surfacePrimary,
                        borderColor: styles.borderDefault,
                    }}
                >
                    <div className="space-y-3">
                        {/* Range Calendar */}
                        <div style={{ "--picker-range-bg": styles.surfaceAccent } as React.CSSProperties}>
                            <Calendar
                                mode="range"
                                selected={selectedRange}
                                onSelect={handleRangeSelect}
                                defaultMonth={localFrom ?? new Date()}
                                classNames={{
                                    range_start: "bg-[var(--picker-range-bg)] rounded-l-md",
                                    range_middle: "bg-[var(--picker-range-bg)] rounded-none",
                                    range_end: "bg-[var(--picker-range-bg)] rounded-r-md",
                                    today: "",
                                }}
                                components={{ DayButton: PickerDayButton }}
                            />
                        </div>

                        {/* Selection summary */}
                        <div className="text-xs text-center py-1" style={{ color: styles.contentSecondary }}>
                            {!localFrom
                                ? "Select a date"
                                : isSingleDay
                                    ? localFrom.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                                    : `${localFrom.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${localTo!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            }
                        </div>

                        {/* Time / All-day section */}
                        <div className="pt-2 border-t" style={{ borderColor: styles.surfaceTertiary }}>
                            {isSingleDay ? (
                                <div className="flex items-center gap-2">
                                    <Clock className="size-3.5 shrink-0" style={{ color: styles.contentTertiary }} />
                                    <Input
                                        type="time"
                                        value={localTime}
                                        onChange={(e) => setLocalTime(e.target.value)}
                                        className="h-8 text-sm flex-1"
                                        disabled={!localFrom}
                                        placeholder="Add time"
                                    />
                                </div>
                            ) : (
                                <div className="flex items-center justify-center py-1">
                                    <span className="text-xs" style={{ color: styles.contentTertiary }}>All day</span>
                                </div>
                            )}
                        </div>

                        {/* Footer: Clear / Cancel / Save */}
                        <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: styles.surfaceTertiary }}>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 px-2"
                                onClick={handleClearLocal}
                            >
                                Clear
                            </Button>
                            <div className="flex-1" />
                            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleCancel}>
                                Cancel
                            </Button>
                            <Button size="sm" className="h-7 text-xs px-3" onClick={handleSave} disabled={!localFrom}>
                                Save
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {dueDate && !compact && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleClear();
                    }}
                    className="p-1 rounded-sm hover:bg-black/10 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{ color: styles.contentTertiary }}
                    title="Clear date"
                >
                    <X className="size-3" />
                </button>
            )}
        </div>
    );
}
