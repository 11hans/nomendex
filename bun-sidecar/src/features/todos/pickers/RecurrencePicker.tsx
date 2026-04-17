import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/hooks/useTheme";
import { Repeat } from "lucide-react";
import { formatRecurrence, type Recurrence, type RecurrenceFrequency } from "../todo-types";

const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
    { value: "daily",   label: "Daily" },
    { value: "weekly",  label: "Weekly" },
    { value: "monthly", label: "Monthly" },
];

interface RecurrencePickerProps {
    value: Recurrence | undefined;
    onChange: (recurrence: Recurrence | undefined) => void;
}

export function RecurrencePicker({ value, onChange }: RecurrencePickerProps) {
    const [open, setOpen] = useState(false);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const isActive = Boolean(value);

    const handleSelectFrequency = (frequency: RecurrenceFrequency) => {
        if (value?.frequency === frequency) {
            onChange(undefined);
        } else {
            onChange({ frequency, interval: value?.interval ?? 1 });
        }
        setOpen(false);
    };

    const handleIntervalChange = (delta: number) => {
        if (!value) return;
        const next = Math.max(1, Math.min(99, value.interval + delta));
        onChange({ ...value, interval: next });
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-1 px-2 py-2 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{
                        backgroundColor: styles.surfaceTertiary,
                        color: isActive ? styles.contentAccent : styles.contentTertiary,
                    }}
                    title={value ? `Recurs: ${formatRecurrence(value)}` : "Set recurrence"}
                >
                    <Repeat className="size-4 shrink-0" />
                    {isActive && value && (
                        <span className="whitespace-nowrap text-xs">{formatRecurrence(value)}</span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-48 p-1 z-[100]"
                align="start"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                <div className="space-y-0.5">
                    {FREQUENCY_OPTIONS.map((opt) => {
                        const isSelected = value?.frequency === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => handleSelectFrequency(opt.value)}
                                className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                                style={{
                                    backgroundColor: isSelected ? styles.surfaceTertiary : "transparent",
                                    color: isSelected ? styles.contentAccent : styles.contentPrimary,
                                }}
                            >
                                <Repeat
                                    className="size-4 shrink-0"
                                    style={{ color: isSelected ? styles.contentAccent : styles.contentTertiary }}
                                />
                                {opt.label}
                            </button>
                        );
                    })}

                    {value && (
                        <div
                            className="flex items-center justify-between gap-2 px-2.5 py-2 mt-0.5 border-t"
                            style={{ borderColor: styles.borderDefault }}
                        >
                            <span className="text-xs" style={{ color: styles.contentSecondary }}>
                                Every
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => handleIntervalChange(-1)}
                                    disabled={value.interval <= 1}
                                    className="size-5 flex items-center justify-center rounded text-xs hover:bg-black/10 disabled:opacity-30"
                                    style={{ color: styles.contentSecondary }}
                                >
                                    −
                                </button>
                                <span
                                    className="w-5 text-center text-sm font-mono"
                                    style={{ color: styles.contentPrimary }}
                                >
                                    {value.interval}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleIntervalChange(1)}
                                    disabled={value.interval >= 99}
                                    className="size-5 flex items-center justify-center rounded text-xs hover:bg-black/10 disabled:opacity-30"
                                    style={{ color: styles.contentSecondary }}
                                >
                                    +
                                </button>
                            </div>
                        </div>
                    )}

                    {value && (
                        <button
                            type="button"
                            onClick={() => { onChange(undefined); setOpen(false); }}
                            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs transition-colors"
                            style={{ color: styles.contentTertiary }}
                        >
                            Remove recurrence
                        </button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
