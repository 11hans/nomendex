import { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspaceSwitcher, WorkspaceInfo } from "@/hooks/useWorkspaceSwitcher";
import { useTheme } from "@/hooks/useTheme";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { Folder, FolderOpen, Loader2 } from "lucide-react";

/**
 * Simple fuzzy match function - checks if all characters in query appear in order in text
 */
function fuzzyMatch(text: string, query: string): boolean {
    if (!query) return true;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();

    let queryIndex = 0;
    for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
        if (lowerText[i] === lowerQuery[queryIndex]) {
            queryIndex++;
        }
    }
    return queryIndex === lowerQuery.length;
}

export function SwitchWorkspaceDialog() {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const { closeDialog } = useCommandDialog();
    const { workspaces, activeWorkspace, loading, switchWorkspace } = useWorkspaceSwitcher();

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Filter out the active workspace and apply fuzzy filter
    const filteredWorkspaces = workspaces
        .filter((ws) => ws.id !== activeWorkspace?.id)
        .filter((ws) => fuzzyMatch(ws.name, searchQuery));

    // Reset selection when filter changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [searchQuery]);

    // Auto-focus the search input when dialog opens
    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, []);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current && filteredWorkspaces.length > 0) {
            const items = listRef.current.querySelectorAll("[data-workspace-item]");
            const selectedItem = items[selectedIndex];
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: "nearest" });
            }
        }
    }, [selectedIndex, filteredWorkspaces.length]);

    const handleSwitch = useCallback(
        async (workspace: WorkspaceInfo) => {
            closeDialog();
            await switchWorkspace(workspace.id);
        },
        [closeDialog, switchWorkspace]
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setSelectedIndex((prev) =>
                    prev < filteredWorkspaces.length - 1 ? prev + 1 : prev
                );
                break;
            case "ArrowUp":
                e.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
                break;
            case "Enter":
                e.preventDefault();
                if (filteredWorkspaces[selectedIndex]) {
                    handleSwitch(filteredWorkspaces[selectedIndex]);
                }
                break;
            case "Escape":
                e.preventDefault();
                closeDialog();
                break;
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>Switch Workspace</DialogTitle>
                <DialogDescription>
                    Select a workspace to switch to
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
                {/* Search Input */}
                <Input
                    ref={inputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search workspaces..."
                    className="h-9"
                />

                {/* Workspace List */}
                <div
                    ref={listRef}
                    className="max-h-64 overflow-y-auto rounded border"
                    style={{
                        borderColor: styles.borderDefault,
                        backgroundColor: styles.surfacePrimary,
                    }}
                >
                    {loading ? (
                        <div
                            className="flex items-center justify-center py-8"
                            style={{ color: styles.contentSecondary }}
                        >
                            <Loader2 className="size-4 animate-spin mr-2" />
                            Loading workspaces...
                        </div>
                    ) : filteredWorkspaces.length === 0 ? (
                        <div
                            className="flex items-center justify-center py-8 text-sm"
                            style={{ color: styles.contentSecondary }}
                        >
                            {workspaces.length <= 1
                                ? "No other workspaces available"
                                : "No matching workspaces"}
                        </div>
                    ) : (
                        <div className="p-1">
                            {filteredWorkspaces.map((workspace, index) => {
                                const isSelected = index === selectedIndex;
                                return (
                                    <button
                                        key={workspace.id}
                                        data-workspace-item
                                        onClick={() => handleSwitch(workspace)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded transition-colors text-left"
                                        style={{
                                            color: styles.contentPrimary,
                                            backgroundColor: isSelected
                                                ? styles.surfaceAccent
                                                : "transparent",
                                        }}
                                    >
                                        {isSelected ? (
                                            <FolderOpen
                                                className="size-4 shrink-0"
                                                style={{ color: styles.contentSecondary }}
                                            />
                                        ) : (
                                            <Folder
                                                className="size-4 shrink-0"
                                                style={{ color: styles.contentSecondary }}
                                            />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">
                                                {workspace.name}
                                            </div>
                                            <div
                                                className="text-xs truncate"
                                                style={{ color: styles.contentTertiary }}
                                            >
                                                {workspace.path}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Hints */}
                <div
                    className="text-xs flex gap-4"
                    style={{ color: styles.contentTertiary }}
                >
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">↑↓</kbd>{" "}
                        navigate
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Enter</kbd>{" "}
                        switch
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Esc</kbd>{" "}
                        close
                    </span>
                </div>
            </div>
        </>
    );
}
