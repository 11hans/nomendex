import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    GitMerge,
    AlertCircle,
    Check,
    X,
    Loader2,
    ArrowLeft,
    ArrowRight,
    Bot,
    Eye,
} from "lucide-react";
import type { ConflictFile } from "./sync-types";

interface MergeConflictBannerProps {
    conflicts: ConflictFile[];
    operating: boolean;
    onResolveConflict: (path: string, resolution: "ours" | "theirs") => Promise<void>;
    onMarkResolved: (path: string) => Promise<void>;
    onAbortMerge: () => Promise<void>;
    onContinueMerge: () => Promise<void>;
    onSolveWithAgent: (path: string) => Promise<void>;
}

export function MergeConflictBanner({
    conflicts,
    operating,
    onResolveConflict,
    onMarkResolved,
    onAbortMerge,
    onContinueMerge,
    onSolveWithAgent,
}: MergeConflictBannerProps) {
    const navigate = useNavigate();
    const [resolvingFile, setResolvingFile] = useState<string | null>(null);

    const unresolvedCount = conflicts.filter((f) => !f.resolved).length;

    const handleResolve = async (path: string, resolution: "ours" | "theirs") => {
        setResolvingFile(path);
        try {
            await onResolveConflict(path, resolution);
        } finally {
            setResolvingFile(null);
        }
    };

    const handleMarkResolved = async (path: string) => {
        setResolvingFile(path);
        try {
            await onMarkResolved(path);
        } finally {
            setResolvingFile(null);
        }
    };

    return (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-4 space-y-4">
            <div className="flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-warning" />
                <span className="font-medium text-sm">Merge Conflicts</span>
                <Badge
                    variant="outline"
                    className={`ml-auto ${unresolvedCount === 0 ? "border-success/30 text-success" : "border-warning/30 text-warning"}`}
                >
                    {unresolvedCount === 0
                        ? "All resolved"
                        : `${unresolvedCount} of ${conflicts.length} unresolved`}
                </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
                Resolve each conflict by choosing which version to keep, then complete the merge.
            </p>

            <div className="space-y-2">
                {conflicts.map((file) => (
                    <div
                        key={file.path}
                        className={`rounded-md bg-background border overflow-hidden ${file.resolved ? "border-success/30" : ""}`}
                    >
                        <button
                            onClick={() => navigate(`/sync/resolve?path=${encodeURIComponent(file.path)}`)}
                            className="flex items-center gap-2 p-3 w-full text-left hover:bg-muted/50 transition-colors"
                        >
                            {file.resolved ? (
                                <Check className="h-3.5 w-3.5 text-success flex-shrink-0" />
                            ) : (
                                <AlertCircle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                            )}
                            <span className="font-mono text-xs truncate flex-1 min-w-0">
                                {file.path}
                            </span>
                            <span className={`text-caption flex-shrink-0 ${file.resolved ? "text-success font-medium" : "text-muted-foreground"}`}>
                                {file.resolved
                                    ? "Resolved"
                                    : file.status === "both_modified"
                                        ? "Both modified"
                                        : file.status === "deleted_by_us"
                                            ? "Deleted locally"
                                            : file.status === "deleted_by_them"
                                                ? "Deleted remotely"
                                                : "Both added"}
                            </span>
                            <Eye className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        </button>
                        <div className="flex gap-1 px-3 pb-2 pt-0">
                            {file.resolved ? (
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="h-6 px-2 text-xs ml-auto"
                                    onClick={() => void handleMarkResolved(file.path)}
                                    disabled={resolvingFile === file.path || operating}
                                >
                                    {resolvingFile === file.path ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <>
                                            <Check className="h-3 w-3 mr-1" />
                                            Mark as Resolved
                                        </>
                                    )}
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs mr-auto"
                                        onClick={() => void onSolveWithAgent(file.path)}
                                        disabled={operating}
                                    >
                                        <Bot className="h-3 w-3 mr-1" />
                                        Solve with Agent
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => void handleResolve(file.path, "ours")}
                                        disabled={resolvingFile === file.path || operating}
                                    >
                                        {resolvingFile === file.path ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <>
                                                <ArrowLeft className="h-3 w-3 mr-1" />
                                                Ours
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => void handleResolve(file.path, "theirs")}
                                        disabled={resolvingFile === file.path || operating}
                                    >
                                        {resolvingFile === file.path ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <>
                                                Theirs
                                                <ArrowRight className="h-3 w-3 ml-1" />
                                            </>
                                        )}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-warning/20">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onAbortMerge()}
                    disabled={operating}
                    className="flex-1"
                >
                    {operating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <>
                            <X className="h-4 w-4 mr-2" />
                            Abort Merge
                        </>
                    )}
                </Button>
                <Button
                    size="sm"
                    onClick={() => void onContinueMerge()}
                    disabled={operating || conflicts.some((f) => !f.resolved)}
                    className="flex-1"
                >
                    {operating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <>
                            <Check className="h-4 w-4 mr-2" />
                            Complete Merge
                        </>
                    )}
                </Button>
            </div>

            {conflicts.some((f) => !f.resolved) ? (
                <p className="text-caption text-muted-foreground text-center">
                    Resolve all conflicts before completing the merge
                </p>
            ) : conflicts.length > 0 ? (
                <p className="text-caption text-success text-center">
                    All conflicts resolved! Click "Mark as Resolved" on each file, then complete the merge.
                </p>
            ) : null}
        </div>
    );
}
