import { useEffect, useMemo, useState } from "react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { getDateLocale } from "@/utils/date-format";
import type { DateFormat } from "@/types/Workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/hooks/useTheme";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { DayConfig, DayType, TimeblockingConfig } from "./types";
import type { TimeblockingPreviewResult } from "./service";

const DAY_TYPE_OPTIONS: { value: DayType; label: string }[] = [
    { value: "work_full", label: "Work · full day" },
    { value: "work_early", label: "Work · early" },
    { value: "pohotovost", label: "On-call (pohotovost)" },
    { value: "free", label: "Free" },
];

function toLocalDateString(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function mondayOfWeek(ref: Date): Date {
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    const dow = d.getDay(); // 0=Sun .. 6=Sat
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return d;
}

function addDaysLocal(d: Date, n: number): Date {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + n);
    return nd;
}

function dayLabel(date: Date, dateFormat: DateFormat = "us"): string {
    return date.toLocaleDateString(getDateLocale(dateFormat), { weekday: "short", day: "numeric", month: "numeric" });
}

function datePart(value: string): string {
    return value.slice(0, 10);
}

export function TimeblockingDialog() {
    const { closeDialog } = useCommandDialog();
    const api = useTodosAPI();
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const { dateFormat } = useWorkspaceContext();

    const [weekStart, setWeekStart] = useState<string>(() => toLocalDateString(mondayOfWeek(new Date())));
    const [config, setConfig] = useState<TimeblockingConfig | null>(null);
    const [days, setDays] = useState<DayConfig[]>([]);
    const [preview, setPreview] = useState<TimeblockingPreviewResult | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [applying, setApplying] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Day types whose template references workEnd (e.g. "workEnd+30min").
    const workEndDayTypes = useMemo(() => {
        const set = new Set<DayType>();
        if (!config) return set;
        (Object.keys(config.dayTemplates) as DayType[]).forEach((dt) => {
            if (config.dayTemplates[dt].some((entry) => entry.start.includes("workEnd"))) {
                set.add(dt);
            }
        });
        return set;
    }, [config]);

    const weekDates = useMemo(() => {
        const start = new Date(`${weekStart}T00:00:00`);
        return Array.from({ length: 7 }, (_, i) => addDaysLocal(start, i));
    }, [weekStart]);

    // Load config once and seed default day types (weekdays = default, weekend = free).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const cfg = await api.getTimeblockingConfig();
                if (cancelled) return;
                setConfig(cfg);
                const fallback = cfg.defaults.defaultDayType;
                setDays(
                    Array.from({ length: 7 }, (_, i): DayConfig => ({
                        type: i >= 5 ? "free" : fallback,
                    })),
                );
            } catch (error) {
                if (!cancelled) {
                    setLoadError(error instanceof Error ? error.message : String(error));
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [api]);

    // Live preview (debounced) so Apply always matches what is shown.
    useEffect(() => {
        if (!config || days.length !== 7) return;
        let cancelled = false;
        setPreviewing(true);
        const timer = setTimeout(async () => {
            try {
                const result = await api.previewTimeblocking({ weekStart, days });
                if (!cancelled) setPreview(result);
            } catch (error) {
                if (!cancelled) {
                    setPreview(null);
                    toast.error(error instanceof Error ? error.message : "Preview failed");
                }
            } finally {
                if (!cancelled) setPreviewing(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [api, config, weekStart, days]);

    function setDayType(index: number, type: DayType) {
        setDays((prev) =>
            prev.map((day, i) => {
                if (i !== index) return day;
                const needsWorkEnd = workEndDayTypes.has(type);
                return {
                    type,
                    workEnd: needsWorkEnd ? day.workEnd ?? "16:00" : undefined,
                };
            }),
        );
    }

    function setWorkEnd(index: number, workEnd: string) {
        setDays((prev) => prev.map((day, i) => (i === index ? { ...day, workEnd } : day)));
    }

    function shiftWeek(deltaDays: number) {
        setPreview(null);
        setWeekStart((prev) => toLocalDateString(addDaysLocal(new Date(`${prev}T00:00:00`), deltaDays)));
    }

    function goThisWeek() {
        setPreview(null);
        setWeekStart(toLocalDateString(mondayOfWeek(new Date())));
    }

    async function handleApply() {
        if (!preview || preview.conflicts.length > 0) return;
        setApplying(true);
        try {
            const result = await api.applyTimeblocking({ weekStart, days });
            toast.success(
                `Planned ${result.createdTodos.length} block(s)` +
                (result.deletedBlocks.length > 0 ? `, replaced ${result.deletedBlocks.length}` : ""),
            );
            closeDialog();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Apply failed");
        } finally {
            setApplying(false);
        }
    }

    if (loadError) {
        return (
            <div className="p-4 text-sm text-destructive">
                Failed to load timeblocking config: {loadError}
            </div>
        );
    }

    if (!config || days.length !== 7) {
        return (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading templates…
            </div>
        );
    }

    const conflicts = preview?.conflicts ?? [];
    const hasConflicts = conflicts.length > 0;
    const blocksByDay = new Map<string, TimeblockingPreviewResult["generatedBlocks"]>();
    for (const block of preview?.generatedBlocks ?? []) {
        const key = datePart(block.scheduledStart);
        const list = blocksByDay.get(key) ?? [];
        list.push(block);
        blocksByDay.set(key, list);
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Week navigation */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <CalendarClock className="size-4 text-muted-foreground" />
                    <div>
                        <div className="text-sm font-medium">Week of {weekStart}</div>
                        <div className="text-xs text-muted-foreground">
                            {dayLabel(weekDates[0], dateFormat)} → {dayLabel(weekDates[6], dateFormat)}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => shiftWeek(-7)} aria-label="Previous week">
                        <ChevronLeft className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={goThisWeek}>
                        This week
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => shiftWeek(7)} aria-label="Next week">
                        <ChevronRight className="size-4" />
                    </Button>
                </div>
            </div>

            {/* Day type selectors */}
            <div className="flex flex-col gap-1.5">
                {days.map((day, i) => {
                    const needsWorkEnd = workEndDayTypes.has(day.type);
                    const blocks = blocksByDay.get(toLocalDateString(weekDates[i])) ?? [];
                    return (
                        <div
                            key={i}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5"
                            style={{ backgroundColor: styles.surfaceSecondary }}
                        >
                            <div className="w-24 shrink-0 text-xs text-muted-foreground capitalize">
                                {dayLabel(weekDates[i], dateFormat)}
                            </div>
                            <Select value={day.type} onValueChange={(v) => setDayType(i, v as DayType)}>
                                <SelectTrigger className="h-8 w-44 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {DAY_TYPE_OPTIONS.map((o) => (
                                        <SelectItem key={o.value} value={o.value} className="text-xs">
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {needsWorkEnd && (
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">work ends</span>
                                    <Input
                                        type="time"
                                        value={day.workEnd ?? ""}
                                        onChange={(e) => setWorkEnd(i, e.target.value)}
                                        className="h-8 w-28 text-xs"
                                    />
                                </div>
                            )}
                            <div className="ml-auto text-[10px] text-muted-foreground">
                                {blocks.length > 0 ? `${blocks.length} block${blocks.length === 1 ? "" : "s"}` : ""}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Conflicts */}
            {hasConflicts && (
                <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                    {conflicts.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-destructive">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            <span>
                                {c.day ? `${c.day}: ` : ""}{c.message}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Coverage */}
            {preview && preview.coverage.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {preview.coverage.map((rule) => (
                        <Badge
                            key={rule.id}
                            variant={rule.status === "ok" ? "secondary" : "outline"}
                            className={
                                rule.status === "ok"
                                    ? "gap-1 text-emerald-600 dark:text-emerald-400"
                                    : "gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400"
                            }
                        >
                            {rule.status === "ok" ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
                            {rule.label} — {rule.actual}/{rule.minPerWeek}
                        </Badge>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border pt-3">
                <div className="text-xs text-muted-foreground">
                    {previewing ? (
                        <span className="flex items-center gap-1">
                            <Loader2 className="size-3 animate-spin" /> Previewing…
                        </span>
                    ) : preview ? (
                        <span>
                            {preview.generatedBlocks.length} block(s) to create
                            {preview.existingBlocks.length > 0 ? ` · replaces ${preview.existingBlocks.length} existing` : ""}
                        </span>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={closeDialog}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleApply}
                        disabled={!preview || hasConflicts || previewing || applying || preview.generatedBlocks.length === 0}
                    >
                        {applying ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                        Apply to week
                    </Button>
                </div>
            </div>
        </div>
    );
}
