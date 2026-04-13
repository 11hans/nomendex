import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Compass, FolderKanban, Target } from "lucide-react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { goalsAPI } from "@/hooks/useGoalsAPI";
import { useIndexedListNavigation } from "@/hooks/useIndexedListNavigation";
import { BrowserListCard, BrowserViewShell } from "@/features/shared/browser-view-shell";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { GoalForestNodeView } from "./goals-view-types";
import type { GoalRecord } from "./goal-types";
import { buildGoalsBrowserViewModel, statusLabel, type GoalAttentionReason, type GoalBrowserFilterMode } from "./goals-view-model";
import { goalsPluginSerial } from "./plugin";
import { CreateGoalDialog } from "./create-goal-dialog";

const REASON_LABELS: Record<GoalAttentionReason, string> = {
    without_next_action: "Without next action",
    stale: "Stale",
    nearly_complete: "Nearly complete",
};

const STATUS_OPTIONS: GoalRecord["status"][] = ["active", "completed", "paused", "dropped"];

function QuickStatusPill({
    status,
    onSelect,
    styles,
}: {
    status: GoalRecord["status"];
    onSelect: (status: GoalRecord["status"]) => void;
    styles: ReturnType<typeof useTheme>["currentTheme"]["styles"];
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption transition-colors hover:ring-1 hover:ring-offset-1"
                    style={{
                        backgroundColor: styles.surfaceTertiary,
                        color: styles.contentSecondary,
                    }}
                >
                    {statusLabel(status)}
                    <ChevronDown className="size-2" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                {STATUS_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                        key={opt}
                        onClick={() => onSelect(opt)}
                        className={opt === status ? "font-medium" : ""}
                    >
                        {statusLabel(opt)}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function GoalsBrowserView({ tabId }: { tabId: string }) {
    if (!tabId) {
        throw new Error("tabId is required");
    }

    const { activeTab, setTabName, openTab } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const { currentTheme } = useTheme();

    const [forest, setForest] = useState<GoalForestNodeView[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterMode, setFilterMode] = useState<GoalBrowserFilterMode>("all");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [hoveredGoalId, setHoveredGoalId] = useState<string | null>(null);
    const hasSetTabNameRef = useRef(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const loadForest = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            setForest(await goalsAPI.getGoalForest());
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to fetch goals";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [setError, setLoading]);

    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, "Goals");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, setTabName]);

    useEffect(() => {
        if (activeTab?.id === tabId && !loading) {
            requestAnimationFrame(() => {
                searchInputRef.current?.focus({ preventScroll: true });
            });
        }
    }, [activeTab?.id, tabId, loading]);

    useEffect(() => {
        void loadForest();
    }, [loadForest]);

    const viewModel = useMemo(
        () => buildGoalsBrowserViewModel(forest, searchQuery, filterMode),
        [forest, searchQuery, filterMode],
    );

    const handleSummaryClick = useCallback((mode: GoalBrowserFilterMode) => {
        setFilterMode((prev) => prev === mode ? "all" : mode);
    }, []);

    const handleOpenGoal = useCallback((goalId: string) => {
        openTab({
            pluginMeta: goalsPluginSerial,
            view: "detail",
            props: { goalId },
        });
    }, [openTab]);

    const handleQuickStatusChange = useCallback(async (goalId: string, status: GoalRecord["status"]) => {
        try {
            await goalsAPI.updateGoal({ goalId, updates: { status } });
            setForest(await goalsAPI.getGoalForest());
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update status");
        }
    }, []);

    const handleCreateGoal = useCallback(async (args: {
        title: string;
        area: string;
        horizon: GoalRecord["horizon"];
        progressMode: GoalRecord["progressMode"];
    }) => {
        try {
            setCreateLoading(true);
            const created = await goalsAPI.createGoal(args);
            setForest(await goalsAPI.getGoalForest());
            toast.success(`Goal "${created.title}" created`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create goal");
        } finally {
            setCreateLoading(false);
        }
    }, []);

    const { selectedIndex: _selectedIndex, listRef, handleKeyDown } = useIndexedListNavigation({
        itemCount: viewModel.filteredRows.length,
        resetKey: searchQuery,
        onEnter: (index) => {
            const row = viewModel.filteredRows[index];
            if (row) {
                handleOpenGoal(row.goal.id);
            }
        },
    });

    const noGoals = forest.length === 0;
    const allGoalsWithoutNextAction = viewModel.allRows.length > 0 && viewModel.allRows.every((row) => row.openTodoCount === 0);

    const emptyLabel = noGoals
        ? "No typed goals yet. Goals represent what you want to achieve — your strategic layer above projects and tasks. Create your first goal with the + new button above."
        : filterMode !== "all"
            ? "No goals match the selected filter. Click the active summary card again to clear."
            : "No goals match current search.";

    return (
        <BrowserViewShell
            styles={currentTheme.styles}
            loading={loading}
            loadingLabel="loading goals..."
            error={error}
            errorLabel="failed to load goals"
            title="Goals"
            itemCount={viewModel.allRows.length}
            headerIcon={(
                <Target
                    className="size-3"
                    style={{ color: currentTheme.styles.contentTertiary }}
                />
            )}
            action={(
                <CreateGoalDialog
                    open={createDialogOpen}
                    onOpenChange={setCreateDialogOpen}
                    onCreateGoal={handleCreateGoal}
                    loading={createLoading}
                />
            )}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onSearchKeyDown={handleKeyDown}
            searchInputRef={searchInputRef}
            searchPlaceholder="search goals by title or area..."
            empty={viewModel.filteredRows.length === 0}
            emptyLabel={emptyLabel}
            listRef={listRef}
            rootClassName="goals-browser"
        >
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {([
                        { label: "Active", value: viewModel.summary.active, mode: "all" as const },
                        { label: "Needs attention", value: viewModel.summary.needsAttention, mode: "needs_attention" as const },
                        { label: "Without next action", value: viewModel.summary.withoutNextAction, mode: "without_next_action" as const },
                    ]).map((item) => {
                        const isActive = filterMode === item.mode || (item.mode === "all" && filterMode === "all");
                        const isFilterCard = item.mode !== "all";
                        return (
                            <button
                                key={item.label}
                                onClick={() => isFilterCard ? handleSummaryClick(item.mode) : setFilterMode("all")}
                                className="rounded-md border px-2.5 py-2 text-left transition-colors"
                                style={{
                                    borderColor: isActive && isFilterCard
                                        ? currentTheme.styles.contentAccent
                                        : currentTheme.styles.borderDefault,
                                    backgroundColor: currentTheme.styles.surfaceSecondary,
                                }}
                            >
                                <div
                                    className="text-caption uppercase tracking-[0.08em]"
                                    style={{ color: currentTheme.styles.contentTertiary }}
                                >
                                    {item.label}
                                </div>
                                <div
                                    className="mt-1 text-sm font-semibold"
                                    style={{ color: currentTheme.styles.contentPrimary }}
                                >
                                    {item.value}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {allGoalsWithoutNextAction && (
                    <div
                        className="rounded-md border px-2.5 py-2 text-xs"
                        style={{
                            borderColor: currentTheme.styles.borderDefault,
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            color: currentTheme.styles.contentSecondary,
                        }}
                    >
                        Goals exist but no next actions are open. Create a task and link it to a goal.
                    </div>
                )}

                {viewModel.attentionRows.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                            <AlertTriangle
                                className="size-3"
                                style={{ color: currentTheme.styles.semanticDestructive }}
                            />
                            <span
                                className="text-caption uppercase tracking-[0.12em]"
                                style={{ color: currentTheme.styles.contentSecondary }}
                            >
                                Attention
                            </span>
                        </div>
                        <BrowserListCard styles={currentTheme.styles}>
                            {viewModel.attentionRows.map((row, idx) => {
                                const isHovered = hoveredGoalId === row.goal.id;
                                return (
                                    <button
                                        key={`attention-${row.goal.id}`}
                                        onMouseEnter={() => setHoveredGoalId(row.goal.id)}
                                        onMouseLeave={() => setHoveredGoalId((prev) => prev === row.goal.id ? null : prev)}
                                        onClick={() => handleOpenGoal(row.goal.id)}
                                        className={`w-full border-t px-2.5 py-2 text-left transition-colors ${idx === 0 ? "border-t-0" : ""}`}
                                        style={{
                                            borderColor: currentTheme.styles.borderDefault,
                                            backgroundColor: isHovered ? currentTheme.styles.surfaceAccent : undefined,
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span
                                                className="text-xs font-medium truncate"
                                                style={{ color: currentTheme.styles.contentPrimary }}
                                            >
                                                {row.goal.title}
                                            </span>
                                            <span
                                                className="ml-auto text-caption"
                                                style={{ color: currentTheme.styles.contentTertiary }}
                                            >
                                                {row.computedProgress}%
                                            </span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {row.attentionReasons
                                                .filter((reason) => reason !== "nearly_complete")
                                                .map((reason) => (
                                                    <span
                                                        key={`${row.goal.id}-${reason}`}
                                                        className="rounded-full px-1.5 py-0.5 text-caption"
                                                        style={{
                                                            backgroundColor: currentTheme.styles.surfaceTertiary,
                                                            color: currentTheme.styles.semanticDestructive,
                                                        }}
                                                    >
                                                        {REASON_LABELS[reason]}
                                                    </span>
                                                ))}
                                        </div>
                                    </button>
                                );
                            })}
                        </BrowserListCard>
                    </div>
                )}

                {viewModel.groups.map((group) => (
                    <div key={group.horizon} className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                            <Compass
                                className="size-3"
                                style={{ color: currentTheme.styles.contentTertiary }}
                            />
                            <span
                                className="text-caption uppercase tracking-[0.12em]"
                                style={{ color: currentTheme.styles.contentSecondary }}
                            >
                                {group.label}
                            </span>
                            <span
                                className="text-caption"
                                style={{ color: currentTheme.styles.contentTertiary }}
                            >
                                {group.rows.length}
                            </span>
                        </div>
                        <BrowserListCard styles={currentTheme.styles}>
                            {group.rows.map((row, rowInGroupIndex) => {
                                const isHovered = hoveredGoalId === row.goal.id;
                                return (
                                    <div
                                        key={row.goal.id}
                                        role="button"
                                        tabIndex={0}
                                        onMouseEnter={() => setHoveredGoalId(row.goal.id)}
                                        onMouseLeave={() => setHoveredGoalId((prev) => prev === row.goal.id ? null : prev)}
                                        onClick={() => handleOpenGoal(row.goal.id)}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleOpenGoal(row.goal.id); }}
                                        className={`w-full border-t px-2.5 py-2 text-left transition-colors cursor-pointer ${rowInGroupIndex === 0 ? "border-t-0" : ""}`}
                                        style={{
                                            borderColor: currentTheme.styles.borderDefault,
                                            backgroundColor: isHovered ? currentTheme.styles.surfaceAccent : undefined,
                                            color: currentTheme.styles.contentPrimary,
                                        }}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Target
                                                className="size-3 shrink-0"
                                                style={{ color: currentTheme.styles.contentTertiary }}
                                            />
                                            <span className="text-xs font-medium truncate">
                                                {row.goal.title}
                                            </span>
                                            <span
                                                className="ml-auto rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentSecondary,
                                                }}
                                            >
                                                {row.computedProgress}%
                                            </span>
                                        </div>
                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                            <span
                                                className="rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentSecondary,
                                                }}
                                            >
                                                {row.goal.area}
                                            </span>
                                            <QuickStatusPill
                                                status={row.goal.status}
                                                onSelect={(status) => { void handleQuickStatusChange(row.goal.id, status); }}
                                                styles={currentTheme.styles}
                                            />
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentSecondary,
                                                }}
                                            >
                                                <FolderKanban className="size-2.5" />
                                                {row.linkedProjectCount}
                                            </span>
                                            <span
                                                className="rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentSecondary,
                                                }}
                                            >
                                                open {row.openTodoCount}
                                            </span>
                                            {row.doneTodoCount > 0 && (
                                                <span
                                                    className="rounded-full px-1.5 py-0.5 text-caption"
                                                    style={{
                                                        backgroundColor: currentTheme.styles.surfaceTertiary,
                                                        color: currentTheme.styles.contentTertiary,
                                                    }}
                                                >
                                                    done {row.doneTodoCount}
                                                </span>
                                            )}
                                            {row.attentionReasons.includes("nearly_complete") && (
                                                <span
                                                    className="rounded-full px-1.5 py-0.5 text-caption"
                                                    style={{
                                                        backgroundColor: currentTheme.styles.surfaceTertiary,
                                                        color: currentTheme.styles.contentAccent,
                                                    }}
                                                >
                                                    {REASON_LABELS.nearly_complete}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </BrowserListCard>
                    </div>
                ))}
            </div>
        </BrowserViewShell>
    );
}

export default GoalsBrowserView;
