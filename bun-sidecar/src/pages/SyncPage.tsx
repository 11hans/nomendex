import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useGHSync } from "@/contexts/GHSyncContext";
import { chatPluginSerial } from "@/features/chat";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTheme } from "@/hooks/useTheme";
import { diffLines } from "diff";
import {
    GitBranch,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
    ChevronDown,
    Link2,
    History,
    FolderGit2,
    FileText,
    RefreshCw,
    GitMerge,
    ArrowLeft,
    ArrowRight,
    Check,
    X,
    Eye,
    Bot,
    Key,
    ExternalLink
} from "lucide-react";

interface CommitInfo {
    hash: string;
    message: string;
    author: string;
    date: string;
}

interface GitStatus {
    success: boolean;
    initialized: boolean;
    hasRemote: boolean;
    remoteUrl?: string;
    currentBranch?: string;
    remoteBranch?: string;
    status?: string;
    changedFileEntries?: ChangedFileEntry[];
    changedFiles?: number;
    hasUncommittedChanges?: boolean;
    hasMergeConflict?: boolean;
    conflictCount?: number;
    recentCommits?: CommitInfo[];
    error?: string;
}

interface ConflictFile {
    path: string;
    status: "both_modified" | "deleted_by_us" | "deleted_by_them" | "both_added";
    resolved: boolean;
}

interface ConflictsResponse {
    success: boolean;
    hasMergeConflict: boolean;
    conflictFiles: ConflictFile[];
    error?: string;
}

interface LoadGitStatusOptions {
    background?: boolean;
}

interface ChangedFileEntry {
    path: string;
    status: "added" | "modified" | "deleted" | "untracked";
}

interface GitFileDiffResponse {
    success: boolean;
    filePath: string;
    status: ChangedFileEntry["status"] | "unchanged";
    baseContent: string;
    currentContent: string;
    baseExists: boolean;
    currentExists: boolean;
    isBinary: boolean;
    truncated: boolean;
    error?: string;
}

interface DiffPreviewLine {
    kind: "context" | "added" | "removed" | "separator";
    oldLine: number | null;
    newLine: number | null;
    text: string;
}

const MAX_VISIBLE_FILES = 8;
const MAX_DIFF_PREVIEW_LINES = 140;

function parseChangedFileEntries(status: string): ChangedFileEntry[] {
    return status
        .trim()
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .map((line) => {
            const code = line.slice(0, 1);
            const path = line.slice(3).trim();
            const statusFromCode: ChangedFileEntry["status"] =
                code === "A" ? "added" :
                    code === "D" ? "deleted" :
                        code === "?" ? "untracked" :
                            "modified";
            return { path, status: statusFromCode };
        })
        .filter((entry) => entry.path.length > 0);
}

function getStatusCode(status: ChangedFileEntry["status"]): string {
    if (status === "added") return "A";
    if (status === "deleted") return "D";
    if (status === "untracked") return "?";
    return "M";
}

function getStatusColor(status: ChangedFileEntry["status"]): string {
    if (status === "added") return "text-success";
    if (status === "deleted") return "text-destructive";
    if (status === "untracked") return "text-primary";
    return "text-warning";
}

