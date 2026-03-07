import { useState, useEffect, useCallback } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { FolderOpen, Plus, Check, Settings, ChevronDown } from "lucide-react";
import { useWorkspaceSwitcher } from "@/hooks/useWorkspaceSwitcher";
import { useTheme } from "@/hooks/useTheme";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { WorkspaceManager } from "./WorkspaceManager";
import { WorkspaceWarningDialog } from "./WorkspaceWarningDialog";

export function WorkspaceSwitcher() {
    const { workspaces, activeWorkspace, loading, switchWorkspace, addWorkspace } =
        useWorkspaceSwitcher();
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const [folderPickerOpen, setFolderPickerOpen] = useState(false);
    const [managerOpen, setManagerOpen] = useState(false);
    const [warningDialogOpen, setWarningDialogOpen] = useState(false);
    const [pendingPath, setPendingPath] = useState<string | null>(null);

    // Check if we're running in native macOS app
    const isNativeApp = Boolean(
        (window as Window & { webkit?: { messageHandlers?: { chooseDataRoot?: unknown } } }).webkit?.messageHandlers?.chooseDataRoot
    );

    // Set up callback for native folder picker
    const handleSetDataRoot = useCallback(
        (path: string) => {
            setPendingPath(path);
            setWarningDialogOpen(true);
        },
        []
    );

    useEffect(() => {
        (window as Window & { __setDataRoot?: (path: string) => void }).__setDataRoot = handleSetDataRoot;
        return () => {
            delete (window as Window & { __setDataRoot?: (path: string) => void }).__setDataRoot;
        };
    }, [handleSetDataRoot]);

    useEffect(() => {
        const handler = () => setManagerOpen(true);
        window.addEventListener("workspace:openManager", handler);
        return () => window.removeEventListener("workspace:openManager", handler);
    }, []);

    const handleAddWorkspace = () => {
        if (isNativeApp) {
            // Use native folder picker in macOS app
            const webkit = window.webkit as { messageHandlers?: { chooseDataRoot?: { postMessage: (data: Record<string, never>) => void } } } | undefined;
            webkit?.messageHandlers?.chooseDataRoot?.postMessage({});
        } else {
            // Use web-based folder picker in browser/dev mode
            setFolderPickerOpen(true);
        }
    };

    const handleFolderSelect = (path: string) => {
        setPendingPath(path);
        setWarningDialogOpen(true);
    };

    const handleWarningConfirm = () => {
        if (pendingPath) {
            addWorkspace(pendingPath);
            setPendingPath(null);
        }
        setWarningDialogOpen(false);
    };

    if (loading) {
        return (
            <div className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md opacity-50 text-muted-foreground text-xs">
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate">Loading...</span>
            </div>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors text-muted-foreground hover:bg-secondary/50 hover:text-foreground focus:outline-none"
                title={activeWorkspace?.name || "No Workspace"}
            >
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate flex-1 text-left">{activeWorkspace?.name || "No Workspace"}</span>
                <ChevronDown className="size-3 shrink-0 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="w-56"
                style={{ backgroundColor: styles.surfacePrimary, borderColor: styles.borderDefault }}
            >
                {workspaces.map((ws) => (
                    <DropdownMenuItem
                        key={ws.id}
                        onClick={() => switchWorkspace(ws.id)}
                        className="cursor-pointer"
                        style={{ color: styles.contentPrimary }}
                    >
                        <FolderOpen className="size-4 mr-2 shrink-0" />
                        <span className="truncate flex-1">{ws.name}</span>
                        {ws.id === activeWorkspace?.id && (
                            <Check className="size-4 ml-2 shrink-0" />
                        )}
                    </DropdownMenuItem>
                ))}
                {workspaces.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                    onClick={handleAddWorkspace}
                    className="cursor-pointer"
                    style={{ color: styles.contentPrimary }}
                >
                    <Plus className="size-4 mr-2 shrink-0" />
                    <span>Add Workspace...</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => setManagerOpen(true)}
                    className="cursor-pointer"
                    style={{ color: styles.contentPrimary }}
                >
                    <Settings className="size-4 mr-2 shrink-0" />
                    <span>Manage Workspaces...</span>
                </DropdownMenuItem>
            </DropdownMenuContent>

            <WorkspaceManager
                open={managerOpen}
                onOpenChange={setManagerOpen}
            />

            <FolderPickerDialog
                open={folderPickerOpen}
                onOpenChange={setFolderPickerOpen}
                onSelect={handleFolderSelect}
                title="Add Workspace"
                description="Select a folder to add as a new workspace."
            />

            <WorkspaceWarningDialog
                open={warningDialogOpen}
                onOpenChange={setWarningDialogOpen}
                onConfirm={handleWarningConfirm}
                selectedPath={pendingPath || ""}
            />
        </DropdownMenu>
    );
}
