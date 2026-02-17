import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { useTheme } from "@/hooks/useTheme";
import { CalendarDays, Clock, X } from "lucide-react";
import { parseDateFromInput, toLocalDateString, parseLocalDateString } from "@/features/notes/date-utils";

interface DateTimePickerProps {
    dueDate: string | undefined;
    startDate: string | undefined;
    onChange: (dates: { dueDate?: string; startDate?: string }) => void;
}

export function DateTimePicker({ dueDate, startDate, onChange }: DateTimePickerProps) {
    const [open, setOpen] = useState(false);
    const [dateInput, setDateInput] = useState("");
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const handleDateInputChange = (value: string) => {
        setDateInput(value);
        const parsed = parseDateFromInput(value);
        if (parsed) {
            const time = dueDate?.includes('T') ? dueDate.split('T')[1] : undefined;
            const dateStr = toLocalDateString(parsed);
            const newDueDate = time ? `${dateStr}T${time}` : dateStr;

            let newStartDate: string | undefined = undefined;
            if (startDate) {
                const startTime = startDate.includes('T') ? startDate.split('T')[1] : undefined;
                newStartDate = startTime ? `${dateStr}T${startTime}` : dateStr;
            }

            onChange({ dueDate: newDueDate, startDate: newStartDate });
        }
    };

    const handleCalendarSelect = (date: Date | undefined) => {
        if (date) {
            const dateStr = toLocalDateString(date);
            const dueTime = dueDate?.includes('T') ? dueDate.split('T')[1] : undefined;
            const newDueDate = dueTime ? `${dateStr}T${dueTime}` : dateStr;

            let newStartDate: string | undefined = undefined;
            if (startDate) {
                const startTime = startDate.includes('T') ? startDate.split('T')[1] : undefined;
                newStartDate = startTime ? `${dateStr}T${startTime}` : dateStr;
            }

            onChange({ dueDate: newDueDate, startDate: newStartDate });
            setDateInput("");
        }
    };

    const handleDueTimeChange = (time: string) => {
        if (!dueDate) return;
        const dateStr = dueDate.split('T')[0];
        if (time) {
            onChange({ dueDate: `${dateStr}T${time}`, startDate });
        } else {
            onChange({ dueDate: dateStr, startDate });
        }
    };

    const handleStartTimeChange = (time: string) => {
        if (!startDate) return;
        const dateStr = startDate.split('T')[0];
        if (time) {
            onChange({ dueDate, startDate: `${dateStr}T${time}` });
        }
    };

    const handleEndTimeChange = (time: string) => {
        if (!dueDate) return;
        const dateStr = dueDate.split('T')[0];
        if (time) {
            onChange({ dueDate: `${dateStr}T${time}`, startDate });
        }
    };

    const handleAddEndTime = () => {
        if (!dueDate) return;
        const dateStr = dueDate.split('T')[0];
        let startTime = "09:00";
        if (dueDate.includes('T')) {
            startTime = dueDate.split('T')[1];
        }
        const [hours, minutes] = startTime.split(':').map(Number);
        const endHours = (hours! + 1) % 24;
        const endTime = `${endHours.toString().padStart(2, '0')}:${minutes!.toString().padStart(2, '0')}`;

        onChange({
            startDate: `${dateStr}T${startTime}`,
            dueDate: `${dateStr}T${endTime}`,
        });
    };

    const handleRemoveRange = () => {
        onChange({ dueDate, startDate: undefined });
    };

    const handleClearAll = () => {
        onChange({ dueDate: undefined, startDate: undefined });
    };

    // Render date display label — icon-only when empty
    const renderDateLabel = () => {
        if (!dueDate) return null;

        if (startDate) {
            return (
                <span className="whitespace-nowrap">
                    {parseLocalDateString(startDate.split('T')[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {startDate.includes('T') && `, ${startDate.split('T')[1]}`}
                    {' - '}
                    {dueDate.includes('T') ? dueDate.split('T')[1] : 'End'}
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

    return (
        <div
            className="flex items-center gap-0.5 p-0.5 rounded-md transition-colors"
            style={{ backgroundColor: styles.surfaceTertiary }}
        >
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium transition-colors hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{
                            color: dueDate ? styles.contentPrimary : styles.contentTertiary,
                        }}
                    >
                        <CalendarDays className="size-4 shrink-0" />
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
                        <Input
                            value={dateInput}
                            onChange={(e) => handleDateInputChange(e.target.value)}
                            placeholder="tomorrow, next wed, 1/15..."
                            className="h-9 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    setOpen(false);
                                }
                            }}
                        />
                        <Calendar
                            mode="single"
                            selected={dueDate ? parseLocalDateString(dueDate.split('T')[0]) : undefined}
                            onSelect={handleCalendarSelect}
                            defaultMonth={dueDate ? parseLocalDateString(dueDate.split('T')[0]) : new Date()}
                        />

                        <div className="pt-2 border-t" style={{ borderColor: styles.surfaceTertiary }}>
                            {!startDate ? (
                                // Single Date Mode
                                <div className="flex items-center gap-2">
                                    <Clock className="size-3.5 shrink-0" style={{ color: styles.contentTertiary }} />
                                    <Input
                                        type="time"
                                        value={dueDate?.includes('T') ? dueDate.split('T')[1] : ''}
                                        onChange={(e) => handleDueTimeChange(e.target.value)}
                                        className="h-8 text-sm flex-1"
                                        disabled={!dueDate}
                                        placeholder="Add time"
                                    />
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 text-xs px-2"
                                        onClick={handleAddEndTime}
                                        disabled={!dueDate}
                                    >
                                        Add End Time
                                    </Button>
                                </div>
                            ) : (
                                // Range Mode
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium w-8" style={{ color: styles.contentSecondary }}>Start</span>
                                        <Input
                                            type="time"
                                            value={startDate?.includes('T') ? startDate.split('T')[1] : ''}
                                            onChange={(e) => handleStartTimeChange(e.target.value)}
                                            className="h-8 text-sm flex-1"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium w-8" style={{ color: styles.contentSecondary }}>End</span>
                                        <Input
                                            type="time"
                                            value={dueDate?.includes('T') ? dueDate.split('T')[1] : ''}
                                            onChange={(e) => handleEndTimeChange(e.target.value)}
                                            className="h-8 text-sm flex-1"
                                        />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-8 text-xs p-1 hover:bg-red-100 hover:text-red-600"
                                            onClick={handleRemoveRange}
                                            title="Remove start time"
                                        >
                                            <X className="size-3" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {dueDate && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleClearAll();
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
