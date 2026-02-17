import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/hooks/useTheme";
import { Flag } from "lucide-react";

const priorityConfig = [
    { value: "high", label: "High", color: "#ef4444" },
    { value: "medium", label: "Medium", color: "#f59e0b" },
    { value: "low", label: "Low", color: "#3b82f6" },
    { value: "none", label: "None", color: undefined },
] as const;

export type PriorityValue = (typeof priorityConfig)[number]["value"];

interface PriorityPickerProps {
    value: PriorityValue | undefined;
    onChange: (priority: PriorityValue) => void;
}

export function PriorityPicker({ value, onChange }: PriorityPickerProps) {
    const [open, setOpen] = useState(false);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const currentValue = value || "none";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex items-center justify-center p-2 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{
                        backgroundColor: styles.surfaceTertiary,
                        color: currentValue !== "none"
                            ? priorityConfig.find(p => p.value === currentValue)?.color
                            : styles.contentTertiary,
                    }}
                >
                    <Flag className="size-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-40 p-1"
                align="start"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                {priorityConfig.map((priority) => {
                    const isActive = currentValue === priority.value;
                    return (
                        <button
                            key={priority.value}
                            type="button"
                            onClick={() => {
                                onChange(priority.value);
                                setOpen(false);
                            }}
                            className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                            style={{
                                backgroundColor: isActive ? styles.surfaceTertiary : 'transparent',
                                color: priority.color || styles.contentPrimary,
                            }}
                        >
                            <Flag className="size-4" style={{ color: priority.color || styles.contentTertiary }} />
                            {priority.label}
                        </button>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
}
