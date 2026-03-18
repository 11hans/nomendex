import { useState, useRef, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { useTheme } from "@/hooks/useTheme";
import { CalendarCheck, Clock, X } from "lucide-react";
import { toLocalDateString, parseLocalDateString } from "@/features/notes/date-utils";
import { parseTimeInput, SingleDayButton } from "./picker-utils";

interface DateTimePickerProps {
    dueDate: string | undefined;
    onChange: (dates: { dueDate?: string }) => void;
    compact?: boolean;
}

export function DateTimePicker({ dueDate, onChange, compact }: DateTimePickerProps) {
    const [open, setOpen] = useState(false);
    const [localDate, setLocalDate] = useState<Date | undefined>();
    const [localTime, setLocalTime] = useState<string>("");
    const [displayTime, setDisplayTime] = useState<string>("");
    const [showTimeInput, setShowTimeInput] = useState(false);
    const timeInputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const initLocalState = () => {
        if (dueDate) {
            setLocalDate(parseLocalDateString(dueDate.split("T")[0]));
            const time = dueDate.includes("T") ? dueDate.split("T")[1] : "";
            setLocalTime(time);
            setDisplayTime(time);
            setShowTimeInput(Boolean(time));
            return;
        }

        setLocalDate(undefined);
        setLocalTime("");
        setDisplayTime("");
        setShowTimeInput(false);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) initLocalState();
        setOpen(nextOpen);
    };

    const handleAddTime = useCallback(() => {
        setShowTimeInput(true);
        setDisplayTime("");
        setTimeout(() => timeInputRef.current?.focus(), 0);
    }, []);

    const handleClearTime = useCallback(() => {
        setLocalTime("");
        setDisplayTime("");
        setShowTimeInput(false);
    }, []);

    const commitDisplayTime = useCallback(() => {
        if (!displayTime.trim()) {
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
            setDisplayTime(localTime);
        }
    }, [displayTime, localTime]);

    const handleSave = () => {
        if (!localDate) {
            onChange({ dueDate: undefined });
            setOpen(false);
            return;
        }

        const dateStr = toLocalDateString(localDate);
        const nextDueDate = localTime ? `${dateStr}T${localTime}` : dateStr;
        onChange({ dueDate: nextDueDate });
        setOpen(false);
    };

    const handleCancel = () => {
        setOpen(false);
    };

    const handleClearLocal = () => {
        setLocalDate(undefined);
        setLocalTime("");
        setDisplayTime("");
        setShowTimeInput(false);
    };

    const handleClear = () => {
        onChange({ dueDate: undefined });
        setOpen(false);
    };

    const renderDateLabel = () => {
        if (!dueDate) return null;

        return (
            <span className="whitespace-nowrap">
                {parseLocalDateString(dueDate.split("T")[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {dueDate.includes("T") && ` ${dueDate.split("T")[1]}`}
            </span>
        );
    };

    const getDateColor = () => {
        if (!dueDate) return styles.contentTertiary;
        if (compact) return styles.contentPrimary;

        const dueDay = dueDate.split("T")[0];
        const todayDay = toLocalDateString(new Date());

        if (dueDay < todayDay) return "#ef4444";
        if (dueDay === todayDay) return "#3b82f6";
        return styles.contentPrimary;
    };

    return (
        <div
            className={`flex items-center gap-0.5 ${compact ? "p-0" : "p-0.5"} rounded-md transition-colors`}
            style={compact ? undefined : { backgroundColor: styles.surfaceTertiary }}
        >
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className={`flex items-center gap-1 ${compact ? "px-0 py-0 text-caption" : "px-2 py-1 text-sm"} rounded font-medium transition-colors hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-offset-1`}
                        style={{ color: getDateColor() }}
                    >
                        <CalendarCheck className={compact ? "size-3 shrink-0" : "size-4 shrink-0"} />
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
                        <Calendar
                            mode="single"
                            selected={localDate}
                            onSelect={setLocalDate}
                            defaultMonth={localDate ?? new Date()}
                            components={{ DayButton: SingleDayButton }}
                            classNames={{ today: "" }}
                        />

                        <div className="text-xs text-center py-1" style={{ color: styles.contentSecondary }}>
                            {!localDate
                                ? "Select a deadline"
                                : localDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </div>

                        <div className="pt-2 border-t" style={{ borderColor: styles.surfaceTertiary }}>
                            {showTimeInput ? (
                                <div className="flex items-center gap-2">
                                    <Clock className="size-3.5 shrink-0" style={{ color: styles.contentTertiary }} />
                                    <Input
                                        ref={timeInputRef}
                                        type="text"
                                        inputMode="numeric"
                                        value={displayTime}
                                        onChange={(e) => setDisplayTime(e.target.value)}
                                        onBlur={commitDisplayTime}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                commitDisplayTime();
                                            }
                                        }}
                                        className="h-8 text-sm flex-1 font-mono"
                                        placeholder="1400"
                                        disabled={!localDate}
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
                                    disabled={!localDate}
                                    className="flex items-center gap-2 w-full px-1 py-1 rounded-md text-sm transition-colors hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none"
                                    style={{ color: styles.contentTertiary }}
                                >
                                    <Clock className="size-3.5 shrink-0" />
                                    <span>Add time</span>
                                </button>
                            )}
                        </div>

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
                            <Button size="sm" className="h-7 text-xs px-3" onClick={handleSave}>
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
                    title="Clear deadline"
                >
                    <X className="size-3" />
                </button>
            )}
        </div>
    );
}
