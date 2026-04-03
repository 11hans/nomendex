import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { RoutingProvider } from "./hooks/useRouting";
import { ThemeProvider } from "./hooks/useTheme";
import { useNativeKeyboardBridge } from "./hooks/useNativeKeyboardBridge";
import { useUpdateNotification } from "./hooks/useUpdateNotification";
import { useSkillUpdates } from "./hooks/useSkillUpdates";
import { Layout } from "./components/Layout";
import { WorkspacePage } from "./pages/WorkspacePage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { SyncPage } from "./pages/sync/SyncPage";
import { ConflictResolvePage } from "./pages/ConflictResolvePage";
import { AgentsPage } from "./pages/AgentsPage";
import { McpServersPage } from "./pages/McpServersPage";
import { McpServerFormPage } from "./pages/McpServerFormPage";
import { NewAgentPage } from "./pages/NewAgentPage";
import { TestEditorPage } from "./features/test-editor";
import { Toaster } from "@/components/ui/sonner";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { KeyboardShortcutsProvider } from "./contexts/KeyboardShortcutsContext";
import { GHSyncProvider } from "./contexts/GHSyncContext";
import { CommandDialogProvider } from "./components/CommandDialogProvider";
import { CommandMenu } from "./components/CommandMenu";
import { NotesCommandMenu } from "./components/NotesCommandMenu";
import { TabSwitcherMenu } from "./components/TabSwitcherMenu";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";
import { WorkspaceOnboarding } from "./components/WorkspaceOnboarding";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useNoteEvents } from "./hooks/useNoteEvents";
import { useTodoEvents } from "./hooks/useTodoEvents";

// Bridge component for native Mac app keyboard handling
function NativeKeyboardBridge() {
    useNativeKeyboardBridge();
    return null;
}

// Dev component that throws during render to test ErrorBoundary
// Listens for 'dev:trigger-error' custom event
function DevErrorTrigger() {
    const [shouldThrow, setShouldThrow] = React.useState(false);

    React.useEffect(() => {
        const triggerHandler = () => setShouldThrow(true);
        const resetHandler = () => setShouldThrow(false);
        window.addEventListener("dev:trigger-error", triggerHandler);
        window.addEventListener("error-boundary:reset", resetHandler);
        return () => {
            window.removeEventListener("dev:trigger-error", triggerHandler);
            window.removeEventListener("error-boundary:reset", resetHandler);
        };
    }, []);

    if (shouldThrow) {
        throw new Error("Test error triggered from dev command");
    }

    return null;
}

// Bridge component for native Mac app update notifications
function UpdateNotificationBridge() {
    useUpdateNotification();
    return null;
}

// Bridge component for real-time note file events (lock/unlock, changes)
function NoteEventsBridge() {
    useNoteEvents();
    return null;
}

// Bridge component for todo mutation events and calendar sync propagation
function TodoEventsBridge() {
    useTodoEvents();
    return null;
}

// Bridge component for checking skill updates after workspace loads
function SkillUpdatesBridge() {
    useSkillUpdates();
    return null;
}

// Wrapper component that shows onboarding if no workspace is configured
function WorkspaceGuard({ children }: { children: React.ReactNode }) {
    const { activeWorkspace, loading } = useWorkspaceSwitcher();
    const [startupError, setStartupError] = React.useState<string | null>(null);
    const [startupChecked, setStartupChecked] = React.useState(false);
    const [retrying, setRetrying] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        const checkStatus = () => {
            fetch("/api/startup-status")
                .then((r) => r.json())
                .then((data: { ok: boolean; error?: string }) => {
                    if (cancelled) return;
                    if (!data.ok) setStartupError(data.error ?? "Unknown startup error");
                    setStartupChecked(true);
                })
                .catch(() => {
                    if (cancelled) return;
                    // Server may still be starting; keep waiting.
                    setTimeout(checkStatus, 500);
                });
        };
        checkStatus();
        return () => { cancelled = true; };
    }, []);

    const handleRetry = async () => {
        setRetrying(true);
        try {
            const r = await fetch("/api/startup-status/retry", { method: "POST" });
            const data = (await r.json()) as { ok: boolean; error?: string };
            if (data.ok) {
                setStartupError(null);
                window.location.reload();
            } else {
                setStartupError(data.error ?? "Retry failed");
            }
        } catch {
            setStartupError("Could not reach server. The sidecar may have crashed — check startup logs.");
        } finally {
            setRetrying(false);
        }
    };

    if (loading || !startupChecked) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    if (startupError) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center">
                <div className="text-destructive font-semibold text-lg">Workspace not accessible</div>
                <div className="text-muted-foreground text-sm font-mono max-w-md break-all">{startupError}</div>
                <div className="text-muted-foreground text-xs max-w-md space-y-1 text-left">
                    <p><strong>1. iCloud not yet mounted</strong> — wait a moment then click Retry.</p>
                    <p><strong>2. macOS revoked file access</strong> — System Settings → Privacy &amp; Security → Files and Folders → enable Nomendex.</p>
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                    <button
                        onClick={handleRetry}
                        disabled={retrying}
                        className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                        {retrying ? "Retrying…" : "Retry"}
                    </button>
                    <button
                        onClick={() => window.open("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders")}
                        className="px-4 py-2 rounded border border-border text-sm font-medium hover:bg-accent"
                    >
                        Privacy Settings
                    </button>
                </div>
            </div>
        );
    }

    if (!activeWorkspace) {
        return <WorkspaceOnboarding />;
    }

    return <>{children}</>;
}

export function App() {
    return (
        <ThemeProvider>
            <ErrorBoundary>
                <DevErrorTrigger />
                <NativeKeyboardBridge />
                <UpdateNotificationBridge />
                <NoteEventsBridge />
                <TodoEventsBridge />
                <BrowserRouter>
                    <RoutingProvider>
                        <WorkspaceGuard>
                            <WorkspaceProvider>
                                <SkillUpdatesBridge />
                                <KeyboardShortcutsProvider>
                                    <GHSyncProvider>
                                        <CommandDialogProvider>
                                            <Routes>
                                                {/* Main layout with sidebar */}
                                                <Route element={<Layout />}>
                                                    <Route index element={<WorkspacePage />} />
                                                    <Route path="/settings" element={<SettingsPage />} />
                                                    <Route path="/help" element={<HelpPage />} />
                                                    <Route path="/agents" element={<AgentsPage />} />
                                                    <Route path="/new-agent" element={<NewAgentPage />} />
                                                    <Route path="/mcp-servers" element={<McpServersPage />} />
                                                    <Route path="/mcp-servers/new" element={<McpServerFormPage />} />
                                                    <Route path="/mcp-servers/:serverId/edit" element={<McpServerFormPage />} />
                                                    <Route path="/sync" element={<SyncPage />} />
                                                    <Route path="/sync/resolve" element={<ConflictResolvePage />} />
                                                    <Route path="/test-editor" element={<TestEditorPage />} />
                                                </Route>

                                                {/* Catch-all redirect to root */}
                                                <Route path="*" element={<Navigate to="/" replace />} />
                                            </Routes>
                                            <CommandMenu />
                                            <NotesCommandMenu />
                                            <TabSwitcherMenu />
                                        </CommandDialogProvider>
                                    </GHSyncProvider>
                                </KeyboardShortcutsProvider>
                            </WorkspaceProvider>
                        </WorkspaceGuard>
                    </RoutingProvider>
                </BrowserRouter>
                <Toaster position="top-right" richColors />
            </ErrorBoundary>
        </ThemeProvider>
    );
}

export default App;
