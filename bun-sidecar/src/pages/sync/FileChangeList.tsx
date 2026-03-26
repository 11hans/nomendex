import { useState, useEffect, useCallback } from "react";
import { ChevronDown, Plus, Minus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileChangeRow } from "./FileChangeRow";
import type { FileChange } from "@/lib/git";
import type { GitFileDiffResponse } from "./sync-types";

const MAX_VISIBLE_FILES = 8;

interface FileChangeListProps {
    title: string;
    files: FileChange[];
    mode: "staged" | "unstaged";
    onStageFile?: (path: string) => void;
    onUnstageFile?: (path: string) => void;
    onDiscardFile?: (path: string) => void;
    onStageAll?: () => void;
    onUnstageAll?: () => void;
    actionLoadingPaths?: Set<string>;
}

export function FileChangeList({
    title,
    files,
    mode,
    onStageFile,
    onUnstageFile,
    onDiscardFile,
    onStageAll,
    onUnstageAll,
    actionLoadingPaths,
}: FileChangeListProps) {
    const [expanded, setExpanded] = useState(false);
    const [openFilePath, setOpenFilePath] = useState<string | null>(null);
    const [loadingDiffPath, setLoadingDiffPath] = useState<string | null>(null);
    const [fileDiffs, setFileDiffs] = useState<Record<string, GitFileDiffResponse>>({});
    const [fileDiffErrors, setFileDiffErrors] = useState<Record<string, string>>({});

    // Close diff if file disappears from list
    useEffect(() => {
        if (openFilePath && !files.some((f) => f.path === openFilePath)) {
            setOpenFilePath(null);
        }
    }, [files, openFilePath]);

    const toggleDiff = useCallback(async (filePath: string) => {
        if (openFilePath === filePath) {
            setOpenFilePath(null);
            return;
        }

        setOpenFilePath(filePath);
        if (fileDiffs[filePath]) return;

        setLoadingDiffPath(filePath);
        setFileDiffErrors((prev) => {
            if (!prev[filePath]) return prev;
            const next = { ...prev };
            delete next[filePath];
            return next;
        });

        try {
            const response = await fetch(`/api/git/file-diff?path=${encodeURIComponent(filePath)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Failed to load diff");
            }

            setFileDiffs((prev) => ({ ...prev, [filePath]: data as GitFileDiffResponse }));
        } catch (error) {
            setFileDiffErrors((prev) => ({
                ...prev,
                [filePath]: error instanceof Error ? error.message : "Failed to load diff",
            }));
        } finally {
            setLoadingDiffPath((current) => (current === filePath ? null : current));
        }
    }, [openFilePath, fileDiffs]);

    if (files.length === 0) return null;

    const hasMore = files.length > MAX_VISIBLE_FILES;
    const visibleFiles = expanded ? files : files.slice(0, MAX_VISIBLE_FILES);
    const hiddenCount = files.length - MAX_VISIBLE_FILES;

    return (
        <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full py-1.5">
                <ChevronDown className="h-3 w-3 transition-transform data-[state=open]:rotate-0 rotate-[-90deg]" />
                <span>{title}</span>
                <span className="text-[10px] font-normal">({files.length})</span>
                <span className="ml-auto flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {mode === "unstaged" && onStageAll && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onStageAll(); }}
                            className="p-1 rounded hover:bg-muted transition-colors"
                            title="Stage all"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {mode === "staged" && onUnstageAll && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onUnstageAll(); }}
                            className="p-1 rounded hover:bg-muted transition-colors"
                            title="Unstage all"
                        >
                            <Minus className="h-3.5 w-3.5" />
                        </button>
                    )}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="rounded-md border bg-muted/30 p-1.5 space-y-0.5">
                    {visibleFiles.map((file) => (
                        <FileChangeRow
                            key={file.path}
                            file={file}
                            mode={mode}
                            onStage={onStageFile}
                            onUnstage={onUnstageFile}
                            onDiscard={onDiscardFile}
                            isOpen={openFilePath === file.path}
                            onToggleDiff={toggleDiff}
                            fileDiff={fileDiffs[file.path]}
                            fileDiffError={fileDiffErrors[file.path]}
                            loadingDiff={loadingDiffPath === file.path}
                            actionLoading={actionLoadingPaths?.has(file.path)}
                        />
                    ))}
                    {hasMore && !expanded && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                            className="text-xs text-muted-foreground hover:text-foreground py-1 px-1 w-full text-left"
                        >
                            +{hiddenCount} more file{hiddenCount !== 1 ? "s" : ""}...
                        </button>
                    )}
                    {hasMore && expanded && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                            className="text-xs text-muted-foreground hover:text-foreground py-1 px-1 w-full text-left"
                        >
                            Show less
                        </button>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
