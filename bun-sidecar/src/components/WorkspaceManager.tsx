import { useState, useEffect, useRef, useMemo, useCallback, KeyboardEvent } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { useTheme } from "@/hooks/useTheme";
import { useWorkspaceSwitcher, WorkspaceInfo } from "@/hooks/useWorkspaceSwitcher";
import { useCommandDialog } from "./CommandDialogProvider";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { WorkspaceWarningDialog } from "./WorkspaceWarningDialog";
import {
    Folder,
    FolderOpen,
    Plus,
    Trash2,
    Pencil,
    Check,
    ExternalLink,
    Loader2,
    AlertCircle,
} from "lucide-react";

function fuzzyMatch(text: string, query: string): boolean {
    if (!query) return true;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let qi = 0;
    for (let i = 0; i < lowerText.length && qi < lowerQuery.length; i++) {
        if (lowerText[i] === lowerQuery[qi]) qi++;
    }
    return qi === lowerQuery.length;
}

function formatRelative(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 30) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)} months ago`;
    return `${Math.floor(seconds / 31536000)} years ago`;
}

function formatAbsolute(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

export function WorkspaceManager() {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const { closeDialog } = useCommandDialog();
    const {
        workspaces,
        activeWorkspace,
        loading,
        error,
        switchWorkspace,
        addWorkspace,
        removeWorkspace,
        renameWorkspace,
    } = useWorkspaceSwitcher();

    const isNativeApp = Boolean(
        (window as Window & { webkit?: { messageHandlers?: { chooseDataRoot?: unknown } } })
            .webkit?.messageHandlers?.chooseDataRoot
    );

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState("");
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [folderPickerOpen, setFolderPickerOpen] = useState(false);
    const [warningPath, setWarningPath] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<WorkspaceInfo | null>(null);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const sorted = useMemo(() => {
        return [...workspaces].sort((a, b) => {
            const at = new Date(a.lastAccessedAt).getTime();
            const bt = new Date(b.lastAccessedAt).getTime();
            return bt - at;
        });
    }, [workspaces]);

    const filtered = useMemo(
        () => sorted.filter((ws) => fuzzyMatch(ws.name, searchQuery) || fuzzyMatch(ws.path, searchQuery)),
        [sorted, searchQuery]
    );

    // Default selection: active workspace if visible, else first in list
    useEffect(() => {
        if (selectedId && filtered.some((w) => w.id === selectedId)) return;
        const preferred = filtered.find((w) => w.id === activeWorkspace?.id) ?? filtered[0];
        setSelectedId(preferred?.id ?? null);
    }, [filtered, activeWorkspace?.id, selectedId]);

    const selected = useMemo(
        () => sorted.find((w) => w.id === selectedId) ?? null,
        [sorted, selectedId]
    );

    // Focus search on mount
    useEffect(() => {
        const t = setTimeout(() => searchInputRef.current?.focus(), 0);
        return () => clearTimeout(t);
    }, []);

    // Focus rename input when entering rename mode
    useEffect(() => {
        if (renamingId) {
            const t = setTimeout(() => {
                renameInputRef.current?.focus();
                renameInputRef.current?.select();
            }, 0);
            return () => clearTimeout(t);
        }
    }, [renamingId]);

    // Auto-scroll selected row into view
    useEffect(() => {
        if (!listRef.current || !selectedId) return;
        const el = listRef.current.querySelector(`[data-ws-id="${selectedId}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [selectedId, filtered.length]);

    const handleSwitch = useCallback(
        async (ws: WorkspaceInfo) => {
            if (ws.id === activeWorkspace?.id) return;
            closeDialog();
            await switchWorkspace(ws.id);
        },
        [activeWorkspace?.id, closeDialog, switchWorkspace]
    );

    const startRename = useCallback((ws: WorkspaceInfo) => {
        setRenamingId(ws.id);
        setRenameDraft(ws.name);
    }, []);

    const commitRename = useCallback(async () => {
        if (!renamingId) return;
        const trimmed = renameDraft.trim();
        const ws = workspaces.find((w) => w.id === renamingId);
        if (trimmed && ws && trimmed !== ws.name) {
            await renameWorkspace(renamingId, trimmed);
        }
        setRenamingId(null);
        setRenameDraft("");
    }, [renamingId, renameDraft, workspaces, renameWorkspace]);

    const cancelRename = useCallback(() => {
        setRenamingId(null);
        setRenameDraft("");
    }, []);

    const handleAddWorkspace = useCallback(() => {
        if (isNativeApp) {
            const webkit = window.webkit as
                | { messageHandlers?: { chooseDataRoot?: { postMessage: (data: Record<string, never>) => void } } }
                | undefined;
            webkit?.messageHandlers?.chooseDataRoot?.postMessage({});
        } else {
            setFolderPickerOpen(true);
        }
    }, [isNativeApp]);

    const handleFolderSelect = useCallback((path: string) => {
        setWarningPath(path);
    }, []);

    const handleWarningConfirm = useCallback(async () => {
        if (warningPath) {
            const path = warningPath;
            setWarningPath(null);
            await addWorkspace(path);
        }
    }, [warningPath, addWorkspace]);

    const handleRevealInFinder = useCallback(async (ws: WorkspaceInfo) => {
        await fetch("/api/workspaces/reveal-in-finder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: ws.path }),
        });
    }, []);

    const handleRemoveConfirm = useCallback(async () => {
        if (!confirmRemove) return;
        const id = confirmRemove.id;
        setConfirmRemove(null);
        setRemovingId(id);
        try {
            await removeWorkspace(id);
        } finally {
            setRemovingId(null);
        }
    }, [confirmRemove, removeWorkspace]);

    const moveSelection = useCallback(
        (delta: number) => {
            if (filtered.length === 0) return;
            const idx = filtered.findIndex((w) => w.id === selectedId);
            const next = Math.max(0, Math.min(filtered.length - 1, (idx < 0 ? 0 : idx) + delta));
            setSelectedId(filtered[next].id);
        },
        [filtered, selectedId]
    );

    const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (renamingId) return;
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                moveSelection(1);
                break;
            case "ArrowUp":
                e.preventDefault();
                moveSelection(-1);
                break;
            case "Enter":
                e.preventDefault();
                if (selected) handleSwitch(selected);
                break;
            case "F2":
                e.preventDefault();
                if (selected) startRename(selected);
                break;
            case "Backspace":
            case "Delete":
                if (e.metaKey || e.shiftKey) {
                    e.preventDefault();
                    if (selected) setConfirmRemove(selected);
                }
                break;
        }
    };

    const isActive = (ws: WorkspaceInfo) => ws.id === activeWorkspace?.id;

    return (
        <>
            <div className="flex flex-col h-full">
                {/* Top bar: search + add */}
                <div
                    className="shrink-0 flex items-center gap-2 px-4 py-3 pr-10 border-b"
                    style={{ borderColor: styles.borderDefault }}
                >
                    <Input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search workspaces..."
                        className="h-9 flex-1"
                    />
                    <Button onClick={handleAddWorkspace} size="sm" className="shrink-0">
                        <Plus className="size-4" />
                        Add Workspace
                    </Button>
                </div>

                {/* Error banner */}
                {error && (
                    <div
                        className="shrink-0 flex items-start gap-2 px-4 py-2 text-xs border-b"
                        style={{
                            backgroundColor: styles.semanticDestructive,
                            color: styles.semanticDestructiveForeground,
                            borderColor: styles.borderDefault,
                        }}
                    >
                        <AlertCircle className="size-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Master-detail */}
                <div className="flex-1 flex min-h-0">
                    {/* List */}
                    <div
                        ref={listRef}
                        className="w-1/3 overflow-y-auto border-r"
                        style={{ borderColor: styles.borderDefault }}
                    >
                        {loading ? (
                            <div
                                className="flex items-center justify-center py-8 text-sm"
                                style={{ color: styles.contentSecondary }}
                            >
                                <Loader2 className="size-4 animate-spin mr-2" />
                                Loading…
                            </div>
                        ) : filtered.length === 0 ? (
                            <div
                                className="flex flex-col items-center justify-center py-12 px-4 text-center text-sm"
                                style={{ color: styles.contentSecondary }}
                            >
                                <Folder className="size-10 mb-2 opacity-40" />
                                {workspaces.length === 0 ? (
                                    <>
                                        <p>No workspaces yet</p>
                                        <p className="text-xs mt-1" style={{ color: styles.contentTertiary }}>
                                            Add a workspace to get started
                                        </p>
                                    </>
                                ) : (
                                    <p>No matching workspaces</p>
                                )}
                            </div>
                        ) : (
                            <div className="p-1">
                                {filtered.map((ws) => {
                                    const selectedRow = ws.id === selectedId;
                                    const active = isActive(ws);
                                    const renaming = renamingId === ws.id;
                                    return (
                                        <button
                                            key={ws.id}
                                            data-ws-id={ws.id}
                                            type="button"
                                            onClick={() => setSelectedId(ws.id)}
                                            onDoubleClick={() => {
                                                if (!active) handleSwitch(ws);
                                            }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded transition-colors text-left"
                                            style={{
                                                backgroundColor: selectedRow
                                                    ? styles.surfaceAccent
                                                    : "transparent",
                                                borderLeft: active
                                                    ? `2px solid ${styles.borderAccent ?? styles.contentAccent ?? styles.contentPrimary}`
                                                    : "2px solid transparent",
                                                color: styles.contentPrimary,
                                            }}
                                        >
                                            {active ? (
                                                <FolderOpen
                                                    className="size-4 shrink-0"
                                                    style={{ color: styles.contentPrimary }}
                                                />
                                            ) : (
                                                <Folder
                                                    className="size-4 shrink-0"
                                                    style={{ color: styles.contentSecondary }}
                                                />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                {renaming ? (
                                                    <Input
                                                        ref={renameInputRef}
                                                        value={renameDraft}
                                                        onChange={(e) => setRenameDraft(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") {
                                                                e.preventDefault();
                                                                commitRename();
                                                            } else if (e.key === "Escape") {
                                                                e.preventDefault();
                                                                cancelRename();
                                                            }
                                                            e.stopPropagation();
                                                        }}
                                                        onBlur={commitRename}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="h-6 text-sm py-0 px-1"
                                                    />
                                                ) : (
                                                    <>
                                                        <div className="font-medium truncate flex items-center gap-2">
                                                            <span className="truncate">{ws.name}</span>
                                                            {active && (
                                                                <span
                                                                    className="text-[10px] uppercase tracking-wide font-normal shrink-0 px-1.5 py-0.5 rounded"
                                                                    style={{
                                                                        backgroundColor: styles.surfaceSecondary,
                                                                        color: styles.contentSecondary,
                                                                    }}
                                                                >
                                                                    Active
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div
                                                            className="text-xs truncate"
                                                            style={{ color: styles.contentTertiary }}
                                                        >
                                                            {ws.path}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Detail */}
                    <div
                        className="flex-1 overflow-y-auto"
                        style={{ backgroundColor: styles.surfacePrimary }}
                    >
                        {selected ? (
                            <div className="p-6 flex flex-col gap-5">
                                <div className="flex items-start gap-3">
                                    <FolderOpen
                                        className="size-7 shrink-0 mt-0.5"
                                        style={{ color: styles.contentPrimary }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h2
                                                className="text-lg font-semibold truncate"
                                                style={{ color: styles.contentPrimary }}
                                            >
                                                {selected.name}
                                            </h2>
                                            {isActive(selected) && (
                                                <span
                                                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                                                    style={{
                                                        backgroundColor: styles.surfaceAccent,
                                                        color: styles.contentPrimary,
                                                    }}
                                                >
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                        <div
                                            className="text-xs font-mono break-all mt-1"
                                            style={{ color: styles.contentTertiary }}
                                        >
                                            {selected.path}
                                        </div>
                                    </div>
                                </div>

                                <div
                                    className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm pt-1"
                                    style={{ color: styles.contentSecondary }}
                                >
                                    <div className="flex flex-col">
                                        <span
                                            className="text-[10px] uppercase tracking-wide"
                                            style={{ color: styles.contentTertiary }}
                                        >
                                            Created
                                        </span>
                                        <span style={{ color: styles.contentPrimary }}>
                                            {formatAbsolute(selected.createdAt)}
                                        </span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span
                                            className="text-[10px] uppercase tracking-wide"
                                            style={{ color: styles.contentTertiary }}
                                        >
                                            Last used
                                        </span>
                                        <span style={{ color: styles.contentPrimary }}>
                                            {formatRelative(selected.lastAccessedAt)}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 pt-2">
                                    <Button
                                        onClick={() => handleSwitch(selected)}
                                        disabled={isActive(selected)}
                                        size="sm"
                                    >
                                        <Check className="size-4" />
                                        {isActive(selected) ? "Current Workspace" : "Switch"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRevealInFinder(selected)}
                                    >
                                        <ExternalLink className="size-4" />
                                        Reveal in Finder
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => startRename(selected)}
                                    >
                                        <Pencil className="size-4" />
                                        Rename
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setConfirmRemove(selected)}
                                        disabled={removingId === selected.id}
                                        style={{ color: styles.contentSecondary }}
                                    >
                                        <Trash2 className="size-4" />
                                        Remove
                                    </Button>
                                </div>

                                <div
                                    className="text-xs pt-2"
                                    style={{ color: styles.contentTertiary }}
                                >
                                    Removing a workspace only takes it off this list. Files on disk are not deleted.
                                </div>
                            </div>
                        ) : (
                            <div
                                className="h-full flex flex-col items-center justify-center text-center px-8 gap-3"
                                style={{ color: styles.contentSecondary }}
                            >
                                <Folder className="size-12 opacity-40" />
                                <div>
                                    <p className="font-medium" style={{ color: styles.contentPrimary }}>
                                        No workspace selected
                                    </p>
                                    <p className="text-xs mt-1" style={{ color: styles.contentTertiary }}>
                                        Add a new workspace or select one from the list.
                                    </p>
                                </div>
                                <Button onClick={handleAddWorkspace} size="sm" className="mt-2">
                                    <Plus className="size-4" />
                                    Add Workspace
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Hint bar */}
                <div
                    className="shrink-0 flex flex-wrap items-center gap-4 px-4 py-2 text-xs border-t"
                    style={{
                        color: styles.contentTertiary,
                        borderColor: styles.borderDefault,
                    }}
                >
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">↑↓</kbd> navigate
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Enter</kbd> switch
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">F2</kbd> rename
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">⌘⌫</kbd> remove
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Esc</kbd> close
                    </span>
                </div>
            </div>

            <FolderPickerDialog
                open={folderPickerOpen}
                onOpenChange={setFolderPickerOpen}
                onSelect={handleFolderSelect}
                title="Add Workspace"
                description="Select a folder to add as a new workspace."
            />

            <WorkspaceWarningDialog
                open={warningPath !== null}
                onOpenChange={(open) => {
                    if (!open) setWarningPath(null);
                }}
                onConfirm={handleWarningConfirm}
                selectedPath={warningPath ?? ""}
            />

            <Dialog
                open={confirmRemove !== null}
                onOpenChange={(open) => {
                    if (!open) setConfirmRemove(null);
                }}
            >
                <DialogContent size="md">
                    <DialogHeader>
                        <DialogTitle>Remove workspace?</DialogTitle>
                        <DialogDescription>
                            Remove <strong>{confirmRemove?.name}</strong> from the workspace list. The folder on disk
                            will not be deleted.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="pt-2">
                        <Button variant="ghost" onClick={() => setConfirmRemove(null)} autoFocus>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleRemoveConfirm}
                            style={{
                                backgroundColor: styles.semanticDestructive,
                                color: styles.semanticDestructiveForeground,
                            }}
                        >
                            Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
