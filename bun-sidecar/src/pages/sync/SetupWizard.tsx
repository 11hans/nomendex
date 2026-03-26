import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
    Link2,
    FolderGit2,
    RefreshCw,
    Key,
    ExternalLink,
} from "lucide-react";

interface SetupStatus {
    gitInstalled: boolean;
    gitInitialized: boolean;
    hasRemote: boolean;
    hasPAT: boolean;
}

interface SetupWizardProps {
    gitStatus: {
        initialized: boolean;
        hasRemote: boolean;
    };
    setupStatus: SetupStatus;
    needsSetup: boolean;
    gitAuthMode: "local" | "pat";
    recheckSetup: () => void;
    onInitGit: () => Promise<void>;
    onSetupRemote: (repoUrl: string, branch: string) => Promise<void>;
    operating: boolean;
    operationMessage: string;
    operationError: string;
}

export function SetupWizard({
    gitStatus,
    setupStatus,
    needsSetup,
    gitAuthMode,
    recheckSetup,
    onInitGit,
    onSetupRemote,
    operating,
    operationMessage,
    operationError,
}: SetupWizardProps) {
    const navigate = useNavigate();
    const [repoUrl, setRepoUrl] = useState("");
    const [branch, setBranch] = useState("main");

    return (
        <div className="space-y-4">
            {/* Status Toast */}
            {(operationMessage || operationError) && (
                <div className={`px-3 py-2 text-sm flex items-center gap-2 rounded-md ${
                    operationError
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
                                        <a
                                            href="https://github.com/settings/tokens/new?scopes=repo&description=Nomendex%20Sync"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-primary hover:underline flex items-center gap-1"
                                        >
                                            Create token on GitHub
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
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
                        <Button variant="ghost" size="sm" onClick={recheckSetup} className="text-xs">
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Recheck Setup
                        </Button>
                    </div>
                </div>
            )}

            {/* Not Initialized */}
            {!gitStatus.initialized && (
                <div className="border border-dashed rounded-lg p-8 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
                        <FolderGit2 className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="font-medium mb-2">Initialize Repository</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Set up git tracking for your workspace
                    </p>
                    <Button onClick={() => void onInitGit()} disabled={operating} size="sm">
                        {operating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Initialize Git"}
                    </Button>
                </div>
            )}

            {/* Initialized but No Remote */}
            {gitStatus.initialized && !gitStatus.hasRemote && (
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
                            onClick={() => void onSetupRemote(repoUrl.trim(), branch.trim())}
                            disabled={!repoUrl.trim() || operating}
                            size="sm"
                        >
                            {operating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
                        Uses local git credentials (SSH or credential helper)
                    </p>
                </div>
            )}
        </div>
    );
}
