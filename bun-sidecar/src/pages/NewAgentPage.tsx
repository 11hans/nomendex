import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAgentsAPI } from "@/hooks/useAgentsAPI";
import { useMcpServersAPI } from "@/hooks/useMcpServersAPI";
import { PREDEFINED_MODELS, buildAgentModelCatalog, getModelDisplayName } from "@/features/agents/index";
import type { UserMcpServer } from "@/features/mcp-servers/mcp-server-types";
import { ArrowLeft, Sparkles, Cpu, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CombinedMcpServer extends UserMcpServer {
    isBuiltIn?: boolean;
}

function NewAgentContent() {
    const api = useAgentsAPI();
    const mcpServersAPI = useMcpServersAPI();
    const navigate = useNavigate();

    const [allMcpServers, setAllMcpServers] = useState<CombinedMcpServer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formSystemPrompt, setFormSystemPrompt] = useState("");
    const [formModel, setFormModel] = useState<string>("claude-sonnet-4-5");
    const [availableModels, setAvailableModels] = useState<string[]>(buildAgentModelCatalog([]));
    const [formMcpServers, setFormMcpServers] = useState<string[]>([]);
    const [useCustomModel, setUseCustomModel] = useState(false);

    // Load all MCP servers on mount
    useEffect(() => {
        loadMcpServers();
        loadModels();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadMcpServers() {
        setIsLoading(true);
        try {
            const response = await mcpServersAPI.getAllServers();
            setAllMcpServers(response.servers);
        } catch (error) {
            console.error("Failed to load MCP servers:", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function loadModels() {
        try {
            const response = await api.listModels();
            const catalog = buildAgentModelCatalog(response.models);
            setAvailableModels(catalog);
            if (!useCustomModel && !catalog.includes(formModel) && catalog[0]) {
                setFormModel(catalog[0]);
            }
        } catch (error) {
            console.error("Failed to load models, using fallback list:", error);
            setAvailableModels(buildAgentModelCatalog([]));
        }
    }

    // Separate built-in and user-defined servers
    const builtInServers = allMcpServers.filter((s) => s.isBuiltIn);
    const userServers = allMcpServers.filter((s) => !s.isBuiltIn);

    async function handleSave() {
        setIsSaving(true);
        try {
            await api.createAgent({
                name: formName,
                description: formDescription || undefined,
                systemPrompt: formSystemPrompt,
                model: formModel,
                mcpServers: formMcpServers,
            });
            navigate("/agents");
        } catch (error) {
            console.error("Failed to save agent:", error);
        } finally {
            setIsSaving(false);
        }
    }

    function toggleMcpServer(serverId: string) {
        setFormMcpServers((prev) =>
            prev.includes(serverId)
                ? prev.filter((id) => id !== serverId)
                : [...prev, serverId]
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center bg-bg">
                <p className="text-muted-foreground">Loading...</p>
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-bg text-foreground">
            <div className="mx-auto w-full max-w-[620px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    <Sparkles className="size-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-[0.14em]">New Agent</span>
                    <span className="text-caption text-muted-foreground">{useCustomModel ? "custom model" : "predefined model"}</span>

                    <div className="ml-auto flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => navigate("/agents")}
                            title="Back to Agents"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => navigate("/agents")}>
                            Cancel
                        </Button>
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSave} disabled={!formName.trim() || isSaving}>
                            {isSaving ? "Creating..." : "Create"}
                        </Button>
                    </div>
                </div>

                <div className="mt-2.5 space-y-2">
                    <Card className="overflow-hidden rounded-lg border">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <Sparkles className="h-4 w-4 text-muted-foreground" />
                                Agent Configuration
                            </CardTitle>
                            <CardDescription>
                                This configuration is saved as an agent profile and can be selected in chat tabs.
                            </CardDescription>
                        </CardHeader>

                        <CardContent className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Name</Label>
                                    <Input
                                        id="name"
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        placeholder="e.g., Linear Assistant"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="description">Description (optional)</Label>
                                    <Input
                                        id="description"
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        placeholder="e.g., Agent for sprint planning and issue triage"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 rounded-xl border border-border bg-bg-secondary p-3">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="model">Model</Label>
                                    <button
                                        type="button"
                                        className="text-xs text-accent hover:underline"
                                        onClick={() => {
                                            if (!useCustomModel) {
                                                setUseCustomModel(true);
                                            } else {
                                                setFormModel(availableModels[0] || PREDEFINED_MODELS[0]);
                                                setUseCustomModel(false);
                                            }
                                        }}
                                    >
                                        {useCustomModel ? "Use predefined" : "Enter custom"}
                                    </button>
                                </div>

                                {useCustomModel ? (
                                    <Input
                                        id="model"
                                        value={formModel}
                                        onChange={(e) => setFormModel(e.target.value)}
                                        placeholder="e.g., claude-opus-4-6"
                                    />
                                ) : (
                                    <Select value={formModel} onValueChange={(value) => setFormModel(value)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableModels.map((model) => (
                                                <SelectItem key={model} value={model}>
                                                    {getModelDisplayName(model)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}

                                <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="secondary" className="gap-1 rounded-full px-2 py-0">
                                        <Cpu className="h-3 w-3" />
                                        {useCustomModel ? formModel || "Custom" : getModelDisplayName(formModel)}
                                    </Badge>
                                    <Badge variant="secondary" className="gap-1 rounded-full px-2 py-0">
                                        <Layers3 className="h-3 w-3" />
                                        {formMcpServers.length} MCP {formMcpServers.length === 1 ? "server" : "servers"}
                                    </Badge>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="systemPrompt">System Prompt</Label>
                                <Textarea
                                    id="systemPrompt"
                                    value={formSystemPrompt}
                                    onChange={(e) => setFormSystemPrompt(e.target.value)}
                                    placeholder="Leave empty to use the default Claude Code system prompt"
                                    className="min-h-[140px] font-mono text-sm"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Empty value means the agent uses Claude Code default system prompt.
                                </p>
                            </div>

                            <div className="space-y-3 rounded-xl border border-border bg-bg-secondary p-3">
                                <Label>MCP Servers</Label>
                                {allMcpServers.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No MCP servers available. Add servers in MCP settings first.
                                    </p>
                                ) : (
                                    <div className="space-y-4">
                                        {userServers.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                                    User Defined
                                                </p>
                                                <div className="space-y-2">
                                                    {userServers.map((server) => (
                                                        <div key={server.id} className="flex items-start space-x-3">
                                                            <Checkbox
                                                                id={`mcp-${server.id}`}
                                                                checked={formMcpServers.includes(server.id)}
                                                                onCheckedChange={() => toggleMcpServer(server.id)}
                                                            />
                                                            <div className="grid gap-1.5 leading-none">
                                                                <label
                                                                    htmlFor={`mcp-${server.id}`}
                                                                    className="cursor-pointer text-sm font-medium"
                                                                >
                                                                    {server.name}
                                                                </label>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {server.description || "No description"}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {builtInServers.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                                    Built-in
                                                </p>
                                                <div className="space-y-2">
                                                    {builtInServers.map((server) => (
                                                        <div key={server.id} className="flex items-start space-x-3">
                                                            <Checkbox
                                                                id={`mcp-${server.id}`}
                                                                checked={formMcpServers.includes(server.id)}
                                                                onCheckedChange={() => toggleMcpServer(server.id)}
                                                            />
                                                            <div className="grid gap-1.5 leading-none">
                                                                <label
                                                                    htmlFor={`mcp-${server.id}`}
                                                                    className="flex cursor-pointer items-center gap-2 text-sm font-medium"
                                                                >
                                                                    {server.name}
                                                                    <Badge variant="secondary" className="px-1 py-0 text-caption">Built-in</Badge>
                                                                </label>
                                                                <p className="text-xs text-muted-foreground">
                                                                    {server.description || "No description"}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

export function NewAgentPage() {
    return <NewAgentContent />;
}
