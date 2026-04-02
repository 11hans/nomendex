import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/hooks/useTheme";
import { Target, Check, X } from "lucide-react";
import type { GoalRecord } from "@/features/goals/goal-types";

// ─── Single-select (project level) ───────────────────────────────────────────

interface GoalPickerSingleProps {
    mode: "single";
    /** The current goalRef (undefined = no goal set) */
    value: string | undefined;
    onChange: (goalId: string | undefined) => void;
    goals: GoalRecord[];
    disabled?: boolean;
}

// ─── Multi with inherit/override/no-goal (todo level) ────────────────────────

interface GoalPickerMultiProps {
    mode: "multi";
    /**
     * undefined  → inherit from project goal
     * []         → explicit no-goal
     * ["id", …]  → explicit override
     */
    value: string[] | undefined;
    onChange: (value: string[] | undefined) => void;
    goals: GoalRecord[];
    disabled?: boolean;
    /** Shown as tooltip/subtitle when disabled (e.g. "closed todo" message) */
    disabledReason?: string;
}

type GoalPickerProps = GoalPickerSingleProps | GoalPickerMultiProps;

type MultiMode = "inherit" | "override" | "no-goal";

function getMultiMode(value: string[] | undefined): MultiMode {
    if (value === undefined) return "inherit";
    if (value.length === 0) return "no-goal";
    return "override";
}

const HORIZON_LABEL: Record<GoalRecord["horizon"], string> = {
    vision: "Vision",
    yearly: "Yearly",
    quarterly: "Q",
    monthly: "Monthly",
};

