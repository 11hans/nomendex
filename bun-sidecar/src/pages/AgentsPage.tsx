import { useState, useEffect, useMemo } from "react";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useAgentsAPI } from "@/hooks/useAgentsAPI";
import { useMcpServersAPI } from "@/hooks/useMcpServersAPI";
import type { AgentConfig } from "@/features/agents/index";
import { PREDEFINED_MODELS, MODEL_DISPLAY_NAMES, getModelDisplayName } from "@/features/agents/index";
import type { PredefinedModel } from "@/features/agents/index";
import type { UserMcpServer } from "@/features/mcp-servers/mcp-server-types";
import { Plus, Pencil, Trash2, Copy, Bot, Server, Cpu, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CombinedMcpServer extends UserMcpServer {
    isBuiltIn?: boolean;
}

function AgentsContent() {
    const navigate = useNavigate();
    const api = useAgentsAPI();
    const mcpServersAPI = useMcpServersAPI();
    const [agents, setAgents] = useState<AgentConfig[]>([]);
    const [allMcpServers, setAllMcpServers] = useState<CombinedMcpServer[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Dialog state (for edit and delete only)
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
    const [deleteConfirmAgent, setDeleteConfirmAgent] = useState<AgentConfig | null>(null);

    // Form state (for editing)
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formSystemPrompt, setFormSystemPrompt] = useState("");
    const [formModel, setFormModel] = useState<string>("claude-sonnet-4-5-20250929");
    const [formMcpServers, setFormMcpServers] = useState<string[]>([]);
    const [useCustomModel, setUseCustomModel] = useState(false);

    // Separate built-in and user-defined servers
    const builtInServers = allMcpServers.filter((s) => s.isBuiltIn);
    const userServers = allMcpServers.filter((s) => !s.isBuiltIn);

    const serverNameMap = useMemo(
        () => new Map(allMcpServers.map((server) => [server.id, server.name])),
        [allMcpServers]
    );

    const defaultAgent = useMemo(() => agents.find((agent) => agent.isDefault), [agents]);

    const connectedServerCount = useMemo(
        () => new Set(agents.flatMap((agent) => agent.mcpServers)).size,
        [agents]
    );

    const customModelCount = useMemo(
        () => agents.filter((agent) => !(PREDEFINED_MODELS as readonly string[]).includes(agent.model)).length,
        [agents]
    );

    // Load agents and MCP servers on mount
    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const [agentsList, mcpResponse] = await Promise.all([
                api.listAgents(),
                mcpServersAPI.getAllServers(),
            ]);
            setAgents(agentsList);
            setAllMcpServers(mcpResponse.servers);
        } catch (error) {
            console.error("Failed to load agents:", error);
        } finally {
            setIsLoading(false);
        }
    }

    function openCreatePage() {
        navigate("/new-agent");
    }

    function openEditDialog(agent: AgentConfig) {
        setEditingAgent(agent);
        setFormName(agent.name);
        setFormDescription(agent.description || "");
        setFormSystemPrompt(agent.systemPrompt);
        setFormModel(agent.model);
        setFormMcpServers([...agent.mcpServers]);
        // Check if the model is a predefined one or custom
        const isPredefined = (PREDEFINED_MODELS as readonly string[]).includes(agent.model);
        setUseCustomModel(!isPredefined);
        setIsDialogOpen(true);
    }

    async function handleSave() {
        try {
            await api.updateAgent({
                agentId: editingAgent!.id,
                updates: {
                    name: formName,
                    description: formDescription || undefined,
                    systemPrompt: formSystemPrompt,
                    model: formModel,
                    mcpServers: formMcpServers,
                },
            });
            setIsDialogOpen(false);
            await loadData();
        } catch (error) {
            console.error("Failed to save agent:", error);
        }
    }

    async function handleDelete(agent: AgentConfig) {
        try {
            await api.deleteAgent({ agentId: agent.id });
            setDeleteConfirmAgent(null);
            await loadData();
        } catch (error) {
            console.error("Failed to delete agent:", error);
        }
    }

    async function handleDuplicate(agent: AgentConfig) {
        try {
            await api.duplicateAgent({ agentId: agent.id });
            await loadData();
        } catch (error) {
            console.error("Failed to duplicate agent:", error);
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
                <p className="text-muted-foreground">Loading agents...</p>
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-bg text-foreground">
            <div className="mx-auto w-full max-w-[620px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    <Bot className="size-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-[0.14em]">Agents</span>
                    <span className="text-caption text-muted-foreground">{agents.length} items</span>
                    <span className="text-caption text-muted-foreground">{connectedServerCount} mcp</span>
                    <span className="text-caption text-muted-foreground">{customModelCount} custom</span>

                    <div className="ml-auto flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => navigate("/mcp-servers")}>
                            <Server className="mr-1 h-4 w-4" />
                            MCP
                        </Button>
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={openCreatePage}>
                            <Plus className="mr-1 h-4 w-4" />
                            New
                        </Button>
                    </div>
                </div>

                <div className="mt-2.5 space-y-2">
                    {agents.length === 0 && (
                        <Card className="border-dashed rounded-lg">
                            <CardHeader>
                                <CardTitle>No agents yet</CardTitle>
                                <CardDescription>
                                    Create your first agent to start using custom prompts and tool access profiles.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button onClick={openCreatePage}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Create First Agent
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                    {agents.map((agent) => {
                        const isCustomModel = !(PREDEFINED_MODELS as readonly string[]).includes(agent.model);
                        const trimmedPrompt = agent.systemPrompt.length > 200
                            ? agent.systemPrompt.slice(0, 200) + "..."
                            : agent.systemPrompt || "(uses default system prompt)";

                        return (
                            <Card key={agent.id} className="overflow-hidden rounded-lg border">
                                <CardHeader className="px-2.5 py-2 pb-1.5">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="flex min-w-0 items-start gap-2">
                                            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-bg-secondary">
                                                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                                            </div>
                                            <div className="min-w-0 space-y-1">
                                                <CardTitle className="flex flex-wrap items-center gap-1.5 text-xs">
                                                    <span className="truncate">{agent.name}</span>
                                                    {agent.isDefault && (
                                                        <Badge className="px-1 py-0 text-caption" variant="success">
                                                            Default
                                                        </Badge>
                                                    )}
                                                </CardTitle>
                                                <CardDescription className="line-clamp-2 text-caption">
                                                    {agent.description || "No description"}
                                                </CardDescription>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => handleDuplicate(agent)}
                                                title="Duplicate"
                                            >
                                                <Copy className="h-3.5 w-3.5" />
                                            </Button>
                                            {!agent.isDefault && (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6"
                                                        onClick={() => openEditDialog(agent)}
                                                        title="Edit"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6"
                                                        onClick={() => setDeleteConfirmAgent(agent)}
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>

                                <CardContent className="space-y-2 px-2.5 py-1.5 pt-0">
                                    <div className="flex flex-wrap gap-2">
                                        <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-caption">
                                            <Cpu className="h-3 w-3" />
                                            {getModelDisplayName(agent.model)}
                                        </Badge>
                                        <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-caption">
                                            <Layers3 className="h-3 w-3" />
                                            {agent.mcpServers.length} MCP {agent.mcpServers.length === 1 ? "server" : "servers"}
                                        </Badge>
                                        {isCustomModel && (
                                            <Badge variant="outline" className="px-1.5 py-0 text-caption">
                                                Custom model
                                            </Badge>
                                        )}
                                        {defaultAgent?.id === agent.id && (
                                            <Badge variant="outline" className="px-1.5 py-0 text-caption">
                                                Used by default in new chats
                                            </Badge>
                                        )}
                                    </div>

                                    <div className="rounded-lg border border-border bg-bg-secondary p-2">
                                        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                                            System Prompt Preview
                                        </p>
                                        <p className="font-mono text-caption leading-relaxed text-muted-foreground">{trimmedPrompt}</p>
                                    </div>

                                    {agent.mcpServers.length > 0 ? (
                                        <div className="space-y-1">
                                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Enabled MCP Servers</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {agent.mcpServers.map((serverId) => (
                                                    <Badge key={`${agent.id}-${serverId}`} variant="secondary" className="px-1.5 py-0 text-caption">
                                                        {serverNameMap.get(serverId) || serverId}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">No MCP servers enabled.</p>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {/* Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Agent</DialogTitle>
                        <DialogDescription>
                            Update identity, model choice, prompt policy, and MCP server access.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
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
                                            setFormModel(PREDEFINED_MODELS[0]);
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
                                    placeholder="e.g., claude-opus-4-5-20251101"
                                />
                            ) : (
                                <Select value={formModel} onValueChange={(value) => setFormModel(value)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PREDEFINED_MODELS.map((model) => (
                                            <SelectItem key={model} value={model}>
                                                {MODEL_DISPLAY_NAMES[model as PredefinedModel]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="systemPrompt">System Prompt</Label>
                            <Textarea
                                id="systemPrompt"
                                value={formSystemPrompt}
                                onChange={(e) => setFormSystemPrompt(e.target.value)}
                                placeholder="Leave empty to use the default Claude Code system prompt"
                                className="min-h-[120px] font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Empty value falls back to Claude Code default behavior.
                            </p>
                        </div>

                        <div className="space-y-3 rounded-xl border border-border bg-bg-secondary p-3">
                            <Label>MCP Servers</Label>
                            {allMcpServers.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No MCP servers available.</p>
                            ) : (
                                <div className="space-y-4">
                                    {userServers.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">User Defined</p>
                                            <div className="space-y-2">
                                                {userServers.map((server) => (
                                                    <div key={server.id} className="flex items-start space-x-3">
                                                        <Checkbox
                                                            id={`mcp-edit-${server.id}`}
                                                            checked={formMcpServers.includes(server.id)}
                                                            onCheckedChange={() => toggleMcpServer(server.id)}
                                                        />
                                                        <div className="grid gap-1.5 leading-none">
                                                            <label
                                                                htmlFor={`mcp-edit-${server.id}`}
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
                                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Built-in</p>
                                            <div className="space-y-2">
                                                {builtInServers.map((server) => (
                                                    <div key={server.id} className="flex items-start space-x-3">
                                                        <Checkbox
                                                            id={`mcp-edit-${server.id}`}
                                                            checked={formMcpServers.includes(server.id)}
                                                            onCheckedChange={() => toggleMcpServer(server.id)}
                                                        />
                                                        <div className="grid gap-1.5 leading-none">
                                                            <label
                                                                htmlFor={`mcp-edit-${server.id}`}
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
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={!formName.trim() || !editingAgent}>
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteConfirmAgent} onOpenChange={() => setDeleteConfirmAgent(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Agent</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete "{deleteConfirmAgent?.name}"? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirmAgent(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteConfirmAgent && handleDelete(deleteConfirmAgent)}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function AgentsPage() {
    return <AgentsContent />;
}
