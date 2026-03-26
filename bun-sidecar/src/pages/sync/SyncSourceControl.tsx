import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useGHSync } from "@/contexts/GHSyncContext";
import { chatPluginSerial } from "@/features/chat";
import { useTheme } from "@/hooks/useTheme";
import {
    GitBranch,
    CheckCircle2,
    XCircle,
    Loader2,
    RefreshCw,
} from "lucide-react";
import type { ConflictFile, ConflictsResponse, DetailedGitStatus } from "./sync-types";
import { CommitBox } from "./CommitBox";
import { FileChangeList } from "./FileChangeList";
import { MergeConflictBanner } from "./MergeConflictBanner";
import { RecentCommits } from "./RecentCommits";
import { SyncSettings } from "./SyncSettings";

export function SyncSourceControl() {
    const navigate = useNavigate();
    const { addNewTab, setActiveTabId, autoSync, setAutoSyncConfig } = useWorkspaceContext();
    const { status: syncStatus, setupStatus, checkForChanges, sync, clearMergeConflict, gitAuthMode, setGitAuthMode } = useGHSync();
    const { currentTheme } = useTheme();

    const [detailedStatus, setDetailedStatus] = useState<DetailedGitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [operating, setOperating] = useState(false);
    const [operationMessage, setOperationMessage] = useState("");
    const [operationError, setOperationError] = useState("");
    const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
    const [committing, setCommitting] = useState(false);
    const [actionLoadingPaths, setActionLoadingPaths] = useState<Set<string>>(new Set());

    const hasMergeConflict = detailedStatus?.hasMergeConflict || syncStatus.hasMergeConflict;

    useEffect(() => {
        checkForChanges();
    }, [checkForChanges]);

    const loadDetailedStatus = useCallback(async (background = false) => {
        try {
            if (!background) setLoading(true);
            const response = await fetch("/api/git/status-detailed");
            if (response.ok) {
                const data: DetailedGitStatus = await response.json();
                setDetailedStatus(data);

                if (!data.hasMergeConflict && syncStatus.hasMergeConflict) {
                    clearMergeConflict();
                }
            }
        } catch (error) {
            console.error("Failed to load detailed status:", error);
        } finally {
            if (!background) setLoading(false);
        }
    }, [syncStatus.hasMergeConflict, clearMergeConflict]);

    const loadConflicts = useCallback(async () => {
        try {
            const response = await fetch("/api/git/conflicts");
            if (response.ok) {
                const data: ConflictsResponse = await response.json();
                setConflicts(data.conflictFiles);
                if (!data.hasMergeConflict && syncStatus.hasMergeConflict) {
                    clearMergeConflict();
                }
            }
        } catch (error) {
            console.error("Failed to load conflicts:", error);
        }
    }, [syncStatus.hasMergeConflict, clearMergeConflict]);

    // Initial load
    useEffect(() => {
        loadDetailedStatus();
    }, [loadDetailedStatus]);

    // Poll status every 3s
    useEffect(() => {
        const interval = setInterval(() => {
            if (document.visibilityState !== "visible") return;
            void loadDetailedStatus(true);
        }, 3000);
        return () => clearInterval(interval);
    }, [loadDetailedStatus]);

    // Load conflicts when merge conflict detected
    useEffect(() => {
        if (hasMergeConflict) {
            loadConflicts();
            const interval = setInterval(loadConflicts, 2000);
            return () => clearInterval(interval);
        } else {
            setConflicts([]);
        }
    }, [hasMergeConflict, loadConflicts]);

    // Actions
    const handleSync = async () => {
        await sync();
        await loadDetailedStatus();
        await loadConflicts();
    };

    const handleStageFile = async (path: string) => {
        setActionLoadingPaths((prev) => new Set(prev).add(path));
        try {
            await fetch("/api/git/stage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files: [path] }),
            });
            await loadDetailedStatus(true);
        } finally {
            setActionLoadingPaths((prev) => {
                const next = new Set(prev);
                next.delete(path);
                return next;
            });
        }
    };

    const handleUnstageFile = async (path: string) => {
        setActionLoadingPaths((prev) => new Set(prev).add(path));
        try {
            await fetch("/api/git/unstage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files: [path] }),
            });
            await loadDetailedStatus(true);
        } finally {
            setActionLoadingPaths((prev) => {
                const next = new Set(prev);
                next.delete(path);
                return next;
            });
        }
    };

    const handleStageAll = async () => {
        await fetch("/api/git/stage-all", { method: "POST" });
        await loadDetailedStatus(true);
    };

    const handleUnstageAll = async () => {
        await fetch("/api/git/unstage-all", { method: "POST" });
        await loadDetailedStatus(true);
    };

    const handleDiscardFile = async (path: string) => {
        setActionLoadingPaths((prev) => new Set(prev).add(path));
        try {
            await fetch("/api/git/discard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files: [path] }),
            });
            await loadDetailedStatus(true);
        } finally {
            setActionLoadingPaths((prev) => {
                const next = new Set(prev);
                next.delete(path);
                return next;
            });
        }
    };

    const handleCommit = async (message: string) => {
        setCommitting(true);
        try {
            const response = await fetch("/api/git/commit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            });
            const data = await response.json();
            if (data.success) {
                setOperationMessage("Changes committed");
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                setOperationError(data.error || "Commit failed");
            }
            await loadDetailedStatus(true);
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Commit failed");
        } finally {
            setCommitting(false);
        }
    };

    const resolveConflict = async (filePath: string, resolution: "ours" | "theirs") => {
        setOperationError("");
        const response = await fetch("/api/git/resolve-conflict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath, resolution }),
        });
        if (response.ok) {
            setOperationMessage(`Resolved ${filePath}`);
            await loadConflicts();
            await loadDetailedStatus(true);
            setTimeout(() => setOperationMessage(""), 3000);
        } else {
            const data = await response.json();
            setOperationError(data.error || "Failed to resolve");
        }
    };

    const markAsResolved = async (filePath: string) => {
        setOperationError("");
        const response = await fetch("/api/git/resolve-conflict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath, resolution: "mark-resolved" }),
        });
        if (response.ok) {
            setOperationMessage(`Marked ${filePath} as resolved`);
            await loadConflicts();
            await loadDetailedStatus(true);
            setTimeout(() => setOperationMessage(""), 3000);
        } else {
            const data = await response.json();
            setOperationError(data.error || "Failed to mark as resolved");
        }
    };

    const abortMerge = async () => {
        setOperating(true);
        setOperationError("");
        try {
            const response = await fetch("/api/git/abort-merge", { method: "POST" });
            if (response.ok) {
                setOperationMessage("Merge aborted");
                setConflicts([]);
                clearMergeConflict();
                await loadDetailedStatus(true);
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to abort merge");
            }
        } finally {
            setOperating(false);
        }
    };

    const continueMerge = async () => {
        setOperating(true);
        setOperationError("");
        try {
            const response = await fetch("/api/git/continue-merge", { method: "POST" });
            if (response.ok) {
                setOperationMessage("Merge completed");
                setConflicts([]);
                clearMergeConflict();
                await loadDetailedStatus(true);
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to complete merge");
            }
        } finally {
            setOperating(false);
        }
    };

    const solveWithAgent = async (filePath: string) => {
        try {
            const response = await fetch(`/api/git/conflict-content?path=${encodeURIComponent(filePath)}`);
            if (!response.ok) {
                setOperationError("Failed to load conflict content");
                return;
            }
            const content = await response.json();
            const prompt = `I have a merge conflict in the file "${filePath}" that I need help resolving.\n\n## Our Version (Local)\n\`\`\`\n${content.oursContent}\n\`\`\`\n\n## Their Version (Remote)\n\`\`\`\n${content.theirsContent}\n\`\`\`\n\nPlease analyze both versions and create a merged version that combines the important changes from both. Explain what changes you're keeping and why. Then provide the final merged content that I should use.\n\nAfter you provide the merged content, I will manually update the file and mark the conflict as resolved.`;

            const newTab = await addNewTab({
                pluginMeta: chatPluginSerial,
                view: "chat",
                props: { initialPrompt: prompt },
            });

            if (newTab) {
                setActiveTabId(newTab.id);
                navigate("/");
            }
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Failed to open agent");
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const stagedFiles = detailedStatus?.stagedFiles ?? [];
    const unstagedFiles = detailedStatus?.unstagedFiles ?? [];
    const totalChanges = stagedFiles.length + unstagedFiles.length;

    return (
        <div
            className="h-full min-h-0 overflow-y-auto [&_.text-sm]:text-xs [&_.text-base]:text-xs [&_.text-xs]:text-xs"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}
        >
            <div className="mx-auto w-full max-w-[780px] px-3 pt-3 pb-6 space-y-3">
                {/* Status Bar */}
                <div className="flex items-center gap-2 flex-wrap">
                    <GitBranch className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                    <span className="text-xs font-medium uppercase tracking-[0.14em]">Source Control</span>

                    {detailedStatus?.currentBranch && (
                        <span className="font-mono text-xs text-muted-foreground">
                            {detailedStatus.currentBranch}
                        </span>
                    )}

                    {totalChanges > 0 ? (
                        <Badge variant="outline" className="gap-1 font-normal text-[10px] h-5">
                            {totalChanges} change{totalChanges !== 1 ? "s" : ""}
                        </Badge>
                    ) : (
                        <Badge variant="secondary" className="gap-1 font-normal text-[10px] h-5">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Clean
                        </Badge>
                    )}

                    {(syncStatus.behindCount > 0 || syncStatus.aheadCount > 0) && (
                        <span className="text-[10px] text-muted-foreground">
                            {syncStatus.behindCount > 0 && `${syncStatus.behindCount} incoming`}
                            {syncStatus.behindCount > 0 && syncStatus.aheadCount > 0 && " · "}
                            {syncStatus.aheadCount > 0 && `${syncStatus.aheadCount} outgoing`}
                        </span>
                    )}

                    <div className="ml-auto flex items-center gap-1">
                        {!hasMergeConflict && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                onClick={handleSync}
                                disabled={operating || syncStatus.syncing}
                            >
                                {syncStatus.syncing || syncStatus.checking ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <>
                                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                                        Sync
                                        {syncStatus.behindCount > 0 && (
                                            <Badge variant="secondary" className="ml-1 text-[9px] h-4 px-1">
                                                {syncStatus.behindCount}
                                            </Badge>
                                        )}
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>

                {/* Status Messages */}
                {(operationMessage || operationError) && (
                    <div className={`px-3 py-2 text-sm flex items-center gap-2 rounded-md ${
                        operationError
                            ? "bg-destructive/10 text-destructive border border-destructive/20"
                            : "bg-success/10 text-success border border-success/20"
                    }`}>
                        {operationError ? (
                            <XCircle className="h-4 w-4 flex-shrink-0" />
                        ) : (
                            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span>{operationError || operationMessage}</span>
                    </div>
                )}

                {/* Sync Error */}
                {syncStatus.error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                        <div className="flex items-start gap-2">
                            <XCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-xs text-destructive mb-0.5">Sync Failed</div>
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                                    {syncStatus.error}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Merge Conflicts */}
                {hasMergeConflict && (
                    <MergeConflictBanner
                        conflicts={conflicts}
                        operating={operating}
                        onResolveConflict={resolveConflict}
                        onMarkResolved={markAsResolved}
                        onAbortMerge={abortMerge}
                        onContinueMerge={continueMerge}
                        onSolveWithAgent={solveWithAgent}
                    />
                )}

                {/* Commit Box */}
                {!hasMergeConflict && (
                    <CommitBox
                        stagedCount={stagedFiles.length}
                        onCommit={handleCommit}
                        committing={committing}
                    />
                )}

                {/* Staged Changes */}
                <FileChangeList
                    title="Staged Changes"
                    files={stagedFiles}
                    mode="staged"
                    onUnstageFile={(p) => void handleUnstageFile(p)}
                    onUnstageAll={() => void handleUnstageAll()}
                    actionLoadingPaths={actionLoadingPaths}
                />

                {/* Unstaged Changes */}
                <FileChangeList
                    title="Changes"
                    files={unstagedFiles}
                    mode="unstaged"
                    onStageFile={(p) => void handleStageFile(p)}
                    onDiscardFile={(p) => void handleDiscardFile(p)}
                    onStageAll={() => void handleStageAll()}
                    actionLoadingPaths={actionLoadingPaths}
                />

                {/* Recent Commits */}
                <RecentCommits commits={detailedStatus?.recentCommits ?? []} />

                {/* Settings */}
                <SyncSettings
                    autoSync={autoSync}
                    setAutoSyncConfig={setAutoSyncConfig}
                    gitAuthMode={gitAuthMode}
                    setGitAuthMode={setGitAuthMode}
                    lastSynced={syncStatus.lastSynced}
                    hasPAT={setupStatus.hasPAT}
                />
            </div>
        </div>
    );
}
