import { useEffect, useState, useRef, useCallback, type CSSProperties } from "react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { useAgentMemoryAPI } from "@/hooks/useAgentMemoryAPI";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from "@/components/ui/resizable";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Brain, Search, Plus, Save, Undo2, Trash2, ExternalLink, Calendar } from "lucide-react";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import type { AgentMemoryRecord, MemoryKind } from "@/features/agent-memory";
import { notesPluginSerial } from "@/features/notes";

const THE_VAULT_WORKSPACE_PATH = "/Users/honza/Library/Mobile Documents/iCloud~md~obsidian/Documents/TheVault";
const ALL_KINDS: MemoryKind[] = ["preference", "goal", "project", "decision", "context", "reference"];
const KIND_LABELS: Record<MemoryKind, string> = {
    preference: "Preference",
    goal: "Goal",
    project: "Project",
    decision: "Decision",
    context: "Context",
    reference: "Reference",
};

function getKindTone(kind: MemoryKind, styles: Theme["styles"]): string {
    switch (kind) {
        case "goal":
            return styles.semanticSuccess;
        case "decision":
            return styles.semanticPrimary;
        case "preference":
            return styles.contentAccent;
        case "project":
            return styles.contentPrimary;
        case "reference":
            return styles.contentTertiary;
        case "context":
        default:
            return styles.contentSecondary;
    }
}

function formatListDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function snippet(text: string, maxLength = 120): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "No content yet.";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}...`;
}

function normalizeWorkspacePath(p: string): string {
    return p.replace(/\/+$/, "");
}

function MemoryJournalTabs({ styles }: { styles: Theme["styles"] }) {
    return (
        <TabsList
            className="h-8 w-full gap-0 rounded-none border-0 bg-transparent p-0.5"
            style={{
                "--memory-tab-active-bg": styles.surfaceSecondary,
                "--memory-tab-active-border": styles.borderDefault,
            } as CSSProperties}
        >
            <TabsTrigger
                value="memory"
                className="h-full flex-1 rounded-md border border-transparent px-2 text-xs data-[state=active]:border-[var(--memory-tab-active-border)] data-[state=active]:bg-[var(--memory-tab-active-bg)] data-[state=active]:shadow-none"
            >
                <Brain className="size-3 mr-1" />
                Memory
            </TabsTrigger>
            <TabsTrigger
                value="journal"
                className="h-full flex-1 rounded-md border border-transparent px-2 text-xs data-[state=active]:border-[var(--memory-tab-active-border)] data-[state=active]:bg-[var(--memory-tab-active-bg)] data-[state=active]:shadow-none"
            >
                <Calendar className="size-3 mr-1" />
                Journal
            </TabsTrigger>
        </TabsList>
    );
}

// --- Memory Tab ---

function MemoryTab({ tabId }: { tabId: string }) {
    const { currentTheme } = useTheme();
    const styles = currentTheme.styles;
    const api = useAgentMemoryAPI();
    const { activeTab } = useWorkspaceContext();

    const [memories, setMemories] = useState<AgentMemoryRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [kindFilter, setKindFilter] = useState<string>("all");
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const [showWorkspaceManagerCta, setShowWorkspaceManagerCta] = useState(false);
    const [isTheVaultWorkspace, setIsTheVaultWorkspace] = useState<boolean>(false);

    // Editor state
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editorContent, setEditorContent] = useState("");
    const [originalContent, setOriginalContent] = useState("");
    const [editorLoading, setEditorLoading] = useState(false);
    const [editorError, setEditorError] = useState<string | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didInitialSyncRef = useRef(false);

    const isDirty = editorContent !== originalContent;
    const selectedMemory = selectedId ? memories.find((m) => m.id === selectedId) ?? null : null;

    // Load memories list
    const loadMemories = useCallback(async (search?: string, kinds?: MemoryKind[] | undefined) => {
        try {
            setListLoading(true);
            setListError(null);
            const result = await api.listManagedMemories({
                search: search || undefined,
                kinds: kinds && kinds.length > 0 ? kinds : undefined,
                limit: 200,
            });
            setMemories(result.items);
            setTotal(result.total);
        } catch (err) {
            setListError(err instanceof Error ? err.message : "Failed to load memories");
        } finally {
            setListLoading(false);
        }
    }, [api]);

    const openWorkspaceManager = useCallback(() => {
        window.dispatchEvent(new CustomEvent("workspace:openManager"));
    }, []);

    const verifyTheVaultWorkspace = useCallback(async (): Promise<boolean> => {
        const response = await fetch("/api/workspaces/active");
        if (!response.ok) {
            throw new Error(`Failed to resolve active workspace (${response.status})`);
        }

        const payload = await response.json() as {
            success?: boolean;
            data?: { path?: string | null } | null;
            message?: string;
        };

        if (!payload?.success) {
            throw new Error(payload?.message || "Failed to resolve active workspace");
        }

        const activeWorkspacePath = payload.data?.path ?? null;
        const isTarget =
            typeof activeWorkspacePath === "string"
            && normalizeWorkspacePath(activeWorkspacePath) === normalizeWorkspacePath(THE_VAULT_WORKSPACE_PATH);

        setIsTheVaultWorkspace(isTarget);
        setShowWorkspaceManagerCta(!isTarget);

        if (!isTarget) {
            const activeLabel = activeWorkspacePath ?? "není nastaven";
            setListError(
                `Memory se načítá jen z TheVault (${THE_VAULT_WORKSPACE_PATH}). Aktuální workspace: ${activeLabel}.`
            );
            setMemories([]);
            setTotal(0);
            setSelectedId(null);
            setEditorContent("");
            setOriginalContent("");
            setIsNew(false);
        }

        return isTarget;
    }, []);

    // Initial load: sync vault-derived memories first, then load list.
    useEffect(() => {
        if (didInitialSyncRef.current) return;
        didInitialSyncRef.current = true;

        void (async () => {
            setListLoading(true);
            setListError(null);
            try {
                const isTargetWorkspace = await verifyTheVaultWorkspace();
                if (!isTargetWorkspace) return;
                await api.syncVaultMemories();
                await loadMemories();
            } catch (err) {
                setListError(err instanceof Error ? err.message : "Failed to load memories");
                setMemories([]);
                setTotal(0);
            } finally {
                setListLoading(false);
            }
        })();
    }, [api, loadMemories, verifyTheVaultWorkspace]);

    // Search with debounce
    useEffect(() => {
        if (!isTheVaultWorkspace) {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            return;
        }
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => {
            const kinds = kindFilter !== "all" ? [kindFilter as MemoryKind] : undefined;
            loadMemories(searchQuery, kinds);
        }, 300);
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchQuery, kindFilter, loadMemories, isTheVaultWorkspace]);

    // Auto-focus search when tab active
    useEffect(() => {
        if (activeTab?.id === tabId) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
    }, [activeTab?.id, tabId]);

    // Guard: if dirty, queue action behind discard confirmation
    const guardDirty = useCallback((action: () => void) => {
        if (isDirty) {
            setPendingAction(() => action);
        } else {
            action();
        }
    }, [isDirty]);

    const confirmDiscard = useCallback(() => {
        const action = pendingAction;
        setPendingAction(null);
        action?.();
    }, [pendingAction]);

    // Load a memory into the editor (no dirty guard — called after guard)
    const loadIntoEditor = useCallback(async (id: string) => {
        try {
            setEditorLoading(true);
            setEditorError(null);
            setIsNew(false);
            const result = await api.getMemoryMarkdown({ memoryId: id });
            setSelectedId(id);
            setEditorContent(result.markdown);
            setOriginalContent(result.markdown);
        } catch (err) {
            setEditorError(err instanceof Error ? err.message : "Failed to load memory");
        } finally {
            setEditorLoading(false);
        }
    }, [api]);

    // Select memory (with dirty guard)
    const handleSelect = useCallback((id: string) => {
        guardDirty(() => { void loadIntoEditor(id); });
    }, [guardDirty, loadIntoEditor]);

    // Create new (with dirty guard)
    const handleNew = useCallback(() => {
        guardDirty(() => {
            void (async () => {
                try {
                    setEditorLoading(true);
                    setEditorError(null);
                    const result = await api.createMemoryFromMarkdown({});
                    setSelectedId(null);
                    setIsNew(true);
                    setEditorContent(result.markdown);
                    setOriginalContent(result.markdown);
                } catch (err) {
                    setEditorError(err instanceof Error ? err.message : "Failed to create template");
                } finally {
                    setEditorLoading(false);
                }
            })();
        });
    }, [guardDirty, api]);

    // Save
    const handleSave = useCallback(async () => {
        try {
            setEditorLoading(true);
            setEditorError(null);
            const result = await api.saveMemoryMarkdown({
                memoryId: isNew ? undefined : (selectedId ?? undefined),
                markdown: editorContent,
            });
            setSelectedId(result.record.id);
            setIsNew(false);
            setOriginalContent(editorContent);
            // Reload list
            const kinds = kindFilter !== "all" ? [kindFilter as MemoryKind] : undefined;
            await loadMemories(searchQuery, kinds);
        } catch (err) {
            setEditorError(err instanceof Error ? err.message : "Failed to save memory");
        } finally {
            setEditorLoading(false);
        }
    }, [api, editorContent, isNew, selectedId, loadMemories, searchQuery, kindFilter]);

    // Revert
    const handleRevert = useCallback(() => {
        setEditorContent(originalContent);
        setEditorError(null);
    }, [originalContent]);

    // Delete
    const handleDelete = useCallback(async () => {
        if (!selectedId) return;
        try {
            await api.deleteMemory({ memoryId: selectedId });
            setSelectedId(null);
            setEditorContent("");
            setOriginalContent("");
            setIsNew(false);
            setShowDeleteDialog(false);
            const kinds = kindFilter !== "all" ? [kindFilter as MemoryKind] : undefined;
            await loadMemories(searchQuery, kinds);
        } catch (err) {
            setEditorError(err instanceof Error ? err.message : "Failed to delete memory");
        }
    }, [api, selectedId, loadMemories, searchQuery, kindFilter]);

    // Cmd+S to save
    useNativeSubmit(() => {
        if (isDirty && !editorLoading) {
            handleSave();
        }
    });

    return (
        <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left panel: Memory list */}
            <ResizablePanel defaultSize={35} minSize={25}>
                <div className="h-full flex flex-col min-h-0" style={{ backgroundColor: styles.surfacePrimary }}>
                    {/* Header */}
                    <div className="shrink-0 px-3 pt-2 pb-2">
                        <MemoryJournalTabs styles={styles} />
                        <div className="flex items-center gap-1.5">
                            <Brain className="size-3" style={{ color: styles.contentTertiary }} />
                            <span
                                className="text-xs font-medium uppercase tracking-[0.14em]"
                                style={{ color: styles.contentPrimary }}
                            >
                                Memory
                            </span>
                            <span className="text-caption" style={{ color: styles.contentTertiary }}>
                                {total} items
                            </span>
                            <div className="ml-auto">
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={handleNew}
                                    className="h-7 rounded-md px-2 text-xs font-medium"
                                    disabled={!isTheVaultWorkspace}
                                >
                                    <Plus className="size-3 mr-1" />
                                    new
                                </Button>
                            </div>
                        </div>
                        <p className="mt-1 text-caption" style={{ color: styles.contentTertiary }}>
                            editable markdown memories with YAML frontmatter
                        </p>

                        {/* Search */}
                        <div className="relative mt-2">
                            <Search
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3"
                                style={{ color: styles.contentTertiary }}
                            />
                            <Input
                                ref={searchInputRef}
                                type="text"
                                placeholder="search memories..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-8 pl-8 text-xs bg-transparent"
                                disabled={!isTheVaultWorkspace}
                                style={{
                                    borderColor: styles.borderDefault,
                                    color: styles.contentPrimary,
                                }}
                            />
                        </div>

                        {/* Kind filter */}
                        <div className="mt-1.5 flex items-center gap-1.5">
                            <Select value={kindFilter} onValueChange={setKindFilter} disabled={!isTheVaultWorkspace}>
                                <SelectTrigger
                                    className="h-7 text-xs flex-1"
                                    style={{
                                        borderColor: styles.borderDefault,
                                        color: styles.contentPrimary,
                                    }}
                                >
                                    <SelectValue placeholder="all kinds" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">all kinds</SelectItem>
                                    {ALL_KINDS.map((k) => (
                                        <SelectItem key={k} value={k}>{k}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <span
                                className="rounded px-1.5 py-0.5 text-caption"
                                style={{
                                    backgroundColor: styles.surfaceSecondary,
                                    color: styles.contentTertiary,
                                }}
                            >
                                {memories.length}
                            </span>
                        </div>
                    </div>

                    {/* List */}
                    <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                        {listLoading ? (
                            <div className="py-4 text-center text-caption" style={{ color: styles.contentTertiary }}>
                                loading...
                            </div>
                        ) : listError ? (
                            <div className="py-4 text-center">
                                <div className="text-caption" style={{ color: styles.semanticDestructive }}>
                                    {listError}
                                </div>
                                {showWorkspaceManagerCta && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mt-2 h-7 px-2 text-xs"
                                        onClick={openWorkspaceManager}
                                    >
                                        Open Workspace Manager
                                    </Button>
                                )}
                            </div>
                        ) : memories.length === 0 ? (
                            <div className="py-4 text-center text-caption" style={{ color: styles.contentTertiary }}>
                                {searchQuery ? "no memories match" : "no memories yet"}
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {memories.map((mem) => {
                                    const isSelected = mem.id === selectedId;
                                    return (
                                        <button
                                            key={mem.id}
                                            onClick={() => handleSelect(mem.id)}
                                            className="w-full rounded-md border px-2.5 py-2 text-left transition-colors hover:opacity-95"
                                            style={{
                                                borderColor: isSelected ? styles.borderAccent : styles.borderDefault,
                                                backgroundColor: isSelected ? styles.surfaceAccent : styles.surfaceSecondary,
                                                color: styles.contentPrimary,
                                            }}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span
                                                    className="shrink-0 rounded px-1.5 py-0.5 text-micro uppercase font-medium tracking-[0.08em]"
                                                    style={{
                                                        backgroundColor: styles.surfaceTertiary,
                                                        color: getKindTone(mem.kind, styles),
                                                    }}
                                                >
                                                    {KIND_LABELS[mem.kind]}
                                                </span>
                                                <span className="text-xs font-medium truncate">{mem.title || "(untitled)"}</span>
                                            </div>
                                            <p className="mt-1 text-caption line-clamp-2" style={{ color: styles.contentTertiary }}>
                                                {snippet(mem.text)}
                                            </p>
                                            <div className="mt-1.5 flex items-center gap-1.5 text-micro" style={{ color: styles.contentTertiary }}>
                                                <span>updated {formatListDate(mem.updatedAt)}</span>
                                                {mem.tags.length > 0 ? (
                                                    <span className="truncate">{mem.tags.slice(0, 3).map((t) => `#${t}`).join(" ")}</span>
                                                ) : (
                                                    <span>no tags</span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* Right panel: Editor */}
            <ResizablePanel defaultSize={65} minSize={30}>
                <div className="h-full flex flex-col min-h-0" style={{ backgroundColor: styles.surfacePrimary }}>
                    {selectedId || isNew ? (
                        <>
                            {/* Editor toolbar */}
                            <div
                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b"
                                style={{ borderColor: styles.borderDefault }}
                            >
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span
                                        className="text-xs font-medium truncate"
                                        style={{ color: styles.contentPrimary }}
                                    >
                                        {isNew ? "New memory draft" : (selectedMemory?.title || "Memory")}
                                    </span>
                                    {selectedMemory && !isNew && (
                                        <span
                                            className="shrink-0 rounded px-1.5 py-0.5 text-micro uppercase tracking-[0.08em]"
                                            style={{
                                                backgroundColor: styles.surfaceTertiary,
                                                color: getKindTone(selectedMemory.kind, styles),
                                            }}
                                        >
                                            {KIND_LABELS[selectedMemory.kind]}
                                        </span>
                                    )}
                                </div>
                                {isDirty && (
                                    <span
                                        className="text-caption font-medium px-1.5 py-0.5 rounded"
                                        style={{
                                            backgroundColor: styles.semanticPrimary,
                                            color: styles.semanticPrimaryForeground,
                                        }}
                                    >
                                        unsaved
                                    </span>
                                )}
                                <div className="ml-auto flex items-center gap-1">
                                    {isDirty && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleRevert}
                                            className="h-7 px-2 text-xs"
                                            disabled={editorLoading}
                                        >
                                            <Undo2 className="size-3 mr-1" />
                                            revert
                                        </Button>
                                    )}
                                    <Button
                                        variant="default"
                                        size="sm"
                                        onClick={handleSave}
                                        className="h-7 px-2 text-xs"
                                        disabled={!isDirty || editorLoading}
                                    >
                                        <Save className="size-3 mr-1" />
                                        save
                                    </Button>
                                    {selectedId && !isNew && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setShowDeleteDialog(true)}
                                            className="h-7 px-2 text-xs"
                                            disabled={editorLoading}
                                        >
                                            <Trash2 className="size-3" style={{ color: styles.semanticDestructive }} />
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {editorError && (
                                <div
                                    className="shrink-0 px-3 py-1.5 text-xs"
                                    style={{
                                        backgroundColor: `${styles.semanticDestructive}15`,
                                        color: styles.semanticDestructive,
                                    }}
                                >
                                    {editorError}
                                </div>
                            )}

                            {/* Editor */}
                            <div className="flex-1 min-h-0 p-3">
                                <Textarea
                                    value={editorContent}
                                    onChange={(e) => setEditorContent(e.target.value)}
                                    className="h-full resize-none font-mono text-xs leading-relaxed bg-transparent"
                                    style={{
                                        borderColor: styles.borderDefault,
                                        color: styles.contentPrimary,
                                    }}
                                    disabled={editorLoading}
                                    placeholder="Use YAML frontmatter + markdown body..."
                                />
                            </div>
                        </>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                            <Brain className="size-8" style={{ color: styles.contentTertiary }} />
                            <span className="text-xs" style={{ color: styles.contentPrimary }}>
                                Select a memory to edit, or start a new one.
                            </span>
                            <span className="text-xs" style={{ color: styles.contentTertiary }}>
                                Every memory is saved as markdown with editable frontmatter.
                            </span>
                            <Button
                                variant="default"
                                size="sm"
                                onClick={handleNew}
                                className="h-7 rounded-md px-2 text-xs font-medium"
                            >
                                <Plus className="size-3 mr-1" />
                                new memory
                            </Button>
                        </div>
                    )}
                </div>
            </ResizablePanel>

            {/* Delete confirmation dialog */}
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Memory</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground py-2">
                        Are you sure you want to delete this memory? This action cannot be undone.
                    </p>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDelete}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Discard unsaved changes confirmation */}
            <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Unsaved Changes</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground py-2">
                        You have unsaved changes. Discard them and continue?
                    </p>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setPendingAction(null)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={confirmDiscard}>
                            Discard
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </ResizablePanelGroup>
    );
}

