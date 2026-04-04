import { Search, SlidersHorizontal, ArrowUpDown, X, AlertTriangle, Clock, AlertCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/hooks/useTheme";
import { useState } from "react";
import { TodoFilterPopover } from "./TodoFilterPopover";
import type {
    TodoFilterState,
    TodoQuickPreset,
    TodoSortMode,
    TodoStatusBucket,
    FilterChip,
} from "./todo-filter-types";

const SORT_MODE_LABELS: Record<TodoSortMode, string> = {
    urgency: "Urgency",
    manual: "Manual",
    recent: "Recent",
};

const PRESET_CONFIG: { value: TodoQuickPreset; label: string; icon: typeof AlertTriangle }[] = [
    { value: "needs_attention", label: "Needs Attention", icon: AlertTriangle },
    { value: "due_today", label: "Due Today", icon: Clock },
    { value: "overdue", label: "Overdue", icon: AlertCircle },
];

interface TodoFilterToolbarProps {
    filterState: TodoFilterState;
    onSearchChange: (query: string) => void;
    onSortModeChange: (mode: TodoSortMode) => void;
    onActivatePreset: (preset: TodoQuickPreset) => void;
    onFilterChange: (partial: Partial<TodoFilterState>) => void;
    onClearAllFilters: () => void;

    // Data for filter options
    availableTags: string[];
    availableProjects?: string[];

    // Per-view config
    showStatusBucket?: boolean;
    statusBucketCounts?: Record<TodoStatusBucket, number>;
    onStatusBucketChange?: (bucket: TodoStatusBucket) => void;
    allowedSortModes: TodoSortMode[];
    showQuickPresets?: boolean;
    showDueFilter?: boolean;

    // Chips
    activeFilterChips: FilterChip[];
    hasActiveFilters: boolean;

    // Slots
    trailingActions?: React.ReactNode;
}

const STATUS_BUCKET_CONFIG: { value: TodoStatusBucket; label: string }[] = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Done" },
    { value: "archived", label: "Archived" },
];

