import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useGHSync } from "@/contexts/GHSyncContext";
import { useTheme } from "@/hooks/useTheme";
import { GitBranch, RefreshCw, Loader2 } from "lucide-react";
import type { GitStatus } from "./sync-types";
import { SetupWizard } from "./SetupWizard";
import { SyncSourceControl } from "./SyncSourceControl";

export function SyncPage() {
    const { setupStatus, needsSetup, recheckSetup, gitAuthMode } = useGHSync();
    const { currentTheme } = useTheme();

    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [operating, setOperating] = useState(false);
    const [operationMessage, setOperationMessage] = useState("");
    const [operationError, setOperationError] = useState("");

    const loadGitStatus = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch("/api/git/status");
            if (response.ok) {
                const data = await response.json();
                setGitStatus(data);
            }
        } catch (error) {
            console.error("Failed to load git status:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadGitStatus();
    }, [loadGitStatus]);

    const initializeGit = async () => {
        try {
            setOperating(true);
            setOperationError("");
            setOperationMessage("");
            const response = await fetch("/api/git/init", { method: "POST" });
            if (response.ok) {
                const data = await response.json();
                setOperationMessage(data.message || "Git initialized");
                await new Promise((resolve) => setTimeout(resolve, 100));
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

    const setupRemote = async (repoUrl: string, branch: string) => {
        if (!repoUrl) {
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
                body: JSON.stringify({ repoUrl, branch }),
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

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const isReady = gitStatus?.initialized && gitStatus?.hasRemote;

    // If setup is complete, show the source control view
    if (isReady) {
        return <SyncSourceControl />;
    }

    // Otherwise show setup wizard
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
                    <Button variant="outline" size="sm" className="ml-auto h-7 px-2 text-xs rounded-md" onClick={() => recheckSetup()}>
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                        recheck
                    </Button>
                </div>

                <SetupWizard
                    gitStatus={{
                        initialized: gitStatus?.initialized ?? false,
                        hasRemote: gitStatus?.hasRemote ?? false,
                    }}
                    setupStatus={setupStatus}
                    needsSetup={needsSetup}
                    gitAuthMode={gitAuthMode}
                    recheckSetup={recheckSetup}
                    onInitGit={initializeGit}
                    onSetupRemote={setupRemote}
                    operating={operating}
                    operationMessage={operationMessage}
                    operationError={operationError}
                />
            </div>
        </div>
    );
}
