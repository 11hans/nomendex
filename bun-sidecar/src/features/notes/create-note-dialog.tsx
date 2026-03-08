import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { notesPluginSerial } from "@/features/notes";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { useTheme } from "@/hooks/useTheme";

interface CreateNoteDialogProps {
    onSuccess?: (fileName: string) => void;
}

export function CreateNoteDialog({ onSuccess }: CreateNoteDialogProps) {
    const [noteName, setNoteName] = React.useState("");
    const [isCreating, setIsCreating] = React.useState(false);
    const { closeDialog } = useCommandDialog();
    const { addNewTab, setActiveTabId } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const api = useNotesAPI();

    const doCreate = React.useCallback(async () => {
        if (!noteName.trim() || isCreating) return;

        setIsCreating(true);
        try {
            // Sanitize filename - remove any path separators and add .md extension
            const fileName = noteName.trim().replace(/[/\\]/g, "-") + ".md";

            // Create the note via API
            await api.saveNote({
                fileName,
                content: ""
            });

            // Open the note in editor
            const newTab = addNewTab({
                pluginMeta: notesPluginSerial,
                view: "editor",
                props: { noteFileName: fileName }
            });

            if (newTab) {
                setActiveTabId(newTab.id);
            }

            // Clear form state before closing
            setNoteName("");
            closeDialog();
            onSuccess?.(fileName);
        } catch (error) {
            console.error("Failed to create note:", error);
            // Could add error handling UI here
        } finally {
            setIsCreating(false);
        }
    }, [noteName, isCreating, addNewTab, setActiveTabId, closeDialog, onSuccess, api]);

    const handleSubmit = React.useCallback((e: React.FormEvent) => {
        e.preventDefault();
        doCreate();
    }, [doCreate]);

    // Handle CMD+Enter from native Mac app (Swift calls __nativeSubmit)
    useNativeSubmit(doCreate);

    // Handle CMD+Enter in browser (fallback for non-native environment)
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                doCreate();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [doCreate]);

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-2 py-1">
                <Label
                    htmlFor="name"
                    className="text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: currentTheme.styles.contentTertiary }}
                >
                    Note Name
                </Label>
                <Input
                    id="name"
                    value={noteName}
                    onChange={(e) => setNoteName(e.target.value)}
                    placeholder="My New Note"
                    className="h-9 text-sm"
                    autoFocus
                    style={{
                        color: currentTheme.styles.contentPrimary,
                        backgroundColor: currentTheme.styles.surfacePrimary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                />
            </div>
            <DialogFooter
                className="mt-4 border-t pt-3"
                style={{ borderColor: currentTheme.styles.borderDefault }}
            >
                <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={closeDialog}>
                    Cancel
                </Button>
                <Button type="submit" size="sm" className="h-8 px-3 text-xs gap-2" disabled={!noteName.trim() || isCreating}>
                    {isCreating ? "Creating..." : "Create"}
                    {!isCreating && <KeyboardIndicator keys={["cmd", "enter"]} />}
                </Button>
            </DialogFooter>
        </form>
    );
}
