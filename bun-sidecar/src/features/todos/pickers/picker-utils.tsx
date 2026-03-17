import { useRef, useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";
import type { DayButton } from "react-day-picker";
import { cn } from "@/lib/utils";

/** Parse shorthand time strings: "1000" → "10:00", "930" → "09:30", "9" → "09:00", "10:30" → "10:30" */
export function parseTimeInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
        const [h, m] = trimmed.split(":").map(Number);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }
        return null;
    }

    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 1 || digits.length === 2) {
        const h = parseInt(digits, 10);
        if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
    } else if (digits.length === 3) {
        const h = parseInt(digits[0], 10);
        const m = parseInt(digits.slice(1), 10);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }
    } else if (digits.length === 4) {
        const h = parseInt(digits.slice(0, 2), 10);
        const m = parseInt(digits.slice(2), 10);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }
    }

    return null;
}

/** Single-date day button for the deadline picker (no range styling). */
export function SingleDayButton({ className, day: _day, modifiers, style, ...props }: React.ComponentProps<typeof DayButton>) {
    const ref = useRef<HTMLButtonElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    useEffect(() => {
        if (modifiers.focused) ref.current?.focus();
    }, [modifiers.focused]);

    const isSelected = modifiers.selected;
    const bgColor = isSelected ? styles.semanticPrimary : undefined;
    const textColor = isSelected
        ? styles.semanticPrimaryForeground
        : modifiers.today
            ? styles.contentAccent
            : modifiers.outside
                ? styles.contentTertiary
                : styles.contentPrimary;

    return (
        <button
            ref={ref}
            className={cn(
                "flex aspect-square size-auto w-full min-w-[var(--cell-size,2rem)] items-center justify-center rounded-md text-sm transition-colors focus:outline-none",
                modifiers.today && !modifiers.selected && "font-bold",
                modifiers.disabled && "opacity-40 cursor-not-allowed pointer-events-none",
                modifiers.outside && "opacity-30",
                className
            )}
            style={{ backgroundColor: bgColor, color: textColor, ...style }}
            {...props}
        />
    );
}

/** Range-aware day button for the schedule picker (with range start/end/middle styling). */
export function RangeDayButton({ className, day: _day, modifiers, style, ...props }: React.ComponentProps<typeof DayButton>) {
    const ref = useRef<HTMLButtonElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    useEffect(() => {
        if (modifiers.focused) ref.current?.focus();
    }, [modifiers.focused]);

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
                modifiers.range_end && "rounded-r-md rounded-l-none",
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
