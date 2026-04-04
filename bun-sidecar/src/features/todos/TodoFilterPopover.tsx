import { useTheme } from "@/hooks/useTheme";
import { PriorityFilterContent } from "./PriorityFilter";
import { TagFilterContent } from "./TagFilter";
import type { TodoDueFilter } from "./todo-filter-types";
import type { PriorityValue } from "./todo-types";
import { Calendar, Flag, Hash, FolderOpen } from "lucide-react";

const DUE_FILTER_OPTIONS: { value: TodoDueFilter; label: string }[] = [
    { value: "any", label: "Any" },
    { value: "overdue", label: "Overdue" },
    { value: "today", label: "Today" },
    { value: "today_or_overdue", label: "Today + Overdue" },
    { value: "next_7_days", label: "Next 7 Days" },
    { value: "no_due", label: "No Due Date" },
];

interface TodoFilterPopoverProps {
    // Priority
    selectedPriority: PriorityValue | null;
    onPriorityChange: (priority: PriorityValue | null) => void;
    // Due
    dueFilter: TodoDueFilter;
    onDueFilterChange: (due: TodoDueFilter) => void;
    // Tags
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
    onTagsClearAll: () => void;
    // Project (optional)
    availableProjects?: string[];
    selectedProject: string | null;
    onProjectChange?: (project: string | null) => void;
    // Close
    onClose?: () => void;
}

export function TodoFilterPopover({
    selectedPriority,
    onPriorityChange,
    dueFilter,
    onDueFilterChange,
    availableTags,
    selectedTags,
    onTagToggle,
    onTagsClearAll,
    availableProjects,
    selectedProject,
    onProjectChange,
    onClose,
}: TodoFilterPopoverProps) {
    const { currentTheme } = useTheme();

    const sectionLabelStyle = {
        color: currentTheme.styles.contentTertiary,
    };

    return (
        <div className="flex flex-col gap-4 p-1">
            {/* Priority */}
            <div>
                <div className="flex items-center gap-1.5 px-2 mb-1.5 text-xs font-medium uppercase tracking-wider" style={sectionLabelStyle}>
                    <Flag className="size-3" />
                    Priority
                </div>
                <PriorityFilterContent
                    selectedPriority={selectedPriority}
                    onPriorityChange={onPriorityChange}
                />
            </div>

            <div style={{ borderTop: `1px solid ${currentTheme.styles.borderDefault}` }} />

            {/* Due */}
            <div>
                <div className="flex items-center gap-1.5 px-2 mb-1.5 text-xs font-medium uppercase tracking-wider" style={sectionLabelStyle}>
                    <Calendar className="size-3" />
                    Due Date
                </div>
                <div className="flex flex-col gap-0.5">
                    {DUE_FILTER_OPTIONS.map((option) => {
                        const isActive = dueFilter === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => {
                                    onDueFilterChange(isActive ? "any" : option.value);
                                }}
                                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-sm transition-colors text-left"
                                style={{
                                    backgroundColor: isActive ? currentTheme.styles.surfaceTertiary : 'transparent',
                                    color: currentTheme.styles.contentPrimary,
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div style={{ borderTop: `1px solid ${currentTheme.styles.borderDefault}` }} />

            {/* Tags */}
            <div>
                <div className="flex items-center gap-1.5 px-2 mb-1.5 text-xs font-medium uppercase tracking-wider" style={sectionLabelStyle}>
                    <Hash className="size-3" />
                    Tags
                </div>
                <div className="px-1">
                    <TagFilterContent
                        availableTags={availableTags}
                        selectedTags={selectedTags}
                        onTagToggle={onTagToggle}
                        onClearAll={onTagsClearAll}
                        onDone={onClose}
                        autoFocus={false}
                    />
                </div>
            </div>

            {/* Project (optional) */}
            {availableProjects && availableProjects.length > 0 && onProjectChange && (
                <>
                    <div style={{ borderTop: `1px solid ${currentTheme.styles.borderDefault}` }} />
                    <div>
                        <div className="flex items-center gap-1.5 px-2 mb-1.5 text-xs font-medium uppercase tracking-wider" style={sectionLabelStyle}>
                            <FolderOpen className="size-3" />
                            Project
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <button
                                type="button"
                                onClick={() => onProjectChange(null)}
                                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-sm transition-colors text-left"
                                style={{
                                    backgroundColor: selectedProject === null ? currentTheme.styles.surfaceTertiary : 'transparent',
                                    color: currentTheme.styles.contentPrimary,
                                }}
                            >
                                All Projects
                            </button>
                            {availableProjects.map((project) => {
                                const isActive = selectedProject === project;
                                return (
                                    <button
                                        key={project}
                                        type="button"
                                        onClick={() => onProjectChange(isActive ? null : project)}
                                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-sm transition-colors text-left"
                                        style={{
                                            backgroundColor: isActive ? currentTheme.styles.surfaceTertiary : 'transparent',
                                            color: currentTheme.styles.contentPrimary,
                                        }}
                                    >
                                        {project}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
