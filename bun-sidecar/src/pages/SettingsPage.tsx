import { useState, useEffect, useCallback } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useKeyboardShortcuts } from "@/contexts/KeyboardShortcutsContext";
import { KeyboardIndicator } from "@/components/ui/keyboard-indicator";
import { useTheme } from "@/hooks/useTheme";
import { triggerNativeUpdate } from "@/hooks/useUpdateNotification";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { RotateCcw, Eye, EyeOff, Check, X, Key, RefreshCw, Info, Plus, Trash2, FolderOpen, Brain, Loader2, ExternalLink, CalendarDays, LayoutGrid } from "lucide-react";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import type { NotesLocation, DateFormat } from "@/types/Workspace";

type SecretInfo = {
    key: string;
    label: string;
    description: string;
    placeholder: string;
    helpText: string;
    hasValue: boolean;
    maskedValue: string;
    isPredefined: boolean;
};

const SUGGESTED_FREE_MODELS = [
    { id: "xiaomi/mimo-v2-flash:free", label: "MiMo-V2-Flash (309B, free)" },
    { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)" },
    { id: "google/gemini-2.5-flash-preview:free", label: "Gemini 2.5 Flash (free)" },
    { id: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (free)" },
    { id: "meta-llama/llama-3.1-70b-instruct:free", label: "Llama 3.1 70B (free)" },
];

type TestResult = {
    candidates: Array<{ kind: string; title: string; importance: number }>;
    providerUsed: string;
    durationMs: number;
};

function MemoryExtractionSettings() {
    const { memoryExtraction, setMemoryExtraction } = useWorkspaceContext();
    const { currentTheme } = useTheme();

    const [provider, setProvider] = useState(memoryExtraction.provider);
    const [model, setModel] = useState(memoryExtraction.openRouterModel);
    const [apiKey, setApiKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [testError, setTestError] = useState<string | null>(null);

    // Load current hasApiKey status
    useEffect(() => {
        fetch("/api/memory-extraction/config")
            .then((r) => r.json())
            .then((data: { hasApiKey?: boolean }) => {
                if (typeof data.hasApiKey === "boolean") setHasApiKey(data.hasApiKey);
            })
            .catch(() => {});
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        setTestResult(null);
        setTestError(null);
        try {
            const body: Record<string, string | null> = { provider, openRouterModel: model };
            if (apiKey) body.openRouterApiKey = apiKey;
            const res = await fetch("/api/memory-extraction/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { success?: boolean; hasApiKey?: boolean; error?: string };
            if (!res.ok) throw new Error(data.error ?? "Save failed");
            setMemoryExtraction({ ...memoryExtraction, provider, openRouterModel: model });
            if (typeof data.hasApiKey === "boolean") setHasApiKey(data.hasApiKey);
            if (apiKey) setApiKey("");
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            console.error("Failed to save memory extraction config", err);
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        setTestError(null);
        try {
            const body: Record<string, string> = { provider, model };
            if (apiKey) body.apiKey = apiKey;
            const res = await fetch("/api/memory-extraction/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json() as TestResult & { error?: string };
            if (!res.ok) throw new Error(data.error ?? "Test failed");
            setTestResult(data);
        } catch (err) {
            setTestError(err instanceof Error ? err.message : "Test failed");
        } finally {
            setTesting(false);
        }
    };

    const isDirty =
        provider !== memoryExtraction.provider ||
        model !== memoryExtraction.openRouterModel ||
        apiKey.length > 0;

    const canTest = provider !== "disabled" && (provider === "claude" || hasApiKey || apiKey.length > 0);

    return (
        <div className="space-y-3">
            <Card className="rounded-lg border-border shadow-none">
                <CardHeader className="p-3 pb-2">
                    <CardTitle className="flex items-center gap-2">
                        <Brain className="h-4 w-4" />
                        Memory Extraction
                    </CardTitle>
                    <CardDescription>
                        Automatically extract and save memories from BPagent sessions using an AI model.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Provider select */}
                    <div className="space-y-1.5">
                        <Label>Provider</Label>
                        <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
                            <SelectTrigger className="h-7 w-48">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="disabled">Disabled</SelectItem>
                                <SelectItem value="openrouter">OpenRouter</SelectItem>
                                <SelectItem value="claude">Claude (Haiku)</SelectItem>
                            </SelectContent>
                        </Select>
                        {provider === "disabled" && (
                            <p className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                                Memories are only saved when BPagent explicitly calls memory_save.
                            </p>
                        )}
                        {provider === "claude" && (
                            <p className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                                Uses your existing Claude API key (claude-haiku-4-5). Charged per token.
                            </p>
                        )}
                    </div>

                    {/* OpenRouter config */}
                    {provider === "openrouter" && (
                        <>
                            <div className="space-y-1.5">
                                <Label>API Key</Label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Input
                                            type={showKey ? "text" : "password"}
                                            placeholder={hasApiKey ? "sk-or-v1-••••••••••••••••••••" : "sk-or-v1-..."}
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            className="h-7 pr-8 font-mono"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowKey((v) => !v)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                        </button>
                                    </div>
                                </div>
                                <p className="text-caption flex items-center gap-1" style={{ color: currentTheme.styles.contentTertiary }}>
                                    {hasApiKey && !apiKey ? (
                                        <><Check className="h-3 w-3 text-green-500" /> API key configured</>
                                    ) : (
                                        <>Get a free key at openrouter.ai — no credit card required</>
                                    )}
                                </p>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Model</Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        className="h-7 font-mono flex-1"
                                        placeholder="xiaomi/mimo-v2-flash:free"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {SUGGESTED_FREE_MODELS.map((m) => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => setModel(m.id)}
                                            className="text-caption px-1.5 py-0.5 rounded border border-border hover:bg-secondary transition-colors"
                                            style={{
                                                color: model === m.id
                                                    ? currentTheme.styles.contentPrimary
                                                    : currentTheme.styles.contentTertiary,
                                                borderColor: model === m.id ? currentTheme.styles.borderAccent : undefined,
                                            }}
                                        >
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                        <Button
                            size="sm"
                            className="h-7 px-3"
                            onClick={handleSave}
                            disabled={saving || !isDirty}
                        >
                            {saving ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : saved ? <Check className="h-3 w-3 mr-1.5" /> : null}
                            {saved ? "Saved" : "Save"}
                        </Button>
                        {provider !== "disabled" && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3"
                                onClick={handleTest}
                                disabled={testing || !canTest}
                            >
                                {testing ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <ExternalLink className="h-3 w-3 mr-1.5" />}
                                Test
                            </Button>
                        )}
                    </div>

                    {/* Test result */}
                    {testError && (
                        <div className="text-caption p-2 rounded border border-red-200 bg-red-50 text-red-700">
                            {testError}
                        </div>
                    )}
                    {testResult && (
                        <div className="space-y-1.5">
                            <p className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                                {testResult.candidates.length} memories extracted in {testResult.durationMs}ms via {testResult.providerUsed}
                            </p>
                            {testResult.candidates.length > 0 && (
                                <div className="space-y-1">
                                    {testResult.candidates.map((c, i) => (
                                        <div
                                            key={i}
                                            className="flex items-center gap-2 p-1.5 rounded border border-border text-caption"
                                        >
                                            <span className="px-1 rounded bg-secondary font-mono" style={{ color: currentTheme.styles.contentSecondary }}>
                                                {c.kind}
                                            </span>
                                            <span className="flex-1 truncate">{c.title}</span>
                                            <span style={{ color: currentTheme.styles.contentTertiary }}>{Math.round(c.importance * 100)}%</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function MemoryEmbeddingsSettings() {
    const { embeddings, setEmbeddings } = useWorkspaceContext();
    const { currentTheme } = useTheme();

    const [provider, setProvider] = useState(embeddings.provider);
    const [apiKey, setApiKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/memory-embeddings/config")
            .then((r) => r.json())
            .then((data: { hasApiKey?: boolean }) => {
                if (typeof data.hasApiKey === "boolean") setHasApiKey(data.hasApiKey);
            })
            .catch(() => {});
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const body: Record<string, string | null> = { provider };
            if (apiKey) body.voyageApiKey = apiKey;
            const res = await fetch("/api/memory-embeddings/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { success?: boolean; hasApiKey?: boolean; error?: string };
            if (!res.ok) throw new Error(data.error ?? "Save failed");
            setEmbeddings({ provider });
            if (typeof data.hasApiKey === "boolean") setHasApiKey(data.hasApiKey);
            if (apiKey) setApiKey("");
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const isDirty = provider !== embeddings.provider || apiKey.length > 0;
    const needsKey = provider === "voyage" && !hasApiKey && !apiKey;

    return (
        <Card className="rounded-lg border-border shadow-none">
            <CardHeader className="p-3 pb-2">
                <CardTitle className="flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    Semantic Search (Embeddings)
                </CardTitle>
                <CardDescription>
                    Optional vector search for memory recall via Voyage AI. Memory contents leave your workspace when enabled.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <Select value={provider} onValueChange={(v) => setProvider(v as typeof provider)}>
                        <SelectTrigger className="h-7 w-48">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="disabled">Disabled</SelectItem>
                            <SelectItem value="voyage">Voyage AI</SelectItem>
                        </SelectContent>
                    </Select>
                    {provider === "disabled" && (
                        <p className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                            Only keyword search is used. Memory contents stay in your workspace.
                        </p>
                    )}
                    {provider === "voyage" && (
                        <p className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                            Uses voyage-3-lite (512 dims). Roughly $0.01 one-time per 1000 memories. Search falls back to keyword if the API fails.
                        </p>
                    )}
                </div>

                {provider === "voyage" && (
                    <div className="space-y-1.5">
                        <Label>Voyage API Key</Label>
                        <div className="relative">
                            <Input
                                type={showKey ? "text" : "password"}
                                placeholder={hasApiKey ? "pa-••••••••••••••••••••" : "pa-..."}
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="h-7 pr-8 font-mono"
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                        </div>
                        <p className="text-caption flex items-center gap-1" style={{ color: currentTheme.styles.contentTertiary }}>
                            {hasApiKey && !apiKey ? (
                                <><Check className="h-3 w-3 text-green-500" /> API key configured</>
                            ) : (
                                <>Get a key at voyageai.com</>
                            )}
                        </p>
                    </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                    <Button
                        size="sm"
                        className="h-7 px-3"
                        onClick={handleSave}
                        disabled={saving || !isDirty || needsKey}
                    >
                        {saving ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : saved ? <Check className="h-3 w-3 mr-1.5" /> : null}
                        {saved ? "Saved" : "Save"}
                    </Button>
                </div>

                {error && (
                    <div className="text-caption p-2 rounded border border-red-200 bg-red-50 text-red-700">
                        {error}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function StorageSettings() {
    const { notesLocation, setNotesLocation, showHiddenFiles, setShowHiddenFiles } = useWorkspaceContext();
    const [pendingChange, setPendingChange] = useState<NotesLocation | null>(null);
    const [pendingHiddenFiles, setPendingHiddenFiles] = useState<boolean | null>(null);
    const [savingHiddenFiles, setSavingHiddenFiles] = useState(false);
    const [savedHiddenFiles, setSavedHiddenFiles] = useState(false);

    const handleNotesLocationChange = (value: string) => {
        const newLocation = value as NotesLocation;
        setPendingChange(newLocation);
    };

    const applyChange = async () => {
        if (pendingChange) {
            setNotesLocation(pendingChange);
            setPendingChange(null);
            // Wait a moment for the workspace state to save, then reinitialize paths on the server
            await new Promise(resolve => setTimeout(resolve, 100));
            await fetch("/api/workspace/reinitialize", { method: "POST" });
            // Reload the page to pick up the new paths
            window.location.reload();
        }
    };

    const cancelChange = () => {
        setPendingChange(null);
    };

    const handleSaveHiddenFiles = async () => {
        if (pendingHiddenFiles === null) return;
        setSavingHiddenFiles(true);
        setSavedHiddenFiles(false);
        try {
            setShowHiddenFiles(pendingHiddenFiles);
            setSavedHiddenFiles(true);
            setPendingHiddenFiles(null);
            setTimeout(() => setSavedHiddenFiles(false), 2000);
        } finally {
            setSavingHiddenFiles(false);
        }
    };

    const displayValue = pendingChange ?? notesLocation;
    const displayHiddenFiles = pendingHiddenFiles ?? showHiddenFiles;
    const hasUnsavedHiddenFiles = pendingHiddenFiles !== null && pendingHiddenFiles !== showHiddenFiles;

    return (
        <Card className="rounded-lg border-border shadow-none">
            <CardHeader className="p-3 pb-2">
                <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Storage Settings
                </CardTitle>
                <CardDescription>
                    Configure where your files are stored in the workspace
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-3 pt-0">
                <div
                    className="p-3 rounded-lg border bg-secondary border-border"
                >
                    <h4 className="font-medium mb-2">
                        Notes Location
                    </h4>
                    <p className="text-sm mb-4 text-muted-foreground">
                        Choose where notes are stored in your workspace. Use "Workspace Root" for Obsidian compatibility.
                    </p>

                    <RadioGroup
                        value={displayValue}
                        onValueChange={handleNotesLocationChange}
                        className="space-y-3"
                    >
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="subfolder" id="subfolder" className="mt-1" />
                            <div className="flex-1">
                                <Label htmlFor="subfolder" className="font-medium cursor-pointer">
                                    Notes Subfolder
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Store notes in <code className="px-1 py-0.5 rounded bg-surface-elevated">/notes</code> subfolder
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="root" id="root" className="mt-1" />
                            <div className="flex-1">
                                <Label htmlFor="root" className="font-medium cursor-pointer">
                                    Workspace Root
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Store notes at workspace root (default, Obsidian-compatible)
                                </p>
                            </div>
                        </div>
                    </RadioGroup>

                    {pendingChange && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <p className="text-sm mb-3 text-muted-foreground">
                                Changing notes location requires a page reload. Your existing notes will not be moved automatically.
                            </p>
                            <div className="flex gap-2">
                                <Button size="sm" className="h-7 px-2 text-xs" onClick={applyChange}>
                                    Apply & Reload
                                </Button>
                                <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" onClick={cancelChange}>
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}
                </div>


                {/* Show Hidden Files Setting */}
                <div
                    className="p-3 rounded-lg border bg-secondary border-border"
                >
                    <h4 className="font-medium mb-2">
                        Show Hidden Files
                    </h4>
                    <p className="text-sm mb-4 text-muted-foreground">
                        Show or hide files and folders that start with a dot (.) in the notes browser.
                    </p>

                    <RadioGroup
                        value={displayHiddenFiles ? "show" : "hide"}
                        onValueChange={(value) => setPendingHiddenFiles(value === "show")}
                        className="space-y-3"
                    >
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="hide" id="hide-hidden" className="mt-1" />
                            <div className="flex-1">
                                <Label htmlFor="hide-hidden" className="font-medium cursor-pointer">
                                    Hide Hidden Files
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Files and folders starting with . are hidden (default)
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start space-x-3">
                            <RadioGroupItem value="show" id="show-hidden" className="mt-1" />
                            <div className="flex-1">
                                <Label htmlFor="show-hidden" className="font-medium cursor-pointer">
                                    Show Hidden Files
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    All files and folders are visible, including hidden ones
                                </p>
                            </div>
                        </div>
                    </RadioGroup>

                    {hasUnsavedHiddenFiles && (
                        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                            <Button
                                onClick={handleSaveHiddenFiles}
                                disabled={savingHiddenFiles}
                                size="sm"
                                className="h-7 px-2 text-xs"
                            >
                                {savingHiddenFiles ? "Saving..." : "Save"}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setPendingHiddenFiles(null)}
                            >
                                Cancel
                            </Button>
                        </div>
                    )}
                    {savedHiddenFiles && (
                        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                            <Check className="h-4 w-4 text-success" />
                            <span className="text-sm text-success">
                                Saved successfully
                            </span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

type ChannelsSettingsResponse = {
    telegram: {
        enabled: boolean;
        allowlist: string[];
        autoReplyEnabled: boolean;
        telegramAgentId: string;
        fallbackText: string;
        timeZone: string;
        pollingTimeoutSec: number;
        hasToken: boolean;
    };
};

type ChannelsStatusResponse = {
    status: { running: boolean; connected: boolean; lastError: string | null };
    telegram: {
        enabled: boolean;
        hasToken: boolean;
        autoReplyEnabled: boolean;
        allowlistSize: number;
        timeZone: string;
        pollingTimeoutSec: number;
        lastUpdateId: number;
        telegramThreadCount: number;
    };
    ai: {
        hasClaudeOauthToken: boolean;
    };
};

function ChannelsSettings() {
    const [settings, setSettings] = useState<ChannelsSettingsResponse | null>(null);
    const [status, setStatus] = useState<ChannelsStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [refreshingStatus, setRefreshingStatus] = useState(false);
    const [allowlistText, setAllowlistText] = useState("");

    const loadStatus = useCallback(async () => {
        try {
            setRefreshingStatus(true);
            const response = await fetch("/api/channels/status");
            if (!response.ok) throw new Error("Failed to load channels status");
            const data = await response.json();
            setStatus(data);
        } catch (error) {
            console.error("Failed to load channel status:", error);
        } finally {
            setRefreshingStatus(false);
        }
    }, []);

    useEffect(() => {
        async function loadChannels() {
            try {
                setLoading(true);
                const response = await fetch("/api/channels/settings");
                if (!response.ok) throw new Error("Failed to load channels settings");
                const data = await response.json();
                setSettings(data.settings);
                setAllowlistText((data.settings?.telegram?.allowlist || []).join("\n"));
                await loadStatus();
            } catch (error) {
                console.error("Failed to load channel settings:", error);
            } finally {
                setLoading(false);
            }
        }

        void loadChannels();
    }, [loadStatus]);

    const save = async () => {
        if (!settings) return;
        try {
            setSaving(true);
            // Only patchable keys — ChannelsSettingsPatchSchema is strict
            const payload = {
                telegram: {
                    enabled: settings.telegram.enabled,
                    autoReplyEnabled: settings.telegram.autoReplyEnabled,
                    allowlist: allowlistText
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                    telegramAgentId: settings.telegram.telegramAgentId,
                    fallbackText: settings.telegram.fallbackText,
                    timeZone: settings.telegram.timeZone,
                },
            };

            const response = await fetch("/api/channels/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!response.ok) throw new Error("Failed to save channel settings");
            const data = await response.json();
            setSettings(data.settings);
            setAllowlistText((data.settings?.telegram?.allowlist || []).join("\n"));
            await loadStatus();
        } catch (error) {
            console.error("Failed to save channel settings:", error);
        } finally {
            setSaving(false);
        }
    };

    if (loading || !settings) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Channels</CardTitle>
                    <CardDescription>Loading channel settings...</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Channels</CardTitle>
                <CardDescription>Configure Telegram integration and auto-reply policy</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {status && (
                    <div className="rounded border border-border p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">Runtime status</div>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void loadStatus()}>
                                {refreshingStatus ? "Refreshing..." : "Refresh status"}
                            </Button>
                        </div>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px]">
                            <div>running: <strong>{String(status.status.running)}</strong></div>
                            <div>connected: <strong>{String(status.status.connected)}</strong></div>
                            <div>hasToken: <strong>{String(status.telegram.hasToken)}</strong></div>
                            <div>lastUpdateId: <strong>{status.telegram.lastUpdateId}</strong></div>
                            <div>threads: <strong>{status.telegram.telegramThreadCount}</strong></div>
                            <div>allowlist size: <strong>{status.telegram.allowlistSize}</strong></div>
                            <div>Claude token present: <strong>{String(status.ai.hasClaudeOauthToken)}</strong></div>
                            <div>timezone: <strong>{status.telegram.timeZone}</strong></div>
                            <div>poll timeout: <strong>{status.telegram.pollingTimeoutSec}s</strong></div>
                        </div>
                        {status.status.lastError && (
                            <div className="mt-2 text-destructive">
                                lastError: {status.status.lastError}
                            </div>
                        )}
                        <div className="mt-1 text-muted-foreground">
                            V1 supports only Telegram DM text messages.
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="telegram-enabled">Telegram Enabled</Label>
                        <Switch
                            id="telegram-enabled"
                            checked={settings.telegram.enabled}
                            onCheckedChange={(checked) =>
                                setSettings((prev) =>
                                    prev
                                        ? { ...prev, telegram: { ...prev.telegram, enabled: checked } }
                                        : prev
                                )
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="telegram-auto-reply">Telegram Auto-Reply</Label>
                        <Switch
                            id="telegram-auto-reply"
                            checked={settings.telegram.autoReplyEnabled}
                            onCheckedChange={(checked) =>
                                setSettings((prev) =>
                                    prev
                                        ? { ...prev, telegram: { ...prev.telegram, autoReplyEnabled: checked } }
                                        : prev
                                )
                            }
                        />
                    </div>
                </div>

                <p className="text-xs text-muted-foreground">
                    Bot token status: <strong>{settings.telegram.hasToken ? "configured" : "missing"}</strong>.
                    Add it in the <strong>API Keys</strong> tab under <code>TELEGRAM_BOT_TOKEN</code>.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="telegram-agent-id">Telegram Agent ID</Label>
                        <Input
                            id="telegram-agent-id"
                            value={settings.telegram.telegramAgentId}
                            onChange={(e) =>
                                setSettings((prev) =>
                                    prev
                                        ? { ...prev, telegram: { ...prev.telegram, telegramAgentId: e.target.value } }
                                        : prev
                                )
                            }
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="telegram-timezone">Time Zone</Label>
                        <Input
                            id="telegram-timezone"
                            value={settings.telegram.timeZone}
                            onChange={(e) =>
                                setSettings((prev) =>
                                    prev
                                        ? { ...prev, telegram: { ...prev.telegram, timeZone: e.target.value } }
                                        : prev
                                )
                            }
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="telegram-allowlist">Allowlist (one chat ID or username per line)</Label>
                    <Textarea
                        id="telegram-allowlist"
                        value={allowlistText}
                        onChange={(e) => setAllowlistText(e.target.value)}
                        rows={5}
                    />
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="telegram-fallback">Fallback Reply Text</Label>
                    <Textarea
                        id="telegram-fallback"
                        value={settings.telegram.fallbackText}
                        onChange={(e) =>
                            setSettings((prev) =>
                                prev
                                    ? { ...prev, telegram: { ...prev.telegram, fallbackText: e.target.value } }
                                    : prev
                            )
                        }
                        rows={3}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <Button onClick={save} disabled={saving}>
                        {saving ? "Saving..." : "Save Channels Settings"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function SettingsContent() {
    const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
    const [recordingKeys, setRecordingKeys] = useState<string[]>([]);
    const { setTheme, themes, currentTheme } = useTheme();
    const { shortcuts, updateShortcut, resetShortcut, resetAllShortcuts } = useKeyboardShortcuts();
    const { chatInputEnterToSend, setChatInputEnterToSend, workspace, appleCalendarSync, setAppleCalendarSync, updateWorkspace, dateFormat, setDateFormat } = useWorkspaceContext();

    // Local state for pending preference change
    const [pendingEnterToSend, setPendingEnterToSend] = useState<boolean | null>(null);
    const [savingPreference, setSavingPreference] = useState(false);
    const [savedPreference, setSavedPreference] = useState(false);

    // Debug logging
    useEffect(() => {
        console.log("[Preferences] chatInputEnterToSend from context:", chatInputEnterToSend);
        console.log("[Preferences] Full workspace state:", workspace);
    }, [chatInputEnterToSend, workspace]);

    const handleSavePreference = async () => {
        if (pendingEnterToSend === null) return;

        console.log("[Preferences] Saving chatInputEnterToSend:", pendingEnterToSend);
        setSavingPreference(true);
        setSavedPreference(false);

        try {
            // Fetch current workspace state from server
            const fetchResponse = await fetch("/api/workspace");
            const fetchResult = await fetchResponse.json();
            console.log("[Preferences] Current workspace from server:", fetchResult);

            if (!fetchResult.success) {
                throw new Error("Failed to fetch current workspace");
            }

            // Merge with new preference
            const updatedWorkspace = {
                ...fetchResult.data,
                chatInputEnterToSend: pendingEnterToSend,
            };
            console.log("[Preferences] Saving updated workspace:", updatedWorkspace);

            // Save directly to API
            const saveResponse = await fetch("/api/workspace", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updatedWorkspace),
            });
            const saveResult = await saveResponse.json();
            console.log("[Preferences] Save response:", saveResult);

            if (!saveResult.success) {
                throw new Error("Failed to save workspace");
            }

            // Update local state
            setChatInputEnterToSend(pendingEnterToSend);

            console.log("[Preferences] Save complete");
            setSavedPreference(true);
            setPendingEnterToSend(null);
            // Clear the saved indicator after 2 seconds
            setTimeout(() => setSavedPreference(false), 2000);
        } catch (error) {
            console.error("[Preferences] Save failed:", error);
        } finally {
            setSavingPreference(false);
        }
    };

    const currentValue = pendingEnterToSend !== null ? pendingEnterToSend : chatInputEnterToSend;
    const hasUnsavedChanges = pendingEnterToSend !== null && pendingEnterToSend !== chatInputEnterToSend;

    // Secrets state
    const [secrets, setSecrets] = useState<SecretInfo[]>([]);
    const [editingSecret, setEditingSecret] = useState<string | null>(null);
    const [secretValue, setSecretValue] = useState("");
    const [showSecretValue, setShowSecretValue] = useState(false);
    const [secretsLoading, setSecretsLoading] = useState(true);
    const [savingSecret, setSavingSecret] = useState(false);

    // New custom secret state
    const [isAddingCustom, setIsAddingCustom] = useState(false);
    const [newSecretKey, setNewSecretKey] = useState("");
    const [newSecretValue, setNewSecretValue] = useState("");
    const [showNewSecretValue, setShowNewSecretValue] = useState(false);
    const [newSecretError, setNewSecretError] = useState("");

    // Version state
    const [versionInfo, setVersionInfo] = useState<{ version: string; buildNumber: string } | null>(null);
    const [checkingForUpdates, setCheckingForUpdates] = useState(false);

    // Load secrets on mount
    useEffect(() => {
        async function loadSecrets() {
            try {
                const response = await fetch("/api/secrets/list");
                if (response.ok) {
                    const data = await response.json();
                    setSecrets(data.secrets);
                }
            } catch (error) {
                console.error("Failed to load secrets:", error);
            } finally {
                setSecretsLoading(false);
            }
        }
        loadSecrets();
    }, []);

    // Load version info on mount
    useEffect(() => {
        async function loadVersion() {
            try {
                const response = await fetch("/api/version");
                if (response.ok) {
                    const data = await response.json();
                    setVersionInfo(data);
                }
            } catch (error) {
                console.error("Failed to load version:", error);
            }
        }
        loadVersion();
    }, []);

    // Trigger native Sparkle update check (shows UI)
    const handleCheckForUpdates = () => {
        setCheckingForUpdates(true);
        triggerNativeUpdate();
        // Reset after a short delay (Sparkle UI will take over)
        setTimeout(() => setCheckingForUpdates(false), 1000);
    };

    const handleSaveSecret = async (key: string) => {
        setSavingSecret(true);
        try {
            const response = await fetch("/api/secrets/set", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key, value: secretValue }),
            });
            if (response.ok) {
                const result = await response.json();
                setSecrets((prev) =>
                    prev.map((s) =>
                        s.key === key
                            ? { ...s, hasValue: result.hasValue, maskedValue: result.maskedValue }
                            : s
                    )
                );
                setEditingSecret(null);
                setSecretValue("");
                setShowSecretValue(false);
            }
        } catch (error) {
            console.error("Failed to save secret:", error);
        } finally {
            setSavingSecret(false);
        }
    };

    const handleDeleteSecret = async (key: string, isPredefined: boolean) => {
        try {
            const response = await fetch("/api/secrets/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key }),
            });
            if (response.ok) {
                if (isPredefined) {
                    // For predefined, just clear the value
                    setSecrets((prev) =>
                        prev.map((s) =>
                            s.key === key ? { ...s, hasValue: false, maskedValue: "" } : s
                        )
                    );
                } else {
                    // For custom, remove from the list entirely
                    setSecrets((prev) => prev.filter((s) => s.key !== key));
                }
            }
        } catch (error) {
            console.error("Failed to delete secret:", error);
        }
    };

    const handleAddCustomSecret = async () => {
        // Validate key format
        if (!newSecretKey.trim()) {
            setNewSecretError("Key is required");
            return;
        }

        const formattedKey = newSecretKey.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
        if (!/^[A-Z][A-Z0-9_]*$/.test(formattedKey)) {
            setNewSecretError("Key must start with a letter and contain only letters, numbers, and underscores");
            return;
        }

        // Check if key already exists
        if (secrets.some((s) => s.key === formattedKey)) {
            setNewSecretError("A secret with this key already exists");
            return;
        }

        if (!newSecretValue.trim()) {
            setNewSecretError("Value is required");
            return;
        }

        setSavingSecret(true);
        setNewSecretError("");

        try {
            const response = await fetch("/api/secrets/set", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: formattedKey, value: newSecretValue }),
            });

            if (response.ok) {
                const result = await response.json();
                setSecrets((prev) => [
                    ...prev,
                    {
                        key: formattedKey,
                        label: formattedKey,
                        description: "Custom API key",
                        placeholder: "",
                        helpText: "",
                        hasValue: result.hasValue,
                        maskedValue: result.maskedValue,
                        isPredefined: false,
                    },
                ]);
                setIsAddingCustom(false);
                setNewSecretKey("");
                setNewSecretValue("");
                setShowNewSecretValue(false);
            } else {
                const error = await response.json();
                setNewSecretError(error.error || "Failed to save secret");
            }
        } catch (error) {
            console.error("Failed to save custom secret:", error);
            setNewSecretError("Failed to save secret");
        } finally {
            setSavingSecret(false);
        }
    };

    // Handle keyboard recording for shortcut editing
    useEffect(() => {
        if (!editingShortcut) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const keys: string[] = [];
            if (e.metaKey) keys.push("cmd");
            if (e.ctrlKey && !e.metaKey) keys.push("ctrl");
            if (e.altKey) keys.push("alt");
            if (e.shiftKey) keys.push("shift");

            // Normalize key names
            let key = e.key.toLowerCase();
            if (key === "[") key = "bracketleft";
            if (key === "]") key = "bracketright";
            if (key === "arrowleft") key = "left";
            if (key === "arrowright") key = "right";
            if (key === "arrowup") key = "up";
            if (key === "arrowdown") key = "down";

            if (!["meta", "control", "alt", "shift"].includes(e.key.toLowerCase())) {
                keys.push(key);
            }

            if (keys.length > 0 && keys.some(k => !["cmd", "ctrl", "alt", "shift"].includes(k))) {
                setRecordingKeys(keys);
            }
        };

        const handleKeyUp = (_e: KeyboardEvent) => {
            if (recordingKeys.length > 0) {
                updateShortcut(editingShortcut, recordingKeys);
                setEditingShortcut(null);
                setRecordingKeys([]);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("keyup", handleKeyUp);
        };
    }, [editingShortcut, recordingKeys, updateShortcut]);

    const categoryLabels = {
        tabs: "Tab Management",
        navigation: "Navigation",
        workspace: "Workspace",
        custom: "Custom",
        editor: "Editor (Tables)",
    };
    const customShortcutCount = shortcuts.filter((shortcut) => !!shortcut.customKeys).length;
    const configuredSecretsCount = secrets.filter((secret) => secret.hasValue).length;
    const totalSecretCount = secrets.length;

    return (
        <div
            className="h-full min-h-0 overflow-y-auto [&_.text-base]:text-xs [&_.text-sm]:text-caption [&_.text-xs]:text-caption [&_.md\\:text-sm]:md:text-caption [&_[data-slot=card]]:rounded-lg [&_[data-slot=card]]:shadow-none [&_[data-slot=card-header]]:!p-3 [&_[data-slot=card-header]]:!pb-2 [&_[data-slot=card-content]]:!p-3 [&_[data-slot=card-content]]:!pt-0 [&_[data-slot=card-footer]]:!p-3 [&_[data-slot=card-footer]]:!pt-0 [&_[data-slot=card-title]]:text-xs [&_[data-slot=card-description]]:text-caption [&_[data-slot=tabs-trigger]]:text-caption [&_[data-slot=button]]:text-caption [&_[data-slot=input]]:text-caption [&_[data-slot=select-trigger]]:text-caption [&_[data-slot=select-item]]:text-caption [&_[data-slot=table]]:text-caption [&_[data-slot=table-head]]:h-8 [&_[data-slot=table-cell]]:py-1.5 [&_h3]:text-xs [&_h4]:text-xs [&_label]:text-caption [&_th]:text-caption [&_td]:text-caption"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}
        >
            <div className="mx-auto w-full max-w-[980px] px-3 pt-3 pb-6 space-y-2.5">
                <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                    <Info className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                    <span className="text-xs font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentPrimary }}>
                        Settings
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        {shortcuts.length} shortcuts
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        {customShortcutCount} custom
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        {configuredSecretsCount}/{totalSecretCount || 0} keys
                    </span>
                </div>

                <Tabs defaultValue="keyboard" className="space-y-3">
                    <TabsList className="h-auto flex-wrap justify-start rounded-xl border border-border bg-bg-secondary p-1 [&_[data-slot=tabs-trigger]]:h-7 [&_[data-slot=tabs-trigger]]:text-caption">
                        <TabsTrigger value="keyboard">Keyboard Shortcuts</TabsTrigger>
                        <TabsTrigger value="preferences">Preferences</TabsTrigger>
                        <TabsTrigger value="theme">Theme</TabsTrigger>
                        <TabsTrigger value="secrets">API Keys</TabsTrigger>
                        <TabsTrigger value="channels">Channels</TabsTrigger>
                        <TabsTrigger value="memory">Memory</TabsTrigger>
                        <TabsTrigger value="storage">Storage</TabsTrigger>
                        <TabsTrigger value="about">About</TabsTrigger>
                    </TabsList>

                    <TabsContent value="keyboard" className="mt-0">
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle>Keyboard Shortcuts</CardTitle>
                                        <CardDescription>Customize keyboard shortcuts for common actions</CardDescription>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-caption"
                                        onClick={resetAllShortcuts}
                                    >
                                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                        Reset All
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {Object.entries(
                                    shortcuts.reduce((acc, shortcut) => {
                                        if (!acc[shortcut.category]) acc[shortcut.category] = [];
                                        acc[shortcut.category]!.push(shortcut);
                                        return acc;
                                    }, {} as Record<string, typeof shortcuts>)
                                ).map(([category, categoryShortcuts]) => (
                                    <div key={category} className="space-y-2">
                                        <h3 className="font-medium text-caption uppercase tracking-[0.08em] text-muted-foreground">
                                            {categoryLabels[category as keyof typeof categoryLabels] || category}
                                        </h3>
                                        <Table className="[&_[data-slot=table-row]]:h-9 [&_[data-slot=table-head]]:h-7 [&_[data-slot=table-head]]:py-1 [&_[data-slot=table-cell]]:py-1 [&_kbd]:h-4 [&_kbd]:px-1 [&_kbd]:text-micro">
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-[40%] text-caption uppercase tracking-[0.08em]">Action</TableHead>
                                                    <TableHead className="w-[30%] text-caption uppercase tracking-[0.08em]">Shortcut</TableHead>
                                                    <TableHead className="w-[30%] text-caption uppercase tracking-[0.08em]">Actions</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {categoryShortcuts.map((shortcut) => {
                                                    const currentKeys = shortcut.customKeys || shortcut.defaultKeys;
                                                    const isCustom = !!shortcut.customKeys;
                                                    const isEditing = editingShortcut === shortcut.id;
                                                    const isDocOnly = 'documentationOnly' in shortcut && shortcut.documentationOnly;

                                                    return (
                                                        <TableRow key={shortcut.id}>
                                                            <TableCell>
                                                                <div className="space-y-1">
                                                                    <div className="font-medium text-xs">{shortcut.name}</div>
                                                                    <div className="text-caption text-muted-foreground">
                                                                        {shortcut.description}
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-1.5">
                                                                    {isEditing ? (
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="text-caption text-muted-foreground">
                                                                                Press keys...
                                                                            </span>
                                                                            {recordingKeys.length > 0 && (
                                                                                <KeyboardIndicator keys={recordingKeys} className="[&_kbd]:h-4 [&_kbd]:px-1 [&_kbd]:text-micro" />
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <KeyboardIndicator keys={currentKeys} className="[&_kbd]:h-4 [&_kbd]:px-1 [&_kbd]:text-micro" />
                                                                            {isCustom && (
                                                                                <Badge variant="secondary" className="h-5 px-1.5 text-micro">
                                                                                    Custom
                                                                                </Badge>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-1.5">
                                                                    {isDocOnly ? (
                                                                        <span className="text-caption text-muted-foreground">
                                                                            Editor shortcut
                                                                        </span>
                                                                    ) : isEditing ? (
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-6 px-1.5 text-caption"
                                                                            onClick={() => {
                                                                                setEditingShortcut(null);
                                                                                setRecordingKeys([]);
                                                                            }}
                                                                        >
                                                                            Cancel
                                                                        </Button>
                                                                    ) : (
                                                                        <>
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                className="h-6 px-1.5 text-caption"
                                                                                onClick={() => setEditingShortcut(shortcut.id)}
                                                                            >
                                                                                Edit
                                                                            </Button>
                                                                            {isCustom && (
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    className="h-6 px-1.5 text-caption"
                                                                                    onClick={() => resetShortcut(shortcut.id)}
                                                                                >
                                                                                    Reset
                                                                                </Button>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="preferences" className="mt-0 space-y-3">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4" />
                                    Apple Calendar
                                </CardTitle>
                                <CardDescription>Sync todos with scheduled dates to Apple Calendar</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label className="text-caption">Apple Calendar sync</Label>
                                        <p className="text-sm text-muted-foreground">
                                            When enabled, todos with scheduled dates are synced to the "Nomendex Tasks" calendar
                                        </p>
                                    </div>
                                    <Switch
                                        checked={appleCalendarSync}
                                        onCheckedChange={setAppleCalendarSync}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4" />
                                    Date Format
                                </CardTitle>
                                <CardDescription>Choose how dates are displayed throughout the app</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <RadioGroup
                                    value={dateFormat}
                                    onValueChange={(v) => setDateFormat(v as DateFormat)}
                                    className="space-y-2"
                                >
                                    <div className="flex items-center gap-3">
                                        <RadioGroupItem value="us" id="date-us" />
                                        <Label htmlFor="date-us" className="text-caption cursor-pointer">US format — Jun 5, 2026</Label>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <RadioGroupItem value="eu" id="date-eu" />
                                        <Label htmlFor="date-eu" className="text-caption cursor-pointer">EU format — 5. 6. 2026</Label>
                                    </div>
                                </RadioGroup>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <LayoutGrid className="h-4 w-4" />
                                    Tabs
                                </CardTitle>
                                <CardDescription>Configure tab behavior</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label className="text-caption">Auto-close inactive tabs</Label>
                                        <p className="text-sm text-muted-foreground">
                                            Close tabs that haven't been viewed recently. Pinned tabs are never closed.
                                        </p>
                                    </div>
                                    <Select
                                        value={String(workspace.tabAutoCloseTimeout ?? 900)}
                                        onValueChange={(v) => updateWorkspace({ tabAutoCloseTimeout: Number(v) })}
                                    >
                                        <SelectTrigger className="w-[150px] h-8 text-caption">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="0">Disabled</SelectItem>
                                            <SelectItem value="300">5 minutes</SelectItem>
                                            <SelectItem value="600">10 minutes</SelectItem>
                                            <SelectItem value="900">15 minutes</SelectItem>
                                            <SelectItem value="1800">30 minutes</SelectItem>
                                            <SelectItem value="3600">1 hour</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle>Chat Input Preferences</CardTitle>
                                <CardDescription>Customize how the chat input behaves</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label className="text-caption">
                                            Send message with
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Choose which key combination sends your message
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={currentValue ? "enter" : "cmd-enter"}
                                            onValueChange={(value) => {
                                                const newValue = value === "enter";
                                                console.log("[Preferences] Selection changed to:", newValue);
                                                setPendingEnterToSend(newValue);
                                            }}
                                        >
                                            <SelectTrigger className="w-[170px] h-8 text-caption">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="enter">Enter</SelectItem>
                                                <SelectItem value="cmd-enter">Cmd + Enter</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                {hasUnsavedChanges && (
                                    <div className="flex items-center gap-2 pt-2">
                                        <Button
                                            onClick={handleSavePreference}
                                            disabled={savingPreference}
                                            size="sm"
                                        >
                                            {savingPreference ? "Saving..." : "Save"}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setPendingEnterToSend(null)}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                )}
                                {savedPreference && (
                                    <div className="flex items-center gap-2 pt-2">
                                        <Check className="h-4 w-4 text-success" />
                                        <span className="text-sm text-success">
                                            Saved successfully
                                        </span>
                                    </div>
                                )}
                                <div className="pt-4 text-xs text-muted-foreground">
                                    Debug: Current saved value = {String(chatInputEnterToSend)}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="theme" className="mt-0">
                        <div className="space-y-4">
                            {/* Current Theme Display */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Current Theme: {currentTheme.name}</CardTitle>
                                    <CardDescription>Your active theme and color scheme</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Surface Colors */}
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-medium text-muted-foreground">Surface Colors</h4>
                                            <div className="space-y-1">
                                                {Object.entries({
                                                    'Primary': currentTheme.styles.surfacePrimary,
                                                    'Secondary': currentTheme.styles.surfaceSecondary,
                                                    'Tertiary': currentTheme.styles.surfaceTertiary,
                                                    'Accent': currentTheme.styles.surfaceAccent,
                                                    'Muted': currentTheme.styles.surfaceMuted,
                                                }).map(([name, color]) => (
                                                    <div key={name} className="flex items-center gap-2">
                                                        <div
                                                            className="w-8 h-8 rounded border"
                                                            style={{
                                                                backgroundColor: color,
                                                                borderColor: currentTheme.styles.borderDefault
                                                            }}
                                                        />
                                                        <span className="text-sm text-muted-foreground">{name}</span>
                                                        <code className="text-xs ml-auto text-muted-foreground">{color}</code>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Content Colors */}
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-medium text-muted-foreground">Content Colors</h4>
                                            <div className="space-y-1">
                                                {Object.entries({
                                                    'Primary': currentTheme.styles.contentPrimary,
                                                    'Secondary': currentTheme.styles.contentSecondary,
                                                    'Tertiary': currentTheme.styles.contentTertiary,
                                                    'Accent': currentTheme.styles.contentAccent,
                                                }).map(([name, color]) => (
                                                    <div key={name} className="flex items-center gap-2">
                                                        <div
                                                            className="w-8 h-8 rounded border"
                                                            style={{
                                                                backgroundColor: color,
                                                                borderColor: currentTheme.styles.borderDefault
                                                            }}
                                                        />
                                                        <span className="text-sm text-muted-foreground">{name}</span>
                                                        <code className="text-xs ml-auto text-muted-foreground">{color}</code>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Semantic Colors */}
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-medium text-muted-foreground">Semantic Colors</h4>
                                            <div className="space-y-1">
                                                {Object.entries({
                                                    'Primary': currentTheme.styles.semanticPrimary,
                                                    'Destructive': currentTheme.styles.semanticDestructive,
                                                    'Success': currentTheme.styles.semanticSuccess,
                                                }).map(([name, color]) => (
                                                    <div key={name} className="flex items-center gap-2">
                                                        <div
                                                            className="w-8 h-8 rounded border"
                                                            style={{
                                                                backgroundColor: color,
                                                                borderColor: currentTheme.styles.borderDefault
                                                            }}
                                                        />
                                                        <span className="text-sm text-muted-foreground">{name}</span>
                                                        <code className="text-xs ml-auto text-muted-foreground">{color}</code>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Border Colors */}
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-medium text-muted-foreground">Border Colors</h4>
                                            <div className="space-y-1">
                                                {Object.entries({
                                                    'Default': currentTheme.styles.borderDefault,
                                                    'Accent': currentTheme.styles.borderAccent,
                                                }).map(([name, color]) => (
                                                    <div key={name} className="flex items-center gap-2">
                                                        <div
                                                            className="w-8 h-8 rounded border-2"
                                                            style={{
                                                                backgroundColor: currentTheme.styles.surfacePrimary,
                                                                borderColor: color
                                                            }}
                                                        />
                                                        <span className="text-sm text-muted-foreground">{name}</span>
                                                        <code className="text-xs ml-auto text-muted-foreground">{color}</code>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Preset Themes */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Preset Themes</CardTitle>
                                    <CardDescription>Choose from available theme presets</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-col gap-2">
                                        {themes.map((theme) => (
                                            <Button
                                                key={theme.name}
                                                onClick={() => setTheme(theme)}
                                                variant={currentTheme.name === theme.name ? "default" : "outline"}
                                                className="justify-start"
                                            >
                                                {theme.name}
                                            </Button>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Custom Theme Editor (Coming Soon) */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Custom Theme Editor</CardTitle>
                                    <CardDescription>Create and save your own custom themes</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">
                                        The custom theme editor is coming soon. You'll be able to:
                                    </p>
                                    <ul className="list-disc list-inside mt-2 space-y-1 text-sm text-muted-foreground">
                                        <li>Customize all color tokens with a color picker</li>
                                        <li>Save custom themes as presets</li>
                                        <li>Export and import theme configurations</li>
                                        <li>Preview changes in real-time</li>
                                    </ul>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="secrets" className="mt-0">
                        <div className="space-y-4">
                            {/* Predefined Secrets */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Key className="h-4 w-4" />
                                        System API Keys
                                    </CardTitle>
                                    <CardDescription>
                                        Required tokens for core application functionality.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {secretsLoading ? (
                                        <p className="text-muted-foreground">Loading...</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {secrets.filter((s) => s.isPredefined).map((secret) => (
                                                <div
                                                    key={secret.key}
                                                    className="p-3 rounded-lg border bg-secondary border-border"
                                                >
                                                    <div className="flex items-start justify-between mb-2">
                                                        <div>
                                                            <h4 className="font-medium">
                                                                {secret.label}
                                                            </h4>
                                                            <p className="text-sm text-muted-foreground">
                                                                {secret.description}
                                                            </p>
                                                        </div>
                                                        {secret.hasValue && (
                                                            <Badge variant="secondary" className="ml-2">
                                                                Configured
                                                            </Badge>
                                                        )}
                                                    </div>

                                                    {editingSecret === secret.key ? (
                                                        <div className="space-y-2">
                                                            <div className="flex gap-2">
                                                                <div className="relative flex-1">
                                                                    <Input
                                                                        type={showSecretValue ? "text" : "password"}
                                                                        value={secretValue}
                                                                        onChange={(e) => setSecretValue(e.target.value)}
                                                                        placeholder={secret.placeholder}
                                                                        className="pr-10"
                                                                    />
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                                                                        onClick={() => setShowSecretValue(!showSecretValue)}
                                                                    >
                                                                        {showSecretValue ? (
                                                                            <EyeOff className="h-4 w-4" />
                                                                        ) : (
                                                                            <Eye className="h-4 w-4" />
                                                                        )}
                                                                    </Button>
                                                                </div>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => handleSaveSecret(secret.key)}
                                                                    disabled={savingSecret}
                                                                >
                                                                    <Check className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => {
                                                                        setEditingSecret(null);
                                                                        setSecretValue("");
                                                                        setShowSecretValue(false);
                                                                    }}
                                                                >
                                                                    <X className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">
                                                                {secret.helpText}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            {secret.hasValue ? (
                                                                <>
                                                                    <code
                                                                        className="text-sm px-2 py-1 rounded flex-1 bg-surface-elevated text-muted-foreground"
                                                                    >
                                                                        {secret.maskedValue}
                                                                    </code>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => {
                                                                            setEditingSecret(secret.key);
                                                                            setSecretValue("");
                                                                        }}
                                                                    >
                                                                        Update
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleDeleteSecret(secret.key, true)}
                                                                    >
                                                                        Remove
                                                                    </Button>
                                                                </>
                                                            ) : (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => {
                                                                        setEditingSecret(secret.key);
                                                                        setSecretValue("");
                                                                    }}
                                                                >
                                                                    Add Token
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Custom API Keys */}
                            <Card>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle>Custom API Keys</CardTitle>
                                            <CardDescription>
                                                Add API keys for MCP servers and other integrations. Use the key name in your MCP server config with {`\${KEY_NAME}`} syntax.
                                            </CardDescription>
                                        </div>
                                        {!isAddingCustom && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 px-2 text-xs"
                                                onClick={() => setIsAddingCustom(true)}
                                            >
                                                <Plus className="mr-2 h-4 w-4" />
                                                Add Key
                                            </Button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Add new custom secret form */}
                                    {isAddingCustom && (
                                        <div
                                            className="p-3 rounded-lg border bg-secondary border-accent"
                                        >
                                            <h4 className="font-medium mb-3">
                                                New API Key
                                            </h4>
                                            <div className="space-y-3">
                                                <div className="space-y-1">
                                                    <label className="text-sm text-muted-foreground">
                                                        Key Name
                                                    </label>
                                                    <Input
                                                        value={newSecretKey}
                                                        onChange={(e) => {
                                                            setNewSecretKey(e.target.value);
                                                            setNewSecretError("");
                                                        }}
                                                        placeholder="e.g., LINEAR_API_KEY, OPENAI_API_KEY"
                                                        className="font-mono"
                                                    />
                                                    <p className="text-xs text-muted-foreground">
                                                        Will be converted to uppercase. Use this name in MCP server configs.
                                                    </p>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-sm text-muted-foreground">
                                                        Value
                                                    </label>
                                                    <div className="relative">
                                                        <Input
                                                            type={showNewSecretValue ? "text" : "password"}
                                                            value={newSecretValue}
                                                            onChange={(e) => {
                                                                setNewSecretValue(e.target.value);
                                                                setNewSecretError("");
                                                            }}
                                                            placeholder="Paste your API key here"
                                                            className="pr-10"
                                                        />
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                                                            onClick={() => setShowNewSecretValue(!showNewSecretValue)}
                                                        >
                                                            {showNewSecretValue ? (
                                                                <EyeOff className="h-4 w-4" />
                                                            ) : (
                                                                <Eye className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                                {newSecretError && (
                                                    <p className="text-sm text-destructive">
                                                        {newSecretError}
                                                    </p>
                                                )}
                                                <div className="flex gap-2">
                                                    <Button
                                                        onClick={handleAddCustomSecret}
                                                        disabled={savingSecret}
                                                        size="sm"
                                                        className="h-7 px-2 text-xs"
                                                    >
                                                        {savingSecret ? "Saving..." : "Add Key"}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2 text-xs"
                                                        onClick={() => {
                                                            setIsAddingCustom(false);
                                                            setNewSecretKey("");
                                                            setNewSecretValue("");
                                                            setShowNewSecretValue(false);
                                                            setNewSecretError("");
                                                        }}
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Existing custom secrets */}
                                    {secrets.filter((s) => !s.isPredefined).length === 0 && !isAddingCustom ? (
                                        <p className="text-sm text-muted-foreground">
                                            No custom API keys configured. Add one to use with MCP servers.
                                        </p>
                                    ) : (
                                        <div className="space-y-4">
                                            {secrets.filter((s) => !s.isPredefined).map((secret) => (
                                                <div
                                                    key={secret.key}
                                                    className="p-3 rounded-lg border bg-secondary border-border"
                                                >
                                                    <div className="flex items-start justify-between mb-2">
                                                        <div>
                                                            <h4 className="font-medium font-mono">
                                                                {secret.key}
                                                            </h4>
                                                            <p className="text-xs text-muted-foreground">
                                                                Use as {`\${${secret.key}}`} in MCP server configs
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {editingSecret === secret.key ? (
                                                        <div className="space-y-2">
                                                            <div className="flex gap-2">
                                                                <div className="relative flex-1">
                                                                    <Input
                                                                        type={showSecretValue ? "text" : "password"}
                                                                        value={secretValue}
                                                                        onChange={(e) => setSecretValue(e.target.value)}
                                                                        placeholder="Enter new value"
                                                                        className="pr-10"
                                                                    />
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                                                                        onClick={() => setShowSecretValue(!showSecretValue)}
                                                                    >
                                                                        {showSecretValue ? (
                                                                            <EyeOff className="h-4 w-4" />
                                                                        ) : (
                                                                            <Eye className="h-4 w-4" />
                                                                        )}
                                                                    </Button>
                                                                </div>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => handleSaveSecret(secret.key)}
                                                                    disabled={savingSecret}
                                                                >
                                                                    <Check className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => {
                                                                        setEditingSecret(null);
                                                                        setSecretValue("");
                                                                        setShowSecretValue(false);
                                                                    }}
                                                                >
                                                                    <X className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <code
                                                                className="text-sm px-2 py-1 rounded flex-1 bg-surface-elevated text-muted-foreground"
                                                            >
                                                                {secret.maskedValue}
                                                            </code>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => {
                                                                    setEditingSecret(secret.key);
                                                                    setSecretValue("");
                                                                }}
                                                            >
                                                                Update
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => handleDeleteSecret(secret.key, false)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="channels" className="mt-0">
                        <ChannelsSettings />
                    </TabsContent>

                    <TabsContent value="memory" className="mt-0">
                        <MemoryExtractionSettings />
                        <div className="mt-3">
                            <MemoryEmbeddingsSettings />
                        </div>
                    </TabsContent>

                    <TabsContent value="storage" className="mt-0">
                        <StorageSettings />
                    </TabsContent>

                    <TabsContent value="about" className="mt-0">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Info className="h-4 w-4" />
                                    About Nomendex
                                </CardTitle>
                                <CardDescription>
                                    Version information and updates
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Version Info */}
                                <div
                                    className="p-3 rounded-lg border bg-secondary border-border"
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-medium">
                                                Current Version
                                            </h4>
                                            {versionInfo ? (
                                                <p className="text-sm mt-1 text-muted-foreground">
                                                    v{versionInfo.version} (build {versionInfo.buildNumber})
                                                </p>
                                            ) : (
                                                <p className="text-sm mt-1 text-muted-foreground">
                                                    Loading...
                                                </p>
                                            )}
                                        </div>
                                        <Button
                                            onClick={handleCheckForUpdates}
                                            disabled={checkingForUpdates}
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2 text-xs"
                                        >
                                            <RefreshCw className={`mr-2 h-4 w-4 ${checkingForUpdates ? "animate-spin" : ""}`} />
                                            Check for Updates
                                        </Button>
                                    </div>
                                </div>

                                {/* Update Settings Info */}
                                <div className="text-sm text-muted-foreground">
                                    <p>
                                        Nomendex automatically checks for updates every 15 minutes.
                                        When an update is available, you'll see a notification.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}

export function SettingsPage() {
    return <SettingsContent />;
}
