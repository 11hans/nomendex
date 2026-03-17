import { useState, useRef, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { useTheme } from "@/hooks/useTheme";
import { CalendarDays, Clock, X } from "lucide-react";
import { toLocalDateString, parseLocalDateString } from "@/features/notes/date-utils";
import type { DateRange } from "react-day-picker";
import { parseTimeInput, RangeDayButton } from "./picker-utils";

interface ScheduledDateTimePickerProps {
    scheduledEnd: string | undefined;
    scheduledStart: string | undefined;
    onChange: (dates: { scheduledEnd?: string; scheduledStart?: string }) => void;
    compact?: boolean;
}

export function ScheduledDateTimePicker({ scheduledEnd, scheduledStart, onChange, compact }: ScheduledDateTimePickerProps) {
    const [open, setOpen] = useState(false);
    const [localFrom, setLocalFrom] = useState<Date | undefined>();
    const [localTo, setLocalTo] = useState<Date | undefined>();
    const [localTime, setLocalTime] = useState<string>("");
    const [displayTime, setDisplayTime] = useState<string>("");
    const [showTimeInput, setShowTimeInput] = useState(false);
    const timeInputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const initLocalState = () => {
        if (scheduledStart) {
            setLocalFrom(parseLocalDateString(scheduledStart.split('T')[0]));
        } else if (scheduledEnd) {
            setLocalFrom(parseLocalDateString(scheduledEnd.split('T')[0]));
        } else {
            setLocalFrom(undefined);
        }

        if (scheduledEnd && scheduledStart && scheduledEnd.split('T')[0] !== scheduledStart.split('T')[0]) {
            setLocalTo(parseLocalDateString(scheduledEnd.split('T')[0]));
        } else {
            setLocalTo(undefined);
        }

        const time = scheduledStart?.includes('T') ? scheduledStart.split('T')[1] : "";
        setLocalTime(time);
        setDisplayTime(time);
        setShowTimeInput(!!time);
    };

    const handleAddTime = useCallback(() => {
        setShowTimeInput(true);
        setDisplayTime("");
        // Focus the input on the next paint once it's mounted
        setTimeout(() => timeInputRef.current?.focus(), 0);
    }, []);

    const handleClearTime = useCallback(() => {
        setLocalTime("");
        setDisplayTime("");
        setShowTimeInput(false);
    }, []);

    const commitDisplayTime = useCallback(() => {
        if (!displayTime.trim()) {
            // If they cleared the field, remove the time
            setLocalTime("");
            setDisplayTime("");
            setShowTimeInput(false);
            return;
        }
        const parsed = parseTimeInput(displayTime);
        if (parsed) {
            setLocalTime(parsed);
            setDisplayTime(parsed);
        } else {
            // Revert to previously committed time on invalid input
            setDisplayTime(localTime);
        }
    }, [displayTime, localTime]);

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
            onChange({ scheduledStart: fromStr, scheduledEnd: toStr });
        } else {
            const newScheduledStartAt = localTime ? `${fromStr}T${localTime}` : fromStr;
            onChange({ scheduledStart: newScheduledStartAt, scheduledEnd: undefined });
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
        setShowTimeInput(false);
    };

    const handleClear = () => {
        onChange({ scheduledEnd: undefined, scheduledStart: undefined });
        setOpen(false);
    };

    const renderDateLabel = () => {
        if (!scheduledStart && !scheduledEnd) return null;

        if (scheduledStart && !scheduledEnd) {
            return (
                <span className="whitespace-nowrap">
                    {parseLocalDateString(scheduledStart.split('T')[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {scheduledStart.includes('T') && ` ${scheduledStart.split('T')[1]}`}
                </span>
            );
        }

        if (scheduledStart && scheduledEnd) {
            const startDay = scheduledStart.split('T')[0];
            const dueDay = scheduledEnd.split('T')[0];
            const startFormatted = parseLocalDateString(startDay).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const dueFormatted = parseLocalDateString(dueDay).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const startTime = scheduledStart.includes('T') ? scheduledStart.split('T')[1] : null;
            const dueTime = scheduledEnd.includes('T') ? scheduledEnd.split('T')[1] : null;

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

        if (!scheduledEnd) return null;

        return (
            <span className="whitespace-nowrap">
                {parseLocalDateString(scheduledEnd.split('T')[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {scheduledEnd.includes('T') && ` ${scheduledEnd.split('T')[1]}`}
            </span>
        );
    };

    const getDateColor = () => {
        if (!scheduledStart && !scheduledEnd) return styles.contentTertiary;
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
                        className={`flex items-center gap-1 ${compact ? 'px-0 py-0 text-caption' : 'px-2 py-1 text-sm'} rounded font-medium transition-colors hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-offset-1`}
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
                                components={{ DayButton: RangeDayButton }}
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
                                showTimeInput ? (
                                    <div className="flex items-center gap-2">
                                        <Clock className="size-3.5 shrink-0" style={{ color: styles.contentTertiary }} />
                                        <Input
                                            ref={timeInputRef}
                                            type="text"
                                            inputMode="numeric"
                                            value={displayTime}
                                            onChange={(e) => setDisplayTime(e.target.value)}
                                            onBlur={commitDisplayTime}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDisplayTime(); } }}
                                            className="h-8 text-sm flex-1 font-mono"
                                            placeholder="1400"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleClearTime}
                                            className="p-1 rounded-sm hover:bg-black/10 transition-colors focus:outline-none"
                                            style={{ color: styles.contentTertiary }}
                                            title="Remove time"
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleAddTime}
                                        disabled={!localFrom}
                                        className="flex items-center gap-2 w-full px-1 py-1 rounded-md text-sm transition-colors hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none"
                                        style={{ color: styles.contentTertiary }}
                                    >
                                        <Clock className="size-3.5 shrink-0" />
                                        <span>Add time</span>
                                    </button>
                                )
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
                                className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
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

            {(scheduledStart || scheduledEnd) && !compact && (
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
