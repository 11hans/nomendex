import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import type {
    TodoFilterState,
    TodoQuickPreset,
    TodoDueFilter,
    TodoStatusBucket,
    TodoSortMode,
    TodoViewPreferences,
    FilterChip,
} from "./todo-filter-types";
import { createDefaultFilterState } from "./todo-filter-types";
import { applyQuickPreset } from "./todo-filter-utils";
import type { PriorityValue } from "./todo-types";
import { PRIORITY_CONFIG } from "./todo-types";

type TodoViewKey = keyof TodoViewPreferences;

const DUE_FILTER_LABELS: Record<TodoDueFilter, string> = {
    any: "Any",
    overdue: "Overdue",
    today: "Today",
    next_7_days: "Next 7 Days",
    no_due: "No Due Date",
};

interface UseTodoFilterStateOptions {
    defaultSortMode?: TodoSortMode;
    defaultStatusBucket?: TodoStatusBucket;
}

export function useTodoFilterState(
    viewKey: TodoViewKey,
    options?: UseTodoFilterStateOptions,
) {
    const { getTodoViewPreferences, setTodoViewPreferences } = useWorkspaceContext();

    // Build defaults from options
    const defaults = useMemo(
        () => createDefaultFilterState({
            sortMode: options?.defaultSortMode ?? "urgency",
            statusBucket: options?.defaultStatusBucket ?? "all",
        }),
        [options?.defaultSortMode, options?.defaultStatusBucket],
    );

    // Initialize from workspace preferences (or defaults)
    const savedPrefs = getTodoViewPreferences(viewKey);
    const [filterState, setFilterState] = useState<TodoFilterState>(() => ({
        ...defaults,
        ...savedPrefs,
        // Always apply default sort/status if not previously saved
        sortMode: savedPrefs.sortMode ?? defaults.sortMode,
        statusBucket: savedPrefs.statusBucket ?? defaults.statusBucket,
    }));

    // Persist non-search changes immediately
    const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const persistState = useCallback(
        (state: TodoFilterState, debounce = false) => {
            if (persistTimeoutRef.current) {
                clearTimeout(persistTimeoutRef.current);
                persistTimeoutRef.current = null;
            }

            if (debounce) {
                persistTimeoutRef.current = setTimeout(() => {
                    setTodoViewPreferences(viewKey, state);
                }, 500);
            } else {
                setTodoViewPreferences(viewKey, state);
            }
        },
        [viewKey, setTodoViewPreferences],
    );

    // Flush on unmount
    useEffect(() => {
        return () => {
            if (persistTimeoutRef.current) {
                clearTimeout(persistTimeoutRef.current);
            }
        };
    }, []);

    // --- Setters ---

    const updateFilter = useCallback(
        (updater: (prev: TodoFilterState) => TodoFilterState, debounce = false) => {
            setFilterState((prev) => {
                const next = updater(prev);
                persistState(next, debounce);
                return next;
            });
        },
        [persistState],
    );

    const setSearchQuery = useCallback(
        (query: string) => updateFilter((prev) => ({ ...prev, searchQuery: query }), true),
        [updateFilter],
    );

    const setStatusBucket = useCallback(
        (bucket: TodoStatusBucket) => updateFilter((prev) => ({
            ...prev,
            statusBucket: bucket,
            quickPreset: "none",
        })),
        [updateFilter],
    );

    const setSelectedTags = useCallback(
        (tags: string[]) => updateFilter((prev) => ({
            ...prev,
            selectedTags: tags,
            quickPreset: "none",
        })),
        [updateFilter],
    );

    const toggleTag = useCallback(
        (tag: string) => updateFilter((prev) => {
            const tags = prev.selectedTags.includes(tag)
                ? prev.selectedTags.filter((t) => t !== tag)
                : [...prev.selectedTags, tag];
            return { ...prev, selectedTags: tags, quickPreset: "none" };
        }),
        [updateFilter],
    );

    const setSelectedPriority = useCallback(
        (priority: PriorityValue | null) => updateFilter((prev) => ({
            ...prev,
            selectedPriority: priority,
            quickPreset: "none",
        })),
        [updateFilter],
    );

    const setDueFilter = useCallback(
        (due: TodoDueFilter) => updateFilter((prev) => ({
            ...prev,
            dueFilter: due,
            quickPreset: "none",
        })),
        [updateFilter],
    );

    const setSelectedProject = useCallback(
        (project: string | null) => updateFilter((prev) => ({
            ...prev,
            selectedProject: project,
            quickPreset: "none",
        })),
        [updateFilter],
    );

    const setSortMode = useCallback(
        (mode: TodoSortMode) => updateFilter((prev) => ({ ...prev, sortMode: mode })),
        [updateFilter],
    );

    const activatePreset = useCallback(
        (preset: TodoQuickPreset) => updateFilter((prev) => {
            if (prev.quickPreset === preset) {
                // Toggle off: reset to defaults (keep search and sort)
                return {
                    ...defaults,
                    searchQuery: prev.searchQuery,
                    sortMode: prev.sortMode,
                };
            }
            const presetOverrides = applyQuickPreset(preset);
            return {
                ...prev,
                ...presetOverrides,
                // Keep search and sort
                searchQuery: prev.searchQuery,
                sortMode: prev.sortMode,
            };
        }),
        [updateFilter, defaults],
    );

    const clearAllFilters = useCallback(
        () => updateFilter((prev) => ({
            ...defaults,
            searchQuery: prev.searchQuery,
            sortMode: prev.sortMode,
        })),
        [updateFilter, defaults],
    );

    // --- Derived state ---

    const hasActiveFilters = useMemo(() => {
        return (
            filterState.selectedTags.length > 0
            || filterState.selectedPriority !== null
            || filterState.dueFilter !== "any"
            || filterState.selectedProject !== null
            || filterState.quickPreset !== "none"
            || (filterState.statusBucket !== defaults.statusBucket && filterState.statusBucket !== "all")
        );
    }, [filterState, defaults.statusBucket]);

    const activeFilterChips = useMemo(() => {
        const chips: FilterChip[] = [];

        if (filterState.quickPreset !== "none") {
            const labels: Record<string, string> = {
                needs_attention: "Needs Attention",
                due_today: "Due Today",
                overdue: "Overdue",
            };
            chips.push({
                type: "preset",
                label: labels[filterState.quickPreset] ?? filterState.quickPreset,
                onRemove: () => activatePreset(filterState.quickPreset),
            });
        }

        for (const tag of filterState.selectedTags) {
            chips.push({
                type: "tag",
                label: `Tag: ${tag}`,
                onRemove: () => toggleTag(tag),
            });
        }

        if (filterState.selectedPriority !== null) {
            const config = PRIORITY_CONFIG.find((p) => p.value === filterState.selectedPriority);
            chips.push({
                type: "priority",
                label: `Priority: ${config?.label ?? filterState.selectedPriority}`,
                onRemove: () => setSelectedPriority(null),
            });
        }

        if (filterState.dueFilter !== "any") {
            chips.push({
                type: "due",
                label: `Due: ${DUE_FILTER_LABELS[filterState.dueFilter]}`,
                onRemove: () => setDueFilter("any"),
            });
        }

        if (filterState.selectedProject !== null) {
            chips.push({
                type: "project",
                label: `Project: ${filterState.selectedProject || "No Project"}`,
                onRemove: () => setSelectedProject(null),
            });
        }

        return chips;
    }, [filterState, activatePreset, toggleTag, setSelectedPriority, setDueFilter, setSelectedProject]);

    return {
        filterState,
        setSearchQuery,
        setStatusBucket,
        setSelectedTags,
        toggleTag,
        setSelectedPriority,
        setDueFilter,
        setSelectedProject,
        setSortMode,
        activatePreset,
        hasActiveFilters,
        activeFilterChips,
        clearAllFilters,
    };
}
