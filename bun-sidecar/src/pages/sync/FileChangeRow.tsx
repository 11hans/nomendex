import { useState } from "react";
import { Eye, Loader2, Minus, Plus, Undo2 } from "lucide-react";
import { InlineDiff } from "./InlineDiff";
import type { FileChange } from "@/lib/git";
import type { GitFileDiffResponse } from "./sync-types";

export function getStatusCode(status: FileChange["status"]): string {
    if (status === "added") return "A";
    if (status === "deleted") return "D";
    if (status === "untracked") return "?";
    return "M";
}

export function getStatusColor(status: FileChange["status"]): string {
    if (status === "added") return "text-success";
    if (status === "deleted") return "text-destructive";
    if (status === "untracked") return "text-primary";
    return "text-warning";
}

interface FileChangeRowProps {
    file: FileChange;
    mode: "staged" | "unstaged";
    onStage?: (path: string) => void;
    onUnstage?: (path: string) => void;
    onDiscard?: (path: string) => void;
    isOpen: boolean;
    onToggleDiff: (path: string) => void;
    fileDiff: GitFileDiffResponse | undefined;
    fileDiffError: string | undefined;
    loadingDiff: boolean;
    actionLoading?: boolean;
}

export function FileChangeRow({
    file,
    mode,
    onStage,
    onUnstage,
    onDiscard,
    isOpen,
    onToggleDiff,
    fileDiff,
    fileDiffError,
    loadingDiff,
    actionLoading,
}: FileChangeRowProps) {
    const [hovered, setHovered] = useState(false);

    const handleStageAction = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (mode === "unstaged" && onStage) {
            onStage(file.path);
        } else if (mode === "staged" && onUnstage) {
            onUnstage(file.path);
        }
    };

    const handleDiscard = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onDiscard) {
            onDiscard(file.path);
        }
    };

    return (
        <div className="rounded-md border border-transparent bg-background/40">
            <button
                type="button"
                onClick={() => onToggleDiff(file.path)}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                className={`w-full flex items-center gap-2 text-xs py-1 px-2 min-w-0 text-left rounded-md hover:bg-muted/60 transition-colors group ${isOpen ? "bg-muted/60" : ""}`}
            >
                <span className={`font-mono w-4 flex-shrink-0 ${getStatusColor(file.status)}`}>
                    {getStatusCode(file.status)}
                </span>
                <span className="font-mono text-muted-foreground truncate min-w-0 flex-1">
                    {file.path}
                </span>
                <span className="flex items-center gap-0.5 flex-shrink-0">
                    {(hovered || isOpen) && (
                        <>
                            {onDiscard && (
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    onClick={handleDiscard}
                                    className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
                                    title="Discard changes"
                                >
                                    <Undo2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                                </span>
                            )}
                            <span
                                role="button"
                                tabIndex={-1}
                                onClick={handleStageAction}
                                className="p-0.5 rounded hover:bg-muted transition-colors"
                                title={mode === "unstaged" ? "Stage" : "Unstage"}
                            >
                                {actionLoading ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                ) : mode === "unstaged" ? (
                                    <Plus className="h-3 w-3 text-muted-foreground" />
                                ) : (
                                    <Minus className="h-3 w-3 text-muted-foreground" />
                                )}
                            </span>
                        </>
                    )}
                    <Eye className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
            </button>

            {isOpen && (
                <div className="px-2 pb-2">
                    <InlineDiff
                        fileDiff={fileDiff}
                        loading={loadingDiff}
                        error={fileDiffError}
                        fileKey={file.path}
                    />
                </div>
            )}
        </div>
    );
}
