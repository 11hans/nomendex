import { z } from "zod";
// --- Enums ---

export const TodoQuickPresetSchema = z.enum(["none", "needs_attention", "due_today", "overdue"]);
export type TodoQuickPreset = z.infer<typeof TodoQuickPresetSchema>;

export const TodoDueFilterSchema = z.enum(["any", "overdue", "today", "today_or_overdue", "next_7_days", "no_due"]);
export type TodoDueFilter = z.infer<typeof TodoDueFilterSchema>;

export const TodoStatusBucketSchema = z.enum(["all", "active", "completed", "archived"]);
export type TodoStatusBucket = z.infer<typeof TodoStatusBucketSchema>;

export const TodoSortModeSchema = z.enum(["urgency", "manual", "recent"]);
export type TodoSortMode = z.infer<typeof TodoSortModeSchema>;

// --- Due bucket classification (for urgency sort) ---

export type DueBucket = "overdue" | "today" | "next_7_days" | "no_due";

// --- Filter state ---

export const TodoFilterStateSchema = z.object({
    searchQuery: z.string().default(""),
    statusBucket: TodoStatusBucketSchema.default("all"),
    selectedTags: z.array(z.string()).default([]),
    selectedPriority: z.enum(["high", "medium", "low", "none"]).nullable().default(null),
    dueFilter: TodoDueFilterSchema.default("any"),
    selectedProject: z.string().nullable().default(null),
    quickPreset: TodoQuickPresetSchema.default("none"),
    sortMode: TodoSortModeSchema.default("urgency"),
});

export type TodoFilterState = z.infer<typeof TodoFilterStateSchema>;

// --- View preferences (stored in workspace state) ---

export const TodoViewPreferencesSchema = z.object({
    inbox: TodoFilterStateSchema.optional(),
    browser: TodoFilterStateSchema.optional(),
    archived: TodoFilterStateSchema.optional(),
});

export type TodoViewPreferences = z.infer<typeof TodoViewPreferencesSchema>;

// --- Reusable filter criteria (subset without search/sort) ---

export const TodoFilterCriteriaSchema = TodoFilterStateSchema.pick({
    statusBucket: true,
    selectedTags: true,
    selectedPriority: true,
    dueFilter: true,
    selectedProject: true,
    quickPreset: true,
});

export type TodoFilterCriteria = z.infer<typeof TodoFilterCriteriaSchema>;

// --- Filter chip (UI helper) ---

export interface FilterChip {
    type: "tag" | "priority" | "due" | "project" | "status" | "preset";
    label: string;
    onRemove: () => void;
}

// --- Default filter state factory ---

export function createDefaultFilterState(overrides?: Partial<TodoFilterState>): TodoFilterState {
    return {
        searchQuery: "",
        statusBucket: "all",
        selectedTags: [],
        selectedPriority: null,
        dueFilter: "any",
        selectedProject: null,
        quickPreset: "none",
        sortMode: "urgency",
        ...overrides,
    };
}
