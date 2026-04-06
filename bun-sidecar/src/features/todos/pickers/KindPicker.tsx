import { CalendarDays, ListTodo } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import type { TodoKind } from "../todo-types";

const KIND_OPTIONS: Array<{
    value: TodoKind;
    label: string;
    icon: typeof ListTodo;
}> = [
    { value: "task", label: "Task", icon: ListTodo },
    { value: "event", label: "Event", icon: CalendarDays },
];

interface KindPickerProps {
    value: TodoKind;
    onChange: (kind: TodoKind) => void;
    disabled?: boolean;
}

export function KindPicker({ value, onChange, disabled = false }: KindPickerProps) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    return (
        <div
            className="inline-flex items-center gap-1 p-1 rounded-lg"
            style={{
                backgroundColor: styles.surfaceSecondary,
                border: `1px solid ${styles.borderDefault}`,
                opacity: disabled ? 0.6 : 1,
            }}
        >
            {KIND_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = value === option.value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(option.value)}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed"
                        style={{
                            backgroundColor: isActive ? styles.surfacePrimary : "transparent",
                            color: isActive ? styles.contentPrimary : styles.contentSecondary,
                            boxShadow: isActive ? `inset 0 0 0 1px ${styles.borderDefault}` : "none",
                        }}
                    >
                        <Icon className="size-3.5" />
                        <span>{option.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
