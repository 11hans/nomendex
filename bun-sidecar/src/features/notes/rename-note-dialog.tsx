import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useTheme } from "@/hooks/useTheme";

interface RenameNoteDialogProps {
    noteFileName: string;
    onSuccess?: () => void;
}

export function RenameNoteDialog({ noteFileName, onSuccess }: RenameNoteDialogProps) {
    // Remove .md extension for display/editing
    const baseName = noteFileName.endsWith(".md") ? noteFileName.slice(0, -3) : noteFileName;
    const [newName, setNewName] = React.useState(baseName);
    const [isRenaming, setIsRenaming] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const { closeDialog } = useCommandDialog();
    const { renameNoteTabs } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const api = useNotesAPI();
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Focus input on mount
    React.useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const handleRename = async () => {
        const trimmedName = newName.trim();

        if (!trimmedName) {
            setError("Name cannot be empty");
            return;
        }

        // Check if name is unchanged
        if (trimmedName === baseName) {
            closeDialog();
            return;
        }

        setIsRenaming(true);
        setError(null);

        try {
            const result = await api.renameNote({
                oldFileName: noteFileName,
                newFileName: trimmedName,
            });

            // Update all open tabs with this note to use the new filename
            renameNoteTabs(noteFileName, result.fileName);

            closeDialog();
            onSuccess?.();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to rename note";
            setError(message);
        } finally {
            setIsRenaming(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // CMD+Enter or Ctrl+Enter to submit
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isRenaming) {
            e.preventDefault();
            handleRename();
        }
    };

    return (
        <>
            <DialogHeader className="space-y-1">
                <DialogTitle>Rename Note</DialogTitle>
                <DialogDescription>Current: {noteFileName}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-1">
                <div
                    className="text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: currentTheme.styles.contentTertiary }}
                >
                    New Name
                </div>
                <Input
                    ref={inputRef}
                    value={newName}
                    onChange={(e) => {
                        setNewName(e.target.value);
                        setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Note name"
                    disabled={isRenaming}
                    className="h-9 text-sm"
                    style={{
                        color: currentTheme.styles.contentPrimary,
                        backgroundColor: currentTheme.styles.surfacePrimary,
                        borderColor: error ? currentTheme.styles.semanticDestructive : currentTheme.styles.borderDefault,
                    }}
                />
                {error && (
                    <p className="text-xs mt-1" style={{ color: currentTheme.styles.semanticDestructive }}>{error}</p>
                )}
            </div>
            <div
                className="-mx-6 -mb-6 mt-4 border-t px-6 py-3"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <DialogFooter className="mt-0 pt-0">
                    <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={closeDialog} disabled={isRenaming}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRename}
                        disabled={isRenaming || !newName.trim()}
                        size="sm"
                        className="h-8 px-3 text-xs gap-2"
                    >
                        {isRenaming ? "Renaming..." : "Rename"}
                        {!isRenaming && <KeyboardIndicator keys={["cmd", "↵"]} />}
                    </Button>
                </DialogFooter>
            </div>
        </>
    );
}
