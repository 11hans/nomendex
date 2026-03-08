import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Hash, Trash2 } from "lucide-react";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { useTheme } from "@/hooks/useTheme";
import { useIndexedListNavigation } from "@/hooks/useIndexedListNavigation";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { BrowserListCard, BrowserViewShell } from "@/features/shared/browser-view-shell";
import { tagsPluginSerial } from "./index";
import type { TagSuggestion } from "@/features/notes/tags-types";

export function TagsBrowserView({ tabId }: { tabId: string }) {
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [tags, setTags] = useState<TagSuggestion[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [createError, setCreateError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const { currentTheme } = useTheme();
    const placement = getViewSelfPlacement(tabId);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const newTagInputRef = useRef<HTMLInputElement>(null);
    const hasSetTabNameRef = useRef<boolean>(false);

    const notesAPI = useNotesAPI();

    // Set tab name
    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, "Tags");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, setTabName]);

    // Auto-focus search input when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId && !loading) {
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId, loading]);

    // Auto-focus new tag input when dialog opens
    useEffect(() => {
        if (showCreateDialog) {
            requestAnimationFrame(() => {
                newTagInputRef.current?.focus();
            });
        }
    }, [showCreateDialog]);

    // Load tags
    useEffect(() => {
        const fetchTags = async () => {
            try {
                setLoading(true);
                setError(null);
                const result = await notesAPI.getAllTags();
                setTags(result);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch tags";
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };
        fetchTags();
    }, [notesAPI, setLoading, setError]);

    // Filter tags based on search
    const filteredTags = searchQuery
        ? tags.filter((t) => t.tag.toLowerCase().includes(searchQuery.toLowerCase()))
        : tags;

    // Open tag detail view
    const handleOpenTag = useCallback(
        async (tagName: string) => {
            const newTab = await addNewTab({
                pluginMeta: tagsPluginSerial,
                view: "detail",
                props: { tagName },
                preferExisting: true,
            });
            if (newTab) {
                if (placement === "sidebar") {
                    setSidebarTabId(newTab.id);
                } else {
                    setActiveTabId(newTab.id);
                }
            }
        },
        [addNewTab, placement, setActiveTabId, setSidebarTabId]
    );

    const { selectedIndex, setSelectedIndex, listRef, handleKeyDown } = useIndexedListNavigation({
        itemCount: filteredTags.length,
        resetKey: searchQuery,
        onEnter: (index) => {
            const selectedTag = filteredTags[index];
            if (selectedTag) {
                void handleOpenTag(selectedTag.tag);
            }
        },
    });

    // Handle creating a new explicit tag
    const handleCreateTag = useCallback(async () => {
        const tagName = newTagName.trim();
        if (!tagName) {
            setCreateError("Tag name cannot be empty");
            return;
        }

        try {
            setCreating(true);
            setCreateError(null);
            await notesAPI.createExplicitTag({ tagName });

            // Reload tags
            const result = await notesAPI.getAllTags();
            setTags(result);

            // Close dialog and reset
            setShowCreateDialog(false);
            setNewTagName("");
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to create tag";
            setCreateError(errorMessage);
        } finally {
            setCreating(false);
        }
    }, [newTagName, notesAPI]);

    // Handle deleting an explicit tag
    const handleDeleteTag = useCallback(async (tagName: string) => {
        try {
            const { isExplicit } = await notesAPI.isExplicitTag({ tagName });
            if (!isExplicit) {
                return; // Only delete explicit tags
            }

            await notesAPI.deleteExplicitTag({ tagName });

            // Reload tags
            const result = await notesAPI.getAllTags();
            setTags(result);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to delete tag";
            setError(errorMessage);
        }
    }, [notesAPI, setError]);

    // Hook for Cmd+Enter in create dialog
    useNativeSubmit(() => {
        if (showCreateDialog && !creating && newTagName.trim()) {
            handleCreateTag();
        }
    });

    return (
        <>
            <BrowserViewShell
                styles={currentTheme.styles}
                loading={loading}
                loadingLabel="loading tags..."
                error={error}
                errorLabel="failed to load tags"
                title="Tags"
                itemCount={tags.length}
                headerIcon={(
                    <Hash
                        className="size-3"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    />
                )}
                action={(
                    <Button
                        variant="default"
                        size="sm"
                        onClick={() => setShowCreateDialog(true)}
                        className="h-7 rounded-md px-2 text-[11px] font-medium"
                    >
                        + new
                    </Button>
                )}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                onSearchKeyDown={handleKeyDown}
                searchInputRef={searchInputRef}
                searchPlaceholder="search tags..."
                empty={filteredTags.length === 0}
                emptyLabel={searchQuery ? "no tags match current filters" : "no tags yet"}
                listRef={listRef}
                rootClassName="tags-browser"
            >
                <BrowserListCard styles={currentTheme.styles}>
                    {filteredTags.map((tagItem, index) => (
                        <div
                            key={tagItem.tag}
                            data-index={index}
                            className="group relative"
                            onMouseEnter={() => setSelectedIndex(index)}
                        >
                            <button
                                onClick={() => {
                                    void handleOpenTag(tagItem.tag);
                                }}
                                className={`w-full border-t px-2.5 py-1.5 flex items-center gap-1.5 text-left transition-colors ${index === 0 ? "border-t-0" : ""}`}
                                style={{
                                    borderColor: currentTheme.styles.borderDefault,
                                    backgroundColor: index === selectedIndex
                                        ? currentTheme.styles.surfaceAccent
                                        : undefined,
                                    color: currentTheme.styles.contentPrimary,
                                }}
                            >
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <Hash
                                        className="size-3 shrink-0"
                                        style={{ color: currentTheme.styles.contentTertiary }}
                                    />
                                    <span className="text-xs truncate">{tagItem.tag}</span>
                                </div>
                                <div className="ml-auto mr-8 flex items-center gap-1 shrink-0">
                                    <span
                                        className="rounded-full px-1.5 py-0.5 text-[10px]"
                                        style={{
                                            backgroundColor: currentTheme.styles.surfaceTertiary,
                                            color: currentTheme.styles.contentSecondary,
                                        }}
                                    >
                                        {tagItem.count}
                                    </span>
                                </div>
                            </button>
                            {tagItem.count === 0 && (
                                <button
                                    onClick={() => {
                                        void handleDeleteTag(tagItem.tag);
                                    }}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 transition-opacity hover:bg-surface-elevated group-hover:opacity-100"
                                    title="Delete explicit tag"
                                >
                                    <Trash2
                                        className="size-3"
                                        style={{ color: currentTheme.styles.semanticDestructive }}
                                    />
                                </button>
                            )}
                        </div>
                    ))}
                </BrowserListCard>
            </BrowserViewShell>

            {/* Create Tag Dialog */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New Tag</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Input
                            ref={newTagInputRef}
                            type="text"
                            placeholder="Tag name (without #)"
                            value={newTagName}
                            onChange={(e) => {
                                setNewTagName(e.target.value);
                                setCreateError(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !creating && newTagName.trim()) {
                                    handleCreateTag();
                                }
                            }}
                            disabled={creating}
                        />
                        {createError && (
                            <p className="text-sm text-destructive mt-2">{createError}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setShowCreateDialog(false);
                                setNewTagName("");
                                setCreateError(null);
                            }}
                            disabled={creating}
                            autoFocus
                        >
                            Cancel
                        </Button>
                        <div className="flex flex-col items-center">
                            <Button
                                onClick={handleCreateTag}
                                disabled={creating || !newTagName.trim()}
                            >
                                {creating ? "Creating..." : "Create"}
                            </Button>
                            <span className="text-[10px] text-muted-foreground mt-1">⌘ Enter</span>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default TagsBrowserView;
