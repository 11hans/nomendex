import type { MouseEvent, RefObject } from "react";
import { CheckCircle2, Clock, FileText, Folder, FolderKanban, Pencil, Trash2 } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export interface ProjectListItem {
    id: string;
    name: string;
    projectKey: string;
    isNoProject?: boolean;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    notesCount?: number;
    totalCount?: number;
}

interface ProjectListProps {
    mode: "compact" | "full";
    items: ProjectListItem[];
    selectedIndex: number;
    onSelectedIndexChange: (index: number) => void;
    onOpenProject: (project: ProjectListItem) => void;
    emptyMessage: string;
    showNotesCount?: boolean;
    showTotalCount?: boolean;
    listRef?: RefObject<HTMLDivElement | null>;
    onRenameProject?: (project: ProjectListItem, e: MouseEvent) => void;
    onDeleteProject?: (project: ProjectListItem, e: MouseEvent) => void;
}

export function ProjectList({
    mode,
    items,
    selectedIndex,
    onSelectedIndexChange,
    onOpenProject,
    emptyMessage,
    showNotesCount = false,
    showTotalCount = false,
    listRef,
    onRenameProject,
    onDeleteProject,
}: ProjectListProps) {
    const { currentTheme } = useTheme();
    const isCompact = mode === "compact";

    if (items.length === 0) {
        return (
            <div
                className="flex items-center justify-center min-h-[220px] text-xs"
                style={{ color: currentTheme.styles.contentTertiary }}
            >
                {emptyMessage}
            </div>
        );
    }

    return (
        <div ref={listRef} className={cn("px-2 py-2", isCompact ? "space-y-1.5" : "space-y-1")}>
            {items.map((project, index) => {
                const isSelected = index === selectedIndex;
                const totalCount =
                    project.totalCount ?? (project.todoCount + project.inProgressCount + project.doneCount);
                const description = `${totalCount} task${totalCount === 1 ? "" : "s"}`;

                return (
                    <div
                        key={project.id}
                        data-index={index}
                        className={cn(
                            "group w-full flex items-center justify-between rounded-md transition-colors",
                            isCompact ? "px-3 py-2" : "px-3 py-2.5",
                            "hover:bg-accent/50"
                        )}
                        style={{
                            backgroundColor: isSelected
                                ? isCompact
                                    ? currentTheme.styles.surfaceSecondary
                                    : currentTheme.styles.surfaceAccent
                                : "transparent",
                        }}
                        onMouseEnter={() => onSelectedIndexChange(index)}
                    >
                        <button
                            onClick={() => onOpenProject(project)}
                            className="flex items-center gap-2 flex-1 text-left focus:outline-none"
                            style={{
                                color: project.isNoProject
                                    ? currentTheme.styles.contentTertiary
                                    : currentTheme.styles.contentPrimary,
                            }}
                        >
                            {project.isNoProject ? (
                                <Folder size={14} style={{ color: currentTheme.styles.contentTertiary }} />
                            ) : (
                                <FolderKanban size={14} style={{ color: currentTheme.styles.contentAccent }} />
                            )}
                            <span className="flex flex-col min-w-0">
                                <span className={cn("truncate", isCompact ? "text-sm" : "font-medium")}>{project.name}</span>
                                <span
                                    className="text-[11px] leading-tight"
                                    style={{ color: currentTheme.styles.contentTertiary }}
                                >
                                    {description}
                                </span>
                            </span>
                        </button>

                        <div className="flex items-center gap-2">
                            {(onRenameProject || onDeleteProject) && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {onRenameProject && (
                                        <button
                                            onClick={(e) => onRenameProject(project, e)}
                                            className="p-1.5 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
                                            title="Rename project"
                                            style={{ color: currentTheme.styles.contentSecondary }}
                                        >
                                            <Pencil size={14} />
                                        </button>
                                    )}
                                    {onDeleteProject && (
                                        <button
                                            onClick={(e) => onDeleteProject(project, e)}
                                            className="p-1.5 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
                                            title="Delete project"
                                            style={{ color: currentTheme.styles.semanticDestructive }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className={cn("flex items-center text-xs", isCompact ? "gap-2.5" : "gap-3 ml-2")}>
                                {showTotalCount && (
                                    <span
                                        className="tabular-nums px-2.5 py-1 rounded-md"
                                        style={{ color: currentTheme.styles.contentSecondary }}
                                        title="Total tasks"
                                    >
                                        {totalCount || "—"}
                                    </span>
                                )}
                                {showNotesCount && (project.notesCount ?? 0) > 0 && (
                                    <span
                                        className="flex items-center gap-1"
                                        style={{ color: currentTheme.styles.contentTertiary }}
                                        title="Notes"
                                    >
                                        <FileText size={12} />
                                        {project.notesCount}
                                    </span>
                                )}
                                {project.inProgressCount > 0 && (
                                    <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
                                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary, color: currentTheme.styles.contentAccent }}
                                        title="In progress"
                                    >
                                        <Clock size={12} />
                                        <span className="text-[11px]">In progress</span>
                                        <span className="tabular-nums">{project.inProgressCount}</span>
                                    </span>
                                )}
                                {project.todoCount > 0 && (
                                    <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
                                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary, color: currentTheme.styles.contentSecondary }}
                                        title="To do"
                                    >
                                        <span className="text-[11px]">Todo</span>
                                        <span className="tabular-nums">{project.todoCount}</span>
                                    </span>
                                )}
                                {project.doneCount > 0 && (
                                    <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
                                        style={{ backgroundColor: currentTheme.styles.surfaceSecondary, color: currentTheme.styles.semanticSuccess }}
                                        title="Done"
                                    >
                                        <CheckCircle2 size={12} />
                                        <span className="text-[11px]">Done</span>
                                        <span className="tabular-nums">{project.doneCount}</span>
                                    </span>
                                )}
                                {project.inProgressCount === 0 && project.todoCount === 0 && project.doneCount === 0 && (
                                    <span
                                        className="text-[11px] px-1.5"
                                        style={{ color: currentTheme.styles.contentAccent }}
                                    >
                                        No status
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