// --- Simple Markdown Renderer ---

/**
 * Lightweight markdown renderer for read-only preview.
 * Handles headings, lists, bold, italic, inline code, code blocks, and links.
 */
function SimpleMarkdown({ content, styles: s }: { content: string; styles: Record<string, string> }) {
    const html = markdownToHtml(content);
    return (
        <div
            className="simple-md text-xs leading-relaxed [&_h1]:text-title [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-0.5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:my-2 [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre_code]:p-0 [&_a]:underline [&_hr]:my-2 [&_hr]:border-current [&_hr]:opacity-20 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:my-1 [&_blockquote]:opacity-70"
            style={{ color: s.contentPrimary }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

function markdownToHtml(md: string): string {
    // Strip YAML frontmatter
    const stripped = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

    const lines = stripped.split("\n");
    const out: string[] = [];
    let inCodeBlock = false;
    let inList: "ul" | "ol" | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code blocks
        if (line.trimStart().startsWith("```")) {
            if (inCodeBlock) {
                out.push("</code></pre>");
                inCodeBlock = false;
            } else {
                if (inList) { out.push(`</${inList}>`); inList = null; }
                out.push("<pre><code>");
                inCodeBlock = true;
            }
            continue;
        }
        if (inCodeBlock) {
            out.push(escapeHtml(line));
            continue;
        }

        const trimmed = line.trim();

        // Blank line closes list
        if (!trimmed) {
            if (inList) { out.push(`</${inList}>`); inList = null; }
            continue;
        }

        // Headings
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (headingMatch) {
            if (inList) { out.push(`</${inList}>`); inList = null; }
            const level = headingMatch[1].length;
            out.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
            continue;
        }

        // Horizontal rule
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            if (inList) { out.push(`</${inList}>`); inList = null; }
            out.push("<hr/>");
            continue;
        }

        // Blockquote
        if (trimmed.startsWith("> ")) {
            if (inList) { out.push(`</${inList}>`); inList = null; }
            out.push(`<blockquote><p>${inlineFormat(trimmed.slice(2))}</p></blockquote>`);
            continue;
        }

        // Unordered list
        const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
        if (ulMatch) {
            if (inList !== "ul") {
                if (inList) out.push(`</${inList}>`);
                out.push("<ul>");
                inList = "ul";
            }
            out.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
            continue;
        }

        // Ordered list
        const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (olMatch) {
            if (inList !== "ol") {
                if (inList) out.push(`</${inList}>`);
                out.push("<ol>");
                inList = "ol";
            }
            out.push(`<li>${inlineFormat(olMatch[1])}</li>`);
            continue;
        }

        // Paragraph
        if (inList) { out.push(`</${inList}>`); inList = null; }
        out.push(`<p>${inlineFormat(trimmed)}</p>`);
    }

    if (inList) out.push(`</${inList}>`);
    if (inCodeBlock) out.push("</code></pre>");
    return out.join("\n");
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function sanitizeHref(rawHref: string): string {
    const href = rawHref.trim();
    if (!href) return "#";
    // Block obvious attribute-break and script vectors.
    if (/["'<>\s]/.test(href)) return "#";

    const lower = href.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
        return "#";
    }

    const isAllowed =
        lower.startsWith("http://") ||
        lower.startsWith("https://") ||
        lower.startsWith("mailto:") ||
        lower.startsWith("/") ||
        lower.startsWith("./") ||
        lower.startsWith("../") ||
        lower.startsWith("#");

    return isAllowed ? escapeHtmlAttr(href) : "#";
}

function inlineFormat(text: string): string {
    let s = escapeHtml(text);
    // Inline code (before other formatting to avoid conflicts)
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bold + italic
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    // Bold
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Italic
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
        const safeHref = sanitizeHref(href);
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    return s;
}

// --- Journal Tab ---

interface DailyEntry {
    date: string;
    fileName: string;
    exists: boolean;
    content?: string;
}

function JournalTab({ tabId: _tabId }: { tabId: string }) {
    const { currentTheme } = useTheme();
    const styles = currentTheme.styles;
    const notesAPI = useNotesAPI();
    const { openTab } = useWorkspaceContext();

    const [entries, setEntries] = useState<DailyEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    const selectedEntry = entries.find((e) => e.date === selectedDate);

    // Load recent daily notes
    useEffect(() => {
        const fetchEntries = async () => {
            try {
                setLoading(true);
                setError(null);
                const result = await notesAPI.getRecentDailyNotes({ days: 14 });
                setEntries(result.filter((e) => e.exists));
                // Auto-select first existing entry
                const firstExisting = result.find((e) => e.exists);
                if (firstExisting) {
                    setSelectedDate(firstExisting.date);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load journal entries");
            } finally {
                setLoading(false);
            }
        };
        fetchEntries();
    }, [notesAPI]);

    const handleOpenInNotes = useCallback((fileName: string) => {
        openTab({
            pluginMeta: notesPluginSerial,
            view: "editor",
            props: { noteFileName: fileName },
        });
    }, [openTab]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center text-xs" style={{ color: styles.contentTertiary }}>
                loading journal...
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center text-xs" style={{ color: styles.semanticDestructive }}>
                {error}
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-xs" style={{ color: styles.contentTertiary }}>
                no daily notes in the last 14 days
            </div>
        );
    }

    return (
        <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left: Date list */}
            <ResizablePanel defaultSize={30} minSize={20}>
                <div className="h-full flex flex-col min-h-0" style={{ backgroundColor: styles.surfacePrimary }}>
                    <div className="shrink-0 px-3 pt-2 pb-2">
                        <MemoryJournalTabs styles={styles} />
                        <div className="flex items-center gap-1.5">
                            <Calendar className="size-3" style={{ color: styles.contentTertiary }} />
                            <span
                                className="text-xs font-medium uppercase tracking-[0.14em]"
                                style={{ color: styles.contentPrimary }}
                            >
                                Journal
                            </span>
                            <span className="text-caption" style={{ color: styles.contentTertiary }}>
                                last 14 days
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                        <div
                            className="overflow-hidden rounded-lg border"
                            style={{
                                borderColor: styles.borderDefault,
                                backgroundColor: styles.surfaceSecondary,
                            }}
                        >
                            {entries.map((entry, index) => {
                                const d = new Date(entry.date + "T00:00:00");
                                const dayLabel = d.toLocaleDateString("en-US", {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                });
                                return (
                                    <button
                                        key={entry.date}
                                        onClick={() => setSelectedDate(entry.date)}
                                        className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${index > 0 ? "border-t" : ""}`}
                                        style={{
                                            borderColor: styles.borderDefault,
                                            backgroundColor: entry.date === selectedDate
                                                ? styles.surfaceAccent
                                                : undefined,
                                            color: styles.contentPrimary,
                                        }}
                                    >
                                        {dayLabel}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </ResizablePanel>

            <ResizableHandle />

            {/* Right: Content preview */}
            <ResizablePanel defaultSize={70} minSize={30}>
                <div className="h-full flex flex-col min-h-0" style={{ backgroundColor: styles.surfacePrimary }}>
                    {selectedEntry ? (
                        <>
                            <div
                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b"
                                style={{ borderColor: styles.borderDefault }}
                            >
                                <span className="text-xs font-medium" style={{ color: styles.contentPrimary }}>
                                    {new Date(selectedEntry.date + "T00:00:00").toLocaleDateString("en-US", {
                                        weekday: "long",
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                    })}
                                </span>
                                <div className="ml-auto">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleOpenInNotes(selectedEntry.fileName)}
                                        className="h-7 px-2 text-xs"
                                    >
                                        <ExternalLink className="size-3 mr-1" />
                                        Open in Notes
                                    </Button>
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto p-3">
                                <SimpleMarkdown
                                    content={selectedEntry.content || "(empty)"}
                                    styles={styles}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="h-full flex items-center justify-center">
                            <span className="text-xs" style={{ color: styles.contentTertiary }}>
                                select a day to preview
                            </span>
                        </div>
                    )}
                </div>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

// --- Main View ---

export function MemoryBrowserView({ tabId }: { tabId: string }) {
    const { activeTab, setTabName } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const styles = currentTheme.styles;
    const hasSetTabNameRef = useRef(false);

    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, "Memory");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, setTabName]);

    return (
        <div className="h-full flex flex-col min-h-0" style={{ backgroundColor: styles.surfacePrimary }}>
            <Tabs defaultValue="memory" className="h-full flex flex-col min-h-0 gap-0">
                <TabsContent value="memory" className="flex-1 min-h-0">
                    <MemoryTab tabId={tabId} />
                </TabsContent>
                <TabsContent value="journal" className="flex-1 min-h-0">
                    <JournalTab tabId={tabId} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

export default MemoryBrowserView;