export function TodoFilterToolbar({
    filterState,
    onSearchChange,
    onSortModeChange,
    onActivatePreset,
    onFilterChange,
    onClearAllFilters,
    availableTags,
    availableProjects,
    showStatusBucket,
    statusBucketCounts,
    onStatusBucketChange,
    allowedSortModes,
    showQuickPresets = true,
    showDueFilter = true,
    activeFilterChips,
    hasActiveFilters,
    trailingActions,
}: TodoFilterToolbarProps) {
    const { currentTheme } = useTheme();
    const [filterOpen, setFilterOpen] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);

    const hasAnyActiveFilter = hasActiveFilters || filterState.selectedTags.length > 0
        || filterState.selectedPriority !== null || filterState.dueFilter !== "any";

    const visibleFilterChips = activeFilterChips.filter((chip) => {
        if (!showDueFilter && chip.type === "due") return false;
        if (!showQuickPresets && chip.type === "preset") return false;
        return true;
    });

    return (
        <div className="flex flex-col gap-2">
            {/* Row 1: Search + Controls + Presets */}
            <div className="flex items-center gap-2">
                {/* Search */}
                <div
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md flex-1 min-w-0 max-w-[220px]"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        border: `1px solid ${currentTheme.styles.borderDefault}`,
                    }}
                >
                    <Search className="size-3.5 shrink-0" style={{ color: currentTheme.styles.contentTertiary }} />
                    <input
                        type="text"
                        value={filterState.searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search..."
                        className="bg-transparent outline-none text-sm w-full min-w-0"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    />
                    {filterState.searchQuery && (
                        <button
                            onClick={() => onSearchChange("")}
                            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                            style={{ color: currentTheme.styles.contentTertiary }}
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </div>

                {/* Status bucket segmented control (inbox only) */}
                {showStatusBucket && onStatusBucketChange && (
                    <div
                        className="flex items-center rounded-md overflow-hidden"
                        style={{
                            border: `1px solid ${currentTheme.styles.borderDefault}`,
                        }}
                    >
                        {STATUS_BUCKET_CONFIG.map((bucket) => {
                            const isActive = filterState.statusBucket === bucket.value;
                            const count = statusBucketCounts?.[bucket.value];
                            return (
                                <button
                                    key={bucket.value}
                                    onClick={() => onStatusBucketChange(bucket.value)}
                                    className="px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1"
                                    style={{
                                        backgroundColor: isActive ? currentTheme.styles.surfaceTertiary : 'transparent',
                                        color: isActive ? currentTheme.styles.contentPrimary : currentTheme.styles.contentTertiary,
                                    }}
                                >
                                    {bucket.label}
                                    {count !== undefined && (
                                        <span className="opacity-60">{count}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Filter popover */}
                <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                    <PopoverTrigger asChild>
                        <button
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors relative"
                            style={{
                                backgroundColor: hasAnyActiveFilter ? currentTheme.styles.surfaceTertiary : 'transparent',
                                color: hasAnyActiveFilter ? currentTheme.styles.contentPrimary : currentTheme.styles.contentTertiary,
                                border: `1px solid ${currentTheme.styles.borderDefault}`,
                            }}
                        >
                            <SlidersHorizontal className="size-3.5" />
                            Filter
                            {hasAnyActiveFilter && (
                                <span
                                    className="size-1.5 rounded-full absolute -top-0.5 -right-0.5"
                                    style={{ backgroundColor: currentTheme.styles.contentAccent }}
                                />
                            )}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        className="w-64 p-2 max-h-[min(70vh,500px)] overflow-y-auto"
                        align="start"
                        style={{
                            backgroundColor: currentTheme.styles.surfacePrimary,
                            borderColor: currentTheme.styles.borderDefault,
                        }}
                    >
                        <TodoFilterPopover
                            selectedPriority={filterState.selectedPriority}
                            onPriorityChange={(p) => onFilterChange({ selectedPriority: p })}
                            dueFilter={filterState.dueFilter}
                            onDueFilterChange={(d) => onFilterChange({ dueFilter: d })}
                            showDueFilter={showDueFilter}
                            availableTags={availableTags}
                            selectedTags={filterState.selectedTags}
                            onTagToggle={(tag) => {
                                const tags = filterState.selectedTags.includes(tag)
                                    ? filterState.selectedTags.filter((t) => t !== tag)
                                    : [...filterState.selectedTags, tag];
                                onFilterChange({ selectedTags: tags });
                            }}
                            onTagsClearAll={() => onFilterChange({ selectedTags: [] })}
                            availableProjects={availableProjects}
                            selectedProject={filterState.selectedProject}
                            onProjectChange={availableProjects ? (p) => onFilterChange({ selectedProject: p }) : undefined}
                            onClose={() => setFilterOpen(false)}
                        />
                    </PopoverContent>
                </Popover>

                {/* Sort popover */}
                {allowedSortModes.length > 1 && (
                    <Popover open={sortOpen} onOpenChange={setSortOpen}>
                        <PopoverTrigger asChild>
                            <button
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                                style={{
                                    color: currentTheme.styles.contentTertiary,
                                    border: `1px solid ${currentTheme.styles.borderDefault}`,
                                }}
                            >
                                <ArrowUpDown className="size-3.5" />
                                {SORT_MODE_LABELS[filterState.sortMode]}
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            className="w-40 p-1"
                            align="start"
                            style={{
                                backgroundColor: currentTheme.styles.surfacePrimary,
                                borderColor: currentTheme.styles.borderDefault,
                            }}
                        >
                            {allowedSortModes.map((mode) => {
                                const isActive = filterState.sortMode === mode;
                                return (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => {
                                            onSortModeChange(mode);
                                            setSortOpen(false);
                                        }}
                                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-sm transition-colors text-left"
                                        style={{
                                            backgroundColor: isActive ? currentTheme.styles.surfaceTertiary : 'transparent',
                                            color: currentTheme.styles.contentPrimary,
                                        }}
                                    >
                                        {SORT_MODE_LABELS[mode]}
                                    </button>
                                );
                            })}
                        </PopoverContent>
                    </Popover>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Quick presets */}
                {showQuickPresets && (
                    <div className="flex items-center gap-1">
                        {PRESET_CONFIG.map((preset) => {
                            const isActive = filterState.quickPreset === preset.value;
                            const Icon = preset.icon;
                            return (
                                <button
                                    key={preset.value}
                                    onClick={() => onActivatePreset(preset.value)}
                                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors"
                                    style={{
                                        backgroundColor: isActive ? currentTheme.styles.surfaceAccent : 'transparent',
                                        color: isActive ? currentTheme.styles.contentPrimary : currentTheme.styles.contentTertiary,
                                        border: isActive ? 'none' : `1px solid transparent`,
                                    }}
                                >
                                    <Icon className="size-3" />
                                    {preset.label}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Trailing actions */}
                {trailingActions}
            </div>

            {/* Row 2: Active filter chips (conditional) */}
            {visibleFilterChips.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    {visibleFilterChips.map((chip, i) => (
                        <span
                            key={`${chip.type}-${i}`}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs"
                            style={{
                                backgroundColor: currentTheme.styles.surfaceTertiary,
                                color: currentTheme.styles.contentSecondary,
                            }}
                        >
                            {chip.label}
                            <button
                                onClick={chip.onRemove}
                                className="opacity-50 hover:opacity-100 transition-opacity"
                                style={{ color: currentTheme.styles.contentTertiary }}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                    <button
                        onClick={onClearAllFilters}
                        className="text-xs opacity-50 hover:opacity-100 transition-opacity px-1"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        Clear all
                    </button>
                </div>
            )}
        </div>
    );
}
