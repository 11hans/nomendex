import { useState, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/hooks/useTheme";
import { Circle, Loader2, CheckCircle2, Clock } from "lucide-react";

const statusConfig = [
    { value: "todo", label: "Todo", icon: Circle },
    { value: "in_progress", label: "In Progress", icon: Loader2 },
    { value: "done", label: "Done", icon: CheckCircle2 },
    { value: "later", label: "Later", icon: Clock },
] as const;

export type StatusValue = (typeof statusConfig)[number]["value"];

interface StatusPickerProps {
    value: StatusValue;
    onChange: (status: StatusValue) => void;
}

export function StatusPicker({ value, onChange }: StatusPickerProps) {
    const [open, setOpen] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const currentStatus = statusConfig.find(s => s.value === value) || statusConfig[0];
    const StatusIcon = currentStatus.icon;

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) {
            const currentIndex = statusConfig.findIndex(s => s.value === value);
            setHighlightIndex(currentIndex >= 0 ? currentIndex : 0);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!open) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleOpenChange(true);
            }
            return;
        }

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setHighlightIndex(prev =>
                    prev < statusConfig.length - 1 ? prev + 1 : 0
                );
                break;
            case "ArrowUp":
                e.preventDefault();
                setHighlightIndex(prev =>
                    prev > 0 ? prev - 1 : statusConfig.length - 1
                );
                break;
            case "Enter":
            case " ":
                e.preventDefault();
                if (highlightIndex >= 0 && highlightIndex < statusConfig.length) {
                    onChange(statusConfig[highlightIndex].value);
                    setOpen(false);
                    triggerRef.current?.focus();
                }
                break;
            case "Escape":
                e.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
                break;
        }
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{
                        backgroundColor: styles.surfaceTertiary,
                        color: styles.contentPrimary,
                        minWidth: '110px',
                    }}
                    onKeyDown={handleKeyDown}
                >
                    <StatusIcon className="size-4 shrink-0" />
                    <span className="whitespace-nowrap">{currentStatus.label}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-40 p-1"
                align="start"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
                onKeyDown={handleKeyDown}
            >
                {statusConfig.map((status, index) => {
                    const Icon = status.icon;
                    const isActive = value === status.value;
                    const isHighlighted = index === highlightIndex;
                    return (
                        <button
                            key={status.value}
                            type="button"
                            onClick={() => {
                                onChange(status.value);
                                setOpen(false);
                                triggerRef.current?.focus();
                            }}
                            className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                            style={{
                                backgroundColor: isHighlighted ? styles.surfaceTertiary : isActive ? styles.surfaceTertiary : 'transparent',
                                color: styles.contentPrimary,
                                outline: isHighlighted ? `2px solid ${styles.borderDefault}` : 'none',
                            }}
                        >
                            <Icon className="size-4" />
                            {status.label}
                        </button>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
}