function splitDiffValue(value: string): string[] {
    if (!value) return [];
    const lines = value.split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

function buildUnifiedDiffPreview(baseContent: string, currentContent: string): DiffPreviewLine[] {
    const diffParts = diffLines(baseContent, currentContent);
    const lines: DiffPreviewLine[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (const part of diffParts) {
        const partLines = splitDiffValue(part.value);
        for (const text of partLines) {
            if (part.added) {
                lines.push({ kind: "added", oldLine: null, newLine, text });
                newLine += 1;
                continue;
            }
            if (part.removed) {
                lines.push({ kind: "removed", oldLine, newLine: null, text });
                oldLine += 1;
                continue;
            }
            lines.push({ kind: "context", oldLine, newLine, text });
            oldLine += 1;
            newLine += 1;
        }
    }

    if (lines.length <= MAX_DIFF_PREVIEW_LINES) {
        return lines;
    }

    const headCount = Math.floor(MAX_DIFF_PREVIEW_LINES / 2);
    const tailCount = MAX_DIFF_PREVIEW_LINES - headCount - 1;
    const hiddenCount = lines.length - headCount - tailCount;

    return [
        ...lines.slice(0, headCount),
        {
            kind: "separator",
            oldLine: null,
            newLine: null,
            text: `... ${hiddenCount} lines hidden ...`,
        },
        ...lines.slice(-tailCount),
    ];
}

function ChangedFilesList({ files }: { files: ChangedFileEntry[] }) {
    const [expanded, setExpanded] = useState(false);
    const [openFilePath, setOpenFilePath] = useState<string | null>(null);
    const [loadingDiffPath, setLoadingDiffPath] = useState<string | null>(null);
    const [fileDiffs, setFileDiffs] = useState<Record<string, GitFileDiffResponse>>({});
    const [fileDiffErrors, setFileDiffErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!openFilePath) {
            return;
        }
        if (!files.some((file) => file.path === openFilePath)) {
            setOpenFilePath(null);
        }
    }, [files, openFilePath]);

    const loadFileDiff = async (filePath: string) => {
        if (openFilePath === filePath) {
            setOpenFilePath(null);
            return;
        }

        setOpenFilePath(filePath);
        if (fileDiffs[filePath]) {
            return;
        }

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
                throw new Error(data.error || "Failed to load file diff");
            }

            setFileDiffs((prev) => ({ ...prev, [filePath]: data as GitFileDiffResponse }));
        } catch (error) {
            setFileDiffErrors((prev) => ({
                ...prev,
                [filePath]: error instanceof Error ? error.message : "Failed to load file diff",
            }));
        } finally {
            setLoadingDiffPath((current) => current === filePath ? null : current);
        }
    };

    const hasMore = files.length > MAX_VISIBLE_FILES;
    const visibleFiles = expanded ? files : files.slice(0, MAX_VISIBLE_FILES);
    const hiddenCount = files.length - MAX_VISIBLE_FILES;

    return (
        <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                <FileText className="h-3.5 w-3.5" />
                <span>Changed files</span>
                <span className="text-xs">({files.length})</span>
                <ChevronDown className="h-3.5 w-3.5 ml-auto transition-transform data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="rounded-md border bg-muted/30 p-2 space-y-0.5">
                    {visibleFiles.map((file) => {
                        const isOpen = openFilePath === file.path;
                        const fileDiff = fileDiffs[file.path];
                        const fileDiffError = fileDiffErrors[file.path];
                        const loading = loadingDiffPath === file.path;
                        const diffLinesPreview = fileDiff
                            ? buildUnifiedDiffPreview(fileDiff.baseContent, fileDiff.currentContent)
                            : [];

                        return (
                            <div key={file.path} className="rounded-md border border-transparent bg-background/40">
                                <button
                                    type="button"
                                    onClick={() => void loadFileDiff(file.path)}
                                    className={`w-full flex items-center gap-2 text-xs py-1 px-2 min-w-0 text-left rounded-md hover:bg-muted/60 transition-colors ${isOpen ? "bg-muted/60" : ""}`}
                                >
                                    <span className={`font-mono w-4 flex-shrink-0 ${getStatusColor(file.status)}`}>
                                        {getStatusCode(file.status)}
                                    </span>
                                    <span className="font-mono text-muted-foreground truncate min-w-0 flex-1">
                                        {file.path}
                                    </span>
                                    <Eye className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                </button>

                                {isOpen && (
                                    <div className="px-2 pb-2">
                                        {loading && (
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 px-1">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                Loading file diff...
                                            </div>
                                        )}

                                        {!loading && fileDiffError && (
                                            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
                                                {fileDiffError}
                                            </div>
                                        )}

                                        {!loading && fileDiff && fileDiff.isBinary && (
                                            <div className="rounded-md border border-warning/20 bg-warning/5 p-2 text-xs text-muted-foreground">
                                                Binary file preview is not available. Use external git diff for this file.
                                            </div>
                                        )}

                                        {!loading && fileDiff && !fileDiff.isBinary && (
                                            <div className="rounded-md border bg-background overflow-hidden">
                                                <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/40 text-xs text-muted-foreground">
                                                    <span className="font-medium text-foreground">Diff Preview</span>
                                                    <span className="font-mono">HEAD</span>
                                                    <span>→</span>
                                                    <span className="font-mono">Working tree</span>
                                                    {fileDiff.truncated && (
                                                        <Badge variant="outline" className="ml-auto text-[10px] h-5 px-1.5">
                                                            Preview truncated
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="max-h-64 overflow-auto">
                                                    <table className="w-full border-collapse font-mono text-[11px]">
                                                        <tbody>
                                                            {diffLinesPreview.map((line, index) => {
                                                                if (line.kind === "separator") {
                                                                    return (
                                                                        <tr key={`${file.path}-sep-${index}`} className="bg-muted/20 text-muted-foreground">
                                                                            <td colSpan={3} className="px-2 py-1 text-center">
                                                                                {line.text}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                }

                                                                const isAdded = line.kind === "added";
                                                                const isRemoved = line.kind === "removed";
                                                                const marker = isAdded ? "+" : isRemoved ? "-" : " ";
                                                                const rowClass = isAdded
                                                                    ? "bg-success/10"
                                                                    : isRemoved
                                                                        ? "bg-destructive/10"
                                                                        : "";
                                                                const markerClass = isAdded
                                                                    ? "text-success"
                                                                    : isRemoved
                                                                        ? "text-destructive"
                                                                        : "text-muted-foreground";
                                                                const textClass = isAdded
                                                                    ? "text-success"
                                                                    : isRemoved
                                                                        ? "text-destructive"
                                                                        : "text-foreground";

                                                                return (
                                                                    <tr key={`${file.path}-${index}`} className={rowClass}>
                                                                        <td className="w-10 px-1.5 py-0.5 text-right text-muted-foreground border-r border-border/40">
                                                                            {line.oldLine ?? ""}
                                                                        </td>
                                                                        <td className="w-10 px-1.5 py-0.5 text-right text-muted-foreground border-r border-border/40">
                                                                            {line.newLine ?? ""}
                                                                        </td>
                                                                        <td className={`px-2 py-0.5 whitespace-pre ${textClass}`}>
                                                                            <span className={`mr-1 ${markerClass}`}>{marker}</span>
                                                                            {line.text || " "}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {hasMore && !expanded && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setExpanded(true);
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground py-1 px-1 w-full text-left"
                        >
                            +{hiddenCount} more file{hiddenCount !== 1 ? 's' : ''}...
                        </button>
                    )}
                    {hasMore && expanded && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setExpanded(false);
                            }}
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

function SyncContent() {
    const navigate = useNavigate();
    const { addNewTab, setActiveTabId, autoSync, setAutoSyncConfig } = useWorkspaceContext();
    const { status: syncStatus, setupStatus, needsSetup, checkForChanges, sync, recheckSetup, clearMergeConflict, gitAuthMode, setGitAuthMode } = useGHSync();
    const { currentTheme } = useTheme();
    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [repoUrl, setRepoUrl] = useState("");
    const [branch, setBranch] = useState("main");
    const [operating, setOperating] = useState(false);
    const [operationMessage, setOperationMessage] = useState("");
    const [operationError, setOperationError] = useState("");
    const [historyOpen, setHistoryOpen] = useState(false);
    const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
    const [resolvingFile, setResolvingFile] = useState<string | null>(null);

    // Combine both sources of merge conflict detection
    const hasMergeConflict = gitStatus?.hasMergeConflict || syncStatus.hasMergeConflict;

    // Check for remote changes when page opens
    useEffect(() => {
        checkForChanges();
    }, [checkForChanges]);

    const loadConflicts = useCallback(async () => {
        try {
            const response = await fetch("/api/git/conflicts");
            if (response.ok) {
                const data: ConflictsResponse = await response.json();
                setConflicts(data.conflictFiles);

                // If API says no conflict but context thinks there is, clear the stale state
                if (!data.hasMergeConflict && syncStatus.hasMergeConflict) {
                    clearMergeConflict();
                }
            }
        } catch (error) {
            console.error("Failed to load conflicts:", error);
        }
    }, [syncStatus.hasMergeConflict, clearMergeConflict]);

    const loadGitStatus = useCallback(async (options: LoadGitStatusOptions = {}) => {
        const { background = false } = options;
        try {
            if (!background) {
                setLoading(true);
            }
            const response = await fetch("/api/git/status");
            if (response.ok) {
                const data = await response.json();
                setGitStatus(data);

                // If git status says no conflict but context thinks there is, clear the stale state
                if (!data.hasMergeConflict && syncStatus.hasMergeConflict) {
                    clearMergeConflict();
                }
            }
        } catch (error) {
            console.error("Failed to load git status:", error);
        } finally {
            if (!background) {
                setLoading(false);
            }
        }
    }, [syncStatus.hasMergeConflict, clearMergeConflict]);

    const initializeGit = async () => {
        try {
            setOperating(true);
            setOperationError("");
            setOperationMessage("");
            const response = await fetch("/api/git/init", { method: "POST" });
            if (response.ok) {
                const data = await response.json();
                setOperationMessage(data.message || "Git initialized");
                await new Promise(resolve => setTimeout(resolve, 100));
                await loadGitStatus();
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to initialize");
            }
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Failed to initialize");
        } finally {
            setOperating(false);
        }
    };

    const setupRemote = async () => {
        if (!repoUrl.trim()) {
            setOperationError("Repository URL required");
            return;
        }
        try {
            setOperating(true);
            setOperationError("");
            setOperationMessage("");
            const response = await fetch("/api/git/setup-remote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repoUrl: repoUrl.trim(), branch: branch.trim() }),
            });
            if (response.ok) {
                const data = await response.json();
                setOperationMessage(data.message || "Connected");
                await loadGitStatus();
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to connect");
            }
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Failed to connect");
        } finally {
            setOperating(false);
        }
    };

    const handleSync = async () => {
        await sync();
        await loadGitStatus();
        await loadConflicts();
    };

    const resolveConflict = async (filePath: string, resolution: "ours" | "theirs") => {
        try {
            setResolvingFile(filePath);
            setOperationError("");
            const response = await fetch("/api/git/resolve-conflict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filePath, resolution }),
            });
            if (response.ok) {
                setOperationMessage(`Resolved ${filePath} with ${resolution === "ours" ? "local" : "remote"} version`);
                await loadConflicts();
                await loadGitStatus();
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to resolve conflict");
            }
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Failed to resolve conflict");
        } finally {
            setResolvingFile(null);
        }
    };

    const markAsResolved = async (filePath: string) => {
        try {
            setResolvingFile(filePath);
            setOperationError("");
            const response = await fetch("/api/git/resolve-conflict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filePath, resolution: "mark-resolved" }),
            });
            if (response.ok) {
                setOperationMessage(`Marked ${filePath} as resolved`);
                await loadConflicts();
                await loadGitStatus();
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to mark as resolved");
            }
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Failed to mark as resolved");
        } finally {
            setResolvingFile(null);
        }
    };

    const abortMerge = async () => {
        try {
            setOperating(true);
            setOperationError("");
            const response = await fetch("/api/git/abort-merge", { method: "POST" });
            if (response.ok) {
                setOperationMessage("Merge aborted");
                setConflicts([]);
                clearMergeConflict();
                await loadGitStatus();
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to abort merge");
            }
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Failed to abort merge");
        } finally {
            setOperating(false);
        }
    };

    const continueMerge = async () => {
        try {
            setOperating(true);
            setOperationError("");
            const response = await fetch("/api/git/continue-merge", { method: "POST" });
            if (response.ok) {
                setOperationMessage("Merge completed successfully");
                setConflicts([]);
                clearMergeConflict();
                await loadGitStatus();
                setTimeout(() => setOperationMessage(""), 3000);
            } else {
                const data = await response.json();
                setOperationError(data.error || "Failed to complete merge");
            }
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : "Failed to complete merge");
        } finally {
            setOperating(false);
        }
    };

    const solveWithAgent = async (filePath: string) => {
        try {
            // Fetch the conflict content
            const response = await fetch(`/api/git/conflict-content?path=${encodeURIComponent(filePath)}`);
            if (!response.ok) {
                setOperationError("Failed to load conflict content");
                return;
            }

            const content = await response.json();

            const prompt = `I have a merge conflict in the file "${filePath}" that I need help resolving.

## Our Version (Local)
\`\`\`
${content.oursContent}
\`\`\`

## Their Version (Remote)
\`\`\`
${content.theirsContent}
\`\`\`

Please analyze both versions and create a merged version that combines the important changes from both. Explain what changes you're keeping and why. Then provide the final merged content that I should use.

After you provide the merged content, I will manually update the file and mark the conflict as resolved.`;

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

    useEffect(() => {
        loadGitStatus();
    }, [loadGitStatus]);

    // Keep changed files in sync while this page is open (IDE-like live updates)
    useEffect(() => {
        const interval = setInterval(() => {
            if (document.visibilityState !== "visible") {
                return;
            }
            void loadGitStatus({ background: true });
        }, 3000);
        return () => clearInterval(interval);
    }, [loadGitStatus]);

    // Load conflicts when we detect a merge conflict, and poll for changes
    useEffect(() => {
        if (hasMergeConflict) {
            loadConflicts();
            // Poll every 2 seconds to detect when files are manually resolved
            const interval = setInterval(loadConflicts, 2000);
            return () => clearInterval(interval);
        } else {
            setConflicts([]);
        }
    }, [hasMergeConflict, loadConflicts]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const isReady = gitStatus?.initialized && gitStatus?.hasRemote;
    const unresolvedConflictCount = conflicts.filter((file) => !file.resolved).length;
    const repositoryState = !gitStatus?.initialized
        ? "Not initialized"
        : gitStatus.hasRemote
            ? "Connected"
            : "Remote missing";
    const pendingChanges = gitStatus?.hasUncommittedChanges ? (gitStatus.changedFiles ?? 0) : 0;
    const autoSyncState = !autoSync.enabled
        ? "Disabled"
        : autoSync.paused
            ? "Paused"
            : autoSync.syncOnChanges
                ? "Changes + interval"
                : "Interval only";
    const changedFileEntries = gitStatus?.changedFileEntries && gitStatus.changedFileEntries.length > 0
        ? gitStatus.changedFileEntries
        : parseChangedFileEntries(gitStatus?.status ?? "");

    return (
        <div
            className="h-full min-h-0 overflow-y-auto [&_.text-sm]:text-xs [&_.text-base]:text-xs [&_.text-xs]:text-xs"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}
        >
            <div className="mx-auto w-full max-w-[780px] px-3 pt-3 pb-6 space-y-2.5">
                <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                    <GitBranch className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                    <span className="text-xs font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentPrimary }}>
                        Sync
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        {repositoryState}
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        {pendingChanges} changed
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        auto {autoSyncState.toLowerCase()}
                    </span>
                    {hasMergeConflict && (
                        <span className="text-caption" style={{ color: currentTheme.styles.semanticDestructive }}>
                            {unresolvedConflictCount} unresolved
                        </span>
                    )}
                    <Button variant="outline" size="sm" className="ml-auto h-7 px-2 text-xs rounded-md" onClick={() => recheckSetup()}>
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                        recheck
                    </Button>
                </div>

                {/* Auth Mode Setting */}
                <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium">Authentication Mode</div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {gitAuthMode === "local"
                                    ? "Using local git credentials (SSH keys or credential helper)"
                                    : "Using GitHub Personal Access Token"}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                            <button
                                onClick={() => setGitAuthMode("local")}
                                className={`px-3 py-1.5 text-xs rounded transition-colors ${gitAuthMode === "local"
                                    ? "bg-background shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                Local
                            </button>
                            <button
                                onClick={() => setGitAuthMode("pat")}
                                className={`px-3 py-1.5 text-xs rounded transition-colors ${gitAuthMode === "pat"
                                    ? "bg-background shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                PAT
                            </button>
                        </div>
                    </div>
                </div>

                {/* Auto-Sync Settings */}
                <div className="border rounded-lg p-4 space-y-4">
                    <div className="text-sm font-medium">Auto-Sync Settings</div>

                    {/* Pause Sync Toggle */}
                    {autoSync.enabled && (
                        <div className={`flex items-center justify-between p-3 rounded-md ${autoSync.paused ? "bg-warning/10 border border-warning/30" : "bg-muted/30"}`}>
                            <div>
                                <div className={`text-sm font-medium ${autoSync.paused ? "text-warning" : ""}`}>
                                    {autoSync.paused ? "Sync Paused" : "Sync Active"}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {autoSync.paused ? "Auto-sync is temporarily paused" : "Pause to prevent automatic syncing"}
                                </p>
                            </div>
                            <Button
                                variant={autoSync.paused ? "default" : "outline"}
                                size="sm"
                                onClick={() => setAutoSyncConfig({ paused: !autoSync.paused })}
                            >
                                {autoSync.paused ? "Resume" : "Pause"}
                            </Button>
                        </div>
                    )}

                    {/* Enable Auto-Sync Toggle */}
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm">Enable Auto-Sync</div>
                            <p className="text-xs text-muted-foreground">
                                Automatically sync on a schedule
                            </p>
                        </div>
                        <button
                            onClick={() => setAutoSyncConfig({ enabled: !autoSync.enabled })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                                autoSync.enabled ? "bg-sky-500" : "bg-muted border border-border"
                            }`}
                            style={
                                autoSync.enabled
                                    ? {
                                        boxShadow: "0 0 0 1px rgba(14, 165, 233, 0.45), 0 0 14px rgba(14, 165, 233, 0.35)",
                                    }
                                    : undefined
                            }
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                                    autoSync.enabled ? "translate-x-6 border" : "translate-x-1 bg-white"
                                }`}
                                style={
                                    autoSync.enabled
                                        ? {
                                            backgroundColor: currentTheme.styles.semanticPrimary,
                                            borderColor: currentTheme.styles.semanticPrimary,
                                        }
                                        : undefined
                                }
                            />
                        </button>
                    </div>

                    {/* Sync on Changes Toggle (only shown when enabled) */}
                    {autoSync.enabled && (
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm">Sync on Changes</div>
                                <p className="text-xs text-muted-foreground">
                                    Automatically sync when files change (5s debounce)
                                </p>
                            </div>
                            <button
                                onClick={() => setAutoSyncConfig({ syncOnChanges: !autoSync.syncOnChanges })}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                                    autoSync.syncOnChanges ? "bg-sky-500" : "bg-muted border border-border"
                                }`}
                                style={
                                    autoSync.syncOnChanges
                                        ? {
                                            boxShadow: "0 0 0 1px rgba(14, 165, 233, 0.45), 0 0 14px rgba(14, 165, 233, 0.35)",
                                        }
                                        : undefined
                                }
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                                        autoSync.syncOnChanges ? "translate-x-6 border" : "translate-x-1 bg-white"
                                    }`}
                                    style={
                                        autoSync.syncOnChanges
                                            ? {
                                                backgroundColor: currentTheme.styles.semanticPrimary,
                                                borderColor: currentTheme.styles.semanticPrimary,
                                            }
                                            : undefined
                                    }
                                />
                            </button>
                        </div>
                    )}

                    {/* Interval Input */}
                    {autoSync.enabled && (
                        <div>
                            <Label className="text-xs text-muted-foreground">Sync Interval (seconds)</Label>
                            <Input
                                type="number"
                                min="10"
                                max="3600"
                                value={autoSync.intervalSeconds}
                                onChange={(e) => {
                                    const value = parseInt(e.target.value);
                                    if (value >= 10 && value <= 3600) {
                                        setAutoSyncConfig({ intervalSeconds: value });
                                    }
                                }}
                                className="font-mono text-sm w-32 mt-1.5"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Range: 10-3600 seconds
                            </p>
                        </div>
                    )}

                    {/* Last Synced Timestamp */}
                    {autoSync.enabled && syncStatus.lastSynced && (
                        <p className="text-xs text-muted-foreground">
                            Last synced: {syncStatus.lastSynced.toLocaleTimeString()}
                        </p>
                    )}
                </div>

                {/* Setup Required Card */}
                {needsSetup && (
                    <div className="border rounded-lg p-5 bg-muted/30">
                        <div className="flex items-center gap-2 mb-4">
                            <AlertCircle className="h-4 w-4 text-warning" />
                            <span className="font-medium text-sm">Setup Required</span>
                        </div>

                        <p className="text-sm text-muted-foreground mb-4">
                            Complete the following steps to enable workspace sync:
                        </p>

                        <div className="space-y-3">
                            {/* Git Installed Status */}
                            <div className="flex items-center gap-3 text-sm">
                                {setupStatus.gitInstalled ? (
                                    <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                                ) : (
                                    <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                )}
                                <span className={setupStatus.gitInstalled ? "text-foreground" : "text-muted-foreground"}>
                                    Git installed
                                </span>
                            </div>

                            {!setupStatus.gitInstalled && (
                                <div className="pl-7 space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        Git is required for workspace sync. Install it to continue:
                                    </p>
                                    <a
                                        href="https://git-scm.com/downloads/mac"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-primary hover:underline flex items-center gap-1"
                                    >
                                        Install Git for macOS
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                            )}

                            {/* Git Repository Status */}
                            {setupStatus.gitInstalled && (
                                <div className="flex items-center gap-3 text-sm">
                                    {setupStatus.gitInitialized && setupStatus.hasRemote ? (
                                        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                                    ) : (
                                        <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    )}
                                    <span className={setupStatus.gitInitialized && setupStatus.hasRemote ? "text-foreground" : "text-muted-foreground"}>
                                        Git repository with remote configured
                                    </span>
                                </div>
                            )}

                            {/* PAT Status - only show if git is installed AND using PAT auth mode */}
                            {setupStatus.gitInstalled && gitAuthMode === "pat" && (
                                <>
                                    <div className="flex items-center gap-3 text-sm">
                                        {setupStatus.hasPAT ? (
                                            <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                                        ) : (
                                            <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        )}
                                        <span className={setupStatus.hasPAT ? "text-foreground" : "text-muted-foreground"}>
                                            GitHub Personal Access Token
                                        </span>
                                    </div>

                                    {!setupStatus.hasPAT && (
                                        <div className="pl-7 space-y-2">
                                            <p className="text-xs text-muted-foreground">
                                                Create a PAT with 'repo' scope to enable sync:
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <a
                                                    href="https://github.com/settings/tokens/new?scopes=repo&description=Nomendex%20Sync"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                                >
                                                    Create token on GitHub
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => navigate("/settings")}
                                                className="mt-2"
                                            >
                                                <Key className="h-3.5 w-3.5 mr-2" />
                                                Add Token in Settings
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="mt-4 pt-4 border-t">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => recheckSetup()}
                                className="text-xs"
                            >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Recheck Setup
                            </Button>
                        </div>
                    </div>
                )}

                {/* Status Toast */}
                {(operationMessage || operationError) && (
                    <div className={`mb-4 px-3 py-2 text-sm flex items-center gap-2 rounded-md ${operationError
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

                {/* Not Initialized State */}
                {!gitStatus?.initialized && (
                    <div className="border border-dashed rounded-lg p-8 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
                            <FolderGit2 className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="font-medium mb-2">Initialize Repository</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Set up git tracking for your workspace
                        </p>
                        <Button onClick={initializeGit} disabled={operating} size="sm">
                            {operating ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Initialize Git"
                            )}
                        </Button>
                    </div>
                )}

                {/* Initialized but No Remote */}
                {gitStatus?.initialized && !gitStatus?.hasRemote && (
                    <div className="border rounded-lg p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <Link2 className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium text-sm">Connect Repository</span>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Repository URL</Label>
                                <Input
                                    placeholder="https://github.com/user/repo"
                                    value={repoUrl}
                                    onChange={(e) => setRepoUrl(e.target.value)}
                                    className="font-mono text-sm"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Branch</Label>
                                <Input
                                    placeholder="main"
                                    value={branch}
                                    onChange={(e) => setBranch(e.target.value)}
                                    className="font-mono text-sm w-32"
                                />
                            </div>

                            <Button
                                onClick={setupRemote}
                                disabled={!repoUrl.trim() || operating}
                                size="sm"
                            >
                                {operating ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    "Connect"
                                )}
                            </Button>
                        </div>

                        <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
                            Uses local git credentials (SSH or credential helper)
                        </p>
                    </div>
                )}

                {/* Ready State - Main Sync UI */}
                {isReady && (
                    <div className="space-y-4">
                        {/* Compact Status Bar */}
                        <div className="flex items-center gap-3 flex-wrap">
                            {gitStatus.currentBranch && (
                                <div className="flex items-center gap-1.5 text-sm">
                                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="font-mono">{gitStatus.currentBranch}</span>
                                </div>
                            )}

                            <span className="text-muted-foreground">·</span>

                            {gitStatus.hasUncommittedChanges ? (
                                <Badge variant="outline" className="gap-1 font-normal">
                                    <AlertCircle className="h-3 w-3" />
                                    {gitStatus.changedFiles} change{gitStatus.changedFiles !== 1 ? 's' : ''}
                                </Badge>
                            ) : (
                                <Badge variant="secondary" className="gap-1 font-normal">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Clean
                                </Badge>
                            )}

                            {gitStatus.remoteUrl && (
                                <>
                                    <span className="text-muted-foreground">·</span>
                                    <span className="text-xs text-muted-foreground font-mono">
                                        {gitStatus.remoteUrl}
                                    </span>
                                </>
                            )}
                        </div>

                        {/* Merge Conflict Section */}
                        {hasMergeConflict && (
                            <div className="rounded-md border border-warning/30 bg-warning/5 p-4 space-y-4">
                                <div className="flex items-center gap-2">
                                    <GitMerge className="h-4 w-4 text-warning" />
                                    <span className="font-medium text-sm">Merge Conflicts</span>
                                    <Badge variant="outline" className={`ml-auto ${conflicts.filter(f => !f.resolved).length === 0 ? "border-success/30 text-success" : "border-warning/30 text-warning"}`}>
                                        {conflicts.filter(f => !f.resolved).length === 0
                                            ? "All resolved"
                                            : `${conflicts.filter(f => !f.resolved).length} of ${conflicts.length} unresolved`}
                                    </Badge>
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    Resolve each conflict by choosing which version to keep, then complete the merge.
                                </p>

                                {/* Conflict Files List */}
                                <div className="space-y-2">
                                    {conflicts.map((file) => (
                                        <div
                                            key={file.path}
                                            className={`rounded-md bg-background border overflow-hidden ${file.resolved ? "border-success/30" : ""}`}
                                        >
                                            {/* File info row - clickable to view diff */}
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
                                                    {file.resolved ? "Resolved" :
                                                        file.status === "both_modified" ? "Both modified" :
                                                            file.status === "deleted_by_us" ? "Deleted locally" :
                                                                file.status === "deleted_by_them" ? "Deleted remotely" :
                                                                    "Both added"}
                                                </span>
                                                <Eye className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                            </button>
                                            {/* Quick resolve buttons */}
                                            <div className="flex gap-1 px-3 pb-2 pt-0">
                                                {file.resolved ? (
                                                    <Button
                                                        variant="default"
                                                        size="sm"
                                                        className="h-6 px-2 text-xs ml-auto"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            markAsResolved(file.path);
                                                        }}
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
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                solveWithAgent(file.path);
                                                            }}
                                                            disabled={operating}
                                                        >
                                                            <Bot className="h-3 w-3 mr-1" />
                                                            Solve with Agent
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-6 px-2 text-xs"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                resolveConflict(file.path, "ours");
                                                            }}
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
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                resolveConflict(file.path, "theirs");
                                                            }}
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

                                {/* Merge Actions */}
                                <div className="flex gap-2 pt-2 border-t border-warning/20">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={abortMerge}
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
                                        onClick={continueMerge}
                                        disabled={operating || conflicts.some(f => !f.resolved)}
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

                                {conflicts.some(f => !f.resolved) ? (
                                    <p className="text-caption text-muted-foreground text-center">
                                        Resolve all conflicts before completing the merge
                                    </p>
                                ) : conflicts.length > 0 ? (
                                    <p className="text-caption text-success text-center">
                                        All conflicts resolved! Click "Mark as Resolved" on each file, then complete the merge.
                                    </p>
                                ) : null}
                            </div>
                        )}

                        {/* Sync Status */}
                        {!hasMergeConflict && (syncStatus.behindCount > 0 || syncStatus.aheadCount > 0) && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                {syncStatus.behindCount > 0 && (
                                    <Badge variant="secondary">
                                        {syncStatus.behindCount} incoming
                                    </Badge>
                                )}
                                {syncStatus.aheadCount > 0 && (
                                    <Badge variant="outline">
                                        {syncStatus.aheadCount} outgoing
                                    </Badge>
                                )}
                                {syncStatus.checking && (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                )}
                            </div>
                        )}

                        {/* Sync Error Display */}
                        {syncStatus.error && (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                                <div className="flex items-start gap-3">
                                    <XCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm text-destructive mb-1">Sync Failed</div>
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                            {syncStatus.error}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Sync Button */}
                        {!hasMergeConflict && (
                            <Button
                                onClick={handleSync}
                                disabled={operating || syncStatus.syncing}
                                className="w-full h-12"
                            >
                                {syncStatus.syncing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Syncing...
                                    </>
                                ) : syncStatus.checking ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Checking...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                        Sync
                                        {syncStatus.behindCount > 0 && (
                                            <Badge variant="secondary" className="ml-2">
                                                {syncStatus.behindCount}
                                            </Badge>
                                        )}
                                    </>
                                )}
                            </Button>
                        )}

                        {/* Working Directory Changes */}
                        {changedFileEntries.length > 0 && (
                            <ChangedFilesList files={changedFileEntries} />
                        )}

                        {/* Recent Commits - Collapsible */}
                        {gitStatus.recentCommits && gitStatus.recentCommits.length > 0 && (
                            <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                                <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                                    <History className="h-3.5 w-3.5" />
                                    <span>Recent commits</span>
                                    <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <div className="space-y-1 pt-1">
                                        {gitStatus.recentCommits.slice(0, 5).map((commit) => (
                                            <div
                                                key={commit.hash}
                                                className="flex items-baseline gap-3 py-1.5 text-xs group"
                                            >
                                                <code className="text-muted-foreground font-mono shrink-0">
                                                    {commit.hash}
                                                </code>
                                                <span className="truncate flex-1">
                                                    {commit.message}
                                                </span>
                                                <span className="text-muted-foreground shrink-0">
                                                    {commit.date}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        )}

                    </div>
                )}
                </div>
        </div>
    );
}

export function SyncPage() {
    return <SyncContent />;
}