export function GoalPicker(props: GoalPickerProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    // In multi mode: user has clicked "Override" but may not have selected goals yet
    const [pendingOverride, setPendingOverride] = useState(false);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const { goals, disabled } = props;

    const handleOpenChange = (next: boolean) => {
        if (disabled) return;
        setOpen(next);
        if (!next) {
            setSearch("");
            setPendingOverride(false);
        }
    };

    const activeGoals = goals.filter(g => g.status === "active");
    const filteredGoals = search.trim()
        ? activeGoals.filter(g => g.title.toLowerCase().includes(search.toLowerCase()))
        : activeGoals;

    // ─── Single-select mode ───────────────────────────────────────────────────

    if (props.mode === "single") {
        const { value, onChange } = props;
        const selectedGoal = value ? goals.find(g => g.id === value) : undefined;
        const label = selectedGoal ? selectedGoal.title : "Goal";
        const hasValue = Boolean(selectedGoal);

        return (
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        disabled={disabled}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1 max-w-[140px]"
                        style={{
                            backgroundColor: hasValue ? styles.surfaceTertiary : styles.surfaceSecondary,
                            color: hasValue ? styles.contentPrimary : styles.contentTertiary,
                            opacity: disabled ? 0.5 : 1,
                        }}
                    >
                        <Target className="size-3.5 shrink-0" />
                        <span className="truncate">{label}</span>
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-64 p-1 z-[100]"
                    align="start"
                    style={{
                        backgroundColor: styles.surfacePrimary,
                        borderColor: styles.borderDefault,
                    }}
                >
                    <div
                        className="px-2 py-1.5 mb-1"
                        style={{ borderBottom: `1px solid ${styles.borderDefault}` }}
                    >
                        <input
                            type="text"
                            placeholder="Search goals..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full text-xs bg-transparent outline-none placeholder:opacity-50"
                            style={{ color: styles.contentPrimary }}
                            autoFocus
                        />
                    </div>
                    <div className="max-h-52 overflow-y-auto" onWheel={e => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => { onChange(undefined); setOpen(false); }}
                            className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-xs transition-colors text-left hover:opacity-80"
                            style={{
                                backgroundColor: !value ? styles.surfaceTertiary : "transparent",
                                color: styles.contentSecondary,
                            }}
                        >
                            <X className="size-3.5 shrink-0" style={{ color: styles.contentTertiary }} />
                            No goal
                        </button>
                        {filteredGoals.map(goal => {
                            const isSelected = value === goal.id;
                            return (
                                <button
                                    key={goal.id}
                                    type="button"
                                    onClick={() => { onChange(goal.id); setOpen(false); }}
                                    className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-xs transition-colors text-left hover:opacity-80"
                                    style={{
                                        backgroundColor: isSelected ? styles.surfaceTertiary : "transparent",
                                        color: styles.contentPrimary,
                                    }}
                                >
                                    {isSelected
                                        ? <Check className="size-3.5 shrink-0" style={{ color: styles.contentAccent }} />
                                        : <span className="size-3.5 shrink-0" />
                                    }
                                    <span className="flex-1 truncate">{goal.title}</span>
                                    <span className="text-[10px] shrink-0" style={{ color: styles.contentTertiary }}>
                                        {HORIZON_LABEL[goal.horizon]}
                                    </span>
                                </button>
                            );
                        })}
                        {filteredGoals.length === 0 && (
                            <div className="px-2.5 py-3 text-xs text-center" style={{ color: styles.contentTertiary }}>
                                {search ? "No matching goals" : "No active goals"}
                            </div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        );
    }

    // ─── Multi mode (inherit / override / no-goal) ────────────────────────────

    const { value, onChange, disabledReason } = props;
    const currentMode = getMultiMode(value);
    const showGoalList = pendingOverride || currentMode === "override";

    // Derive trigger label
    let triggerLabel: string;
    if (currentMode === "inherit") {
        triggerLabel = "Inherit goal";
    } else if (currentMode === "no-goal") {
        triggerLabel = "No goal";
    } else {
        const first = goals.find(g => g.id === (value as string[])[0]);
        const rest = (value as string[]).length - 1;
        triggerLabel = first
            ? first.title + (rest > 0 ? ` +${rest}` : "")
            : "Override";
    }

    const handleModeSelect = (mode: MultiMode) => {
        if (mode === "inherit") {
            onChange(undefined);
            setOpen(false);
            setPendingOverride(false);
        } else if (mode === "no-goal") {
            onChange([]);
            setOpen(false);
            setPendingOverride(false);
        } else {
            // Switch to override - show goal list
            setPendingOverride(true);
            if (currentMode !== "override") {
                // Don't change value yet; user must select at least one goal
            }
        }
    };

    const handleToggleGoal = (goalId: string) => {
        const current = value as string[] ?? [];
        const next = current.includes(goalId)
            ? current.filter(id => id !== goalId)
            : [...current, goalId];
        onChange(next.length > 0 ? next : []);
    };

    const modeOptions: { key: MultiMode; label: string }[] = [
        { key: "inherit", label: "Inherit from project goal" },
        { key: "override", label: "Override goal link" },
        { key: "no-goal", label: "No goal link" },
    ];

    const activeMode: MultiMode = pendingOverride ? "override" : currentMode;

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    title={disabled && disabledReason ? disabledReason : undefined}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1 max-w-[140px]"
                    style={{
                        backgroundColor: currentMode === "override" ? styles.surfaceTertiary : styles.surfaceSecondary,
                        color: currentMode === "override" ? styles.contentPrimary : styles.contentTertiary,
                        opacity: disabled ? 0.5 : 1,
                    }}
                >
                    <Target className="size-3.5 shrink-0" />
                    <span className="truncate">{triggerLabel}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-64 p-1 z-[100]"
                align="start"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                {/* Mode selector */}
                <div
                    className="pb-1 mb-1"
                    style={{ borderBottom: `1px solid ${styles.borderDefault}` }}
                >
                    {modeOptions.map(opt => (
                        <button
                            key={opt.key}
                            type="button"
                            onClick={() => handleModeSelect(opt.key)}
                            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs transition-colors text-left hover:opacity-80"
                            style={{
                                backgroundColor: activeMode === opt.key ? styles.surfaceTertiary : "transparent",
                                color: activeMode === opt.key ? styles.contentPrimary : styles.contentSecondary,
                            }}
                        >
                            <span
                                className="size-3.5 shrink-0 rounded-full border flex items-center justify-center"
                                style={{
                                    borderColor: activeMode === opt.key ? styles.contentAccent : styles.borderDefault,
                                    backgroundColor: activeMode === opt.key ? styles.contentAccent : "transparent",
                                }}
                            >
                                {activeMode === opt.key && (
                                    <span
                                        className="size-1.5 rounded-full"
                                        style={{ backgroundColor: styles.surfacePrimary }}
                                    />
                                )}
                            </span>
                            {opt.label}
                        </button>
                    ))}
                </div>

                {/* Goal list (only shown in override mode) */}
                {showGoalList && (
                    <>
                        <div className="px-2 py-1.5 mb-1" style={{ borderBottom: `1px solid ${styles.borderDefault}` }}>
                            <input
                                type="text"
                                placeholder="Search goals..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full text-xs bg-transparent outline-none placeholder:opacity-50"
                                style={{ color: styles.contentPrimary }}
                            />
                        </div>
                        <div className="max-h-48 overflow-y-auto" onWheel={e => e.stopPropagation()}>
                            {filteredGoals.map(goal => {
                                const selectedIds = Array.isArray(value) ? value : [];
                                const isSelected = selectedIds.includes(goal.id);
                                return (
                                    <button
                                        key={goal.id}
                                        type="button"
                                        onClick={() => handleToggleGoal(goal.id)}
                                        className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-xs transition-colors text-left hover:opacity-80"
                                        style={{
                                            backgroundColor: isSelected ? styles.surfaceTertiary : "transparent",
                                            color: styles.contentPrimary,
                                        }}
                                    >
                                        <span
                                            className="size-3.5 shrink-0 rounded border flex items-center justify-center"
                                            style={{
                                                borderColor: isSelected ? styles.contentAccent : styles.borderDefault,
                                                backgroundColor: isSelected ? styles.contentAccent : "transparent",
                                            }}
                                        >
                                            {isSelected && <Check className="size-2.5" style={{ color: styles.surfacePrimary }} />}
                                        </span>
                                        <span className="flex-1 truncate">{goal.title}</span>
                                        <span className="text-[10px] shrink-0" style={{ color: styles.contentTertiary }}>
                                            {HORIZON_LABEL[goal.horizon]}
                                        </span>
                                    </button>
                                );
                            })}
                            {filteredGoals.length === 0 && (
                                <div className="px-2.5 py-3 text-xs text-center" style={{ color: styles.contentTertiary }}>
                                    {search ? "No matching goals" : "No active goals"}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}
