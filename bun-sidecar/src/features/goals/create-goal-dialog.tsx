import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/hooks/useTheme";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GoalRecord } from "./goal-types";

const HORIZON_OPTIONS: { value: GoalRecord["horizon"]; label: string }[] = [
    { value: "vision", label: "Vision" },
    { value: "yearly", label: "Yearly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "monthly", label: "Monthly" },
];

const PROGRESS_MODE_OPTIONS: { value: GoalRecord["progressMode"]; label: string }[] = [
    { value: "rollup", label: "Rollup (from linked work)" },
    { value: "manual", label: "Manual (0-100%)" },
    { value: "metric", label: "Metric (current / target)" },
    { value: "milestone", label: "Milestone (child goal completion)" },
];

interface CreateGoalDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreateGoal: (args: {
        title: string;
        area: string;
        horizon: GoalRecord["horizon"];
        progressMode: GoalRecord["progressMode"];
        description?: string;
    }) => Promise<void>;
    loading: boolean;
}

export function CreateGoalDialog({
    open,
    onOpenChange,
    onCreateGoal,
    loading,
}: CreateGoalDialogProps) {
    const [title, setTitle] = useState("");
    const [area, setArea] = useState("");
    const [horizon, setHorizon] = useState<GoalRecord["horizon"]>("quarterly");
    const [progressMode, setProgressMode] = useState<GoalRecord["progressMode"]>("rollup");
    const inputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    useEffect(() => {
        if (open) {
            setTitle("");
            setArea("");
            setHorizon("quarterly");
            setProgressMode("rollup");
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const handleCreate = async () => {
        const trimmedTitle = title.trim();
        const trimmedArea = area.trim();
        if (trimmedTitle && trimmedArea && !loading) {
            await onCreateGoal({
                title: trimmedTitle,
                area: trimmedArea,
                horizon,
                progressMode,
            });
            onOpenChange(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && title.trim() && area.trim()) {
            e.preventDefault();
            void handleCreate();
        }
    };

    const isValid = title.trim().length > 0 && area.trim().length > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button
                    variant="default"
                    size="sm"
                    className="h-7 px-2 text-xs font-medium rounded-md"
                >
                    + new
                </Button>
            </DialogTrigger>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: "440px",
                    maxWidth: "90vw",
                }}
            >
                <div
                    className="px-6 py-3 flex items-center justify-between"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderBottom: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <span className="text-xs font-medium uppercase tracking-[0.08em]" style={{ color: styles.contentPrimary }}>
                        Create Goal
                    </span>
                    <span className="text-caption" style={{ color: styles.contentTertiary }}>
                        Enter to confirm
                    </span>
                </div>

                <div className="px-6 pt-5 pb-4 space-y-3">
                    <div className="space-y-2">
                        <div className="text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Title
                        </div>
                        <Input
                            ref={inputRef}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="What do you want to achieve?"
                            className="h-10 text-sm border rounded-md px-3 focus-visible:ring-0"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                borderColor: styles.borderDefault,
                            }}
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Area
                        </div>
                        <Input
                            value={area}
                            onChange={(e) => setArea(e.target.value)}
                            placeholder="e.g. Career, Health, Finance"
                            className="h-10 text-sm border rounded-md px-3 focus-visible:ring-0"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                borderColor: styles.borderDefault,
                            }}
                            onKeyDown={handleKeyDown}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <div className="text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                                Horizon
                            </div>
                            <Select value={horizon} onValueChange={(v) => setHorizon(v as GoalRecord["horizon"])}>
                                <SelectTrigger
                                    className="h-10 text-sm"
                                    style={{
                                        color: styles.contentPrimary,
                                        backgroundColor: styles.surfaceSecondary,
                                        borderColor: styles.borderDefault,
                                    }}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {HORIZON_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <div className="text-caption uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                                Progress Mode
                            </div>
                            <Select value={progressMode} onValueChange={(v) => setProgressMode(v as GoalRecord["progressMode"])}>
                                <SelectTrigger
                                    className="h-10 text-sm"
                                    style={{
                                        color: styles.contentPrimary,
                                        backgroundColor: styles.surfaceSecondary,
                                        borderColor: styles.borderDefault,
                                    }}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PROGRESS_MODE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                <div
                    className="px-6 py-3 flex items-center justify-end gap-2"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderTop: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <Button
                        onClick={() => onOpenChange(false)}
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-xs"
                    >
                        Cancel
                    </Button>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                onClick={() => { void handleCreate(); }}
                                disabled={!isValid || loading}
                                size="sm"
                                className="h-8 px-3 text-xs"
                            >
                                {loading ? "Creating..." : "Create"}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent
                            className="z-[100]"
                            style={{
                                backgroundColor: styles.surfaceTertiary,
                                color: styles.contentPrimary,
                                border: `1px solid ${styles.borderDefault}`,
                            }}
                        >
                            <KeyboardIndicator keys={["enter"]} />
                        </TooltipContent>
                    </Tooltip>
                </div>
            </DialogContent>
        </Dialog>
    );
}
