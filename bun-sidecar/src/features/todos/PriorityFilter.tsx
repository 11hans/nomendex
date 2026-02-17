import { Flag, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/hooks/useTheme";
import { useState } from "react";

type Priority = "high" | "medium" | "low" | "none";

interface PriorityFilterProps {
    selectedPriority: Priority | null;
    onPriorityChange: (priority: Priority | null) => void;
}

const priorityOptions = [
    { value: "high" as const, label: "High", color: "#ef4444" },
    { value: "medium" as const, label: "Medium", color: "#f59e0b" },
    { value: "low" as const, label: "Low", color: "#3b82f6" },
    { value: "none" as const, label: "None", color: undefined },
];

export function PriorityFilter({ selectedPriority, onPriorityChange }: PriorityFilterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const { currentTheme } = useTheme();

    const selectedOption = selectedPriority
        ? priorityOptions.find(p => p.value === selectedPriority)
        : null;

    return (
        <div className="flex items-center gap-2">
            {selectedOption && (
                <>
                    <span
                        className="flex items-center gap-1 text-xs"
                        style={{ color: selectedOption.color || currentTheme.styles.contentSecondary }}
                    >
                        <Flag className="h-3 w-3" />
                        {selectedOption.label}
                    </span>
                    <button
                        className="text-[10px] uppercase tracking-wider opacity-40 hover:opacity-70 transition-opacity"
                        onClick={() => onPriorityChange(null)}
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </>
            )}
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <button
                        className="text-[10px] uppercase tracking-wider opacity-40 hover:opacity-70 transition-opacity flex items-center gap-1"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        <Flag className="h-2.5 w-2.5" />
                        Priority
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-36 p-1"
                    align="start"
                    style={{
                        backgroundColor: currentTheme.styles.surfacePrimary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    {priorityOptions.map((option) => {
                        const isActive = selectedPriority === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                    onPriorityChange(isActive ? null : option.value);
                                    setIsOpen(false);
                                }}
                                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-sm transition-colors text-left"
                                style={{
                                    backgroundColor: isActive ? currentTheme.styles.surfaceTertiary : 'transparent',
                                    color: option.color || currentTheme.styles.contentPrimary,
                                }}
                            >
                                <Flag className="size-3.5" style={{ color: option.color || currentTheme.styles.contentTertiary }} />
                                {option.label}
                            </button>
                        );
                    })}
                </PopoverContent>
            </Popover>
        </div>
    );
}
