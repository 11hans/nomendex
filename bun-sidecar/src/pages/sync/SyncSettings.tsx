import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTheme } from "@/hooks/useTheme";
import { ChevronDown, Settings, Key, ExternalLink } from "lucide-react";

interface AutoSyncConfig {
    enabled: boolean;
    paused: boolean;
    intervalSeconds: number;
    syncOnChanges: boolean;
}

interface SyncSettingsProps {
    autoSync: AutoSyncConfig;
    setAutoSyncConfig: (config: Partial<AutoSyncConfig>) => void;
    gitAuthMode: "local" | "pat";
    setGitAuthMode: (mode: "local" | "pat") => void;
    lastSynced: Date | null;
    hasPAT: boolean;
}

export function SyncSettings({
    autoSync,
    setAutoSyncConfig,
    gitAuthMode,
    setGitAuthMode,
    lastSynced,
    hasPAT,
}: SyncSettingsProps) {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const { currentTheme } = useTheme();

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                <Settings className="h-3.5 w-3.5" />
                <span>Settings</span>
                <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="space-y-4 pt-2">
                    {/* Auth Mode */}
                    <div className="border rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium">Authentication Mode</div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {gitAuthMode === "local"
                                        ? "Using local git credentials (SSH keys or credential helper)"
                                        : "Using GitHub Personal Access Token"}
                                </p>
                            </div>
                            <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                                <button
                                    onClick={() => setGitAuthMode("local")}
                                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                                        gitAuthMode === "local"
                                            ? "bg-background shadow-sm font-medium"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    Local
                                </button>
                                <button
                                    onClick={() => setGitAuthMode("pat")}
                                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                                        gitAuthMode === "pat"
                                            ? "bg-background shadow-sm font-medium"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    PAT
                                </button>
                            </div>
                        </div>

                        {gitAuthMode === "pat" && !hasPAT && (
                            <div className="mt-3 pt-3 border-t space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    Create a PAT with 'repo' scope to enable sync:
                                </p>
                                <div className="flex items-center gap-2">
                                    <a
                                        href="https://github.com/settings/tokens/new?scopes=repo&description=Nomendex%20Sync"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-primary hover:underline flex items-center gap-1"
                                    >
                                        Create token on GitHub
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
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
                    </div>

                    {/* Auto-Sync */}
                    <div className="border rounded-lg p-4 space-y-4">
                        <div className="text-sm font-medium">Auto-Sync</div>

                        {/* Pause toggle */}
                        {autoSync.enabled && (
                            <div className={`flex items-center justify-between p-3 rounded-md ${autoSync.paused ? "bg-warning/10 border border-warning/30" : "bg-muted/30"}`}>
                                <div>
                                    <div className={`text-sm font-medium ${autoSync.paused ? "text-warning" : ""}`}>
                                        {autoSync.paused ? "Sync Paused" : "Sync Active"}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {autoSync.paused ? "Auto-sync is temporarily paused" : "Pause to prevent automatic syncing"}
                                    </p>
                                </div>
                                <Button
                                    variant={autoSync.paused ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setAutoSyncConfig({ paused: !autoSync.paused })}
                                >
                                    {autoSync.paused ? "Resume" : "Pause"}
                                </Button>
                            </div>
                        )}

                        {/* Enable toggle */}
                        <ToggleRow
                            label="Enable Auto-Sync"
                            description="Automatically sync on a schedule"
                            checked={autoSync.enabled}
                            onChange={(v) => setAutoSyncConfig({ enabled: v })}
                            theme={currentTheme}
                        />

                        {/* Sync on changes */}
                        {autoSync.enabled && (
                            <ToggleRow
                                label="Sync on Changes"
                                description="Automatically sync when files change (5s debounce)"
                                checked={autoSync.syncOnChanges}
                                onChange={(v) => setAutoSyncConfig({ syncOnChanges: v })}
                                theme={currentTheme}
                            />
                        )}

                        {/* Interval */}
                        {autoSync.enabled && (
                            <div>
                                <Label className="text-xs text-muted-foreground">Sync Interval (seconds)</Label>
                                <Input
                                    type="number"
                                    min="10"
                                    max="3600"
                                    value={autoSync.intervalSeconds}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        if (value >= 10 && value <= 3600) {
                                            setAutoSyncConfig({ intervalSeconds: value });
                                        }
                                    }}
                                    className="font-mono text-sm w-32 mt-1.5"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Range: 10-3600 seconds
                                </p>
                            </div>
                        )}

                        {autoSync.enabled && lastSynced && (
                            <p className="text-xs text-muted-foreground">
                                Last synced: {lastSynced.toLocaleTimeString()}
                            </p>
                        )}
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

interface ToggleRowProps {
    label: string;
    description: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    theme: ReturnType<typeof useTheme>["currentTheme"];
}

function ToggleRow({ label, description, checked, onChange, theme }: ToggleRowProps) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <div className="text-sm">{label}</div>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <button
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    checked ? "bg-sky-500" : "bg-muted border border-border"
                }`}
                style={
                    checked
                        ? { boxShadow: "0 0 0 1px rgba(14, 165, 233, 0.45), 0 0 14px rgba(14, 165, 233, 0.35)" }
                        : undefined
                }
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        checked ? "translate-x-6 border" : "translate-x-1 bg-white"
                    }`}
                    style={
                        checked
                            ? { backgroundColor: theme.styles.semanticPrimary, borderColor: theme.styles.semanticPrimary }
                            : undefined
                    }
                />
            </button>
        </div>
    );
}
