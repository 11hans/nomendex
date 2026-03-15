import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Alert,
    AlertDescription,
} from "@/components/ui/alert";
import { useMcpServersAPI } from "@/hooks/useMcpServersAPI";
import type { UserMcpServer, TransportConfig } from "@/features/mcp-servers/mcp-server-types";
import { Plus, Pencil, Trash2, ArrowLeft, Server, AlertTriangle, Globe, Terminal, ChevronRight } from "lucide-react";

type TransportType = "stdio" | "sse" | "http";

interface CombinedMcpServer extends UserMcpServer {
    isBuiltIn?: boolean;
}

function McpServersContent() {
    const navigate = useNavigate();
    const api = useMcpServersAPI();

    const [servers, setServers] = useState<CombinedMcpServer[]>([]);
    const [oauthWarning, setOauthWarning] = useState<string>("");
    const [isLoading, setIsLoading] = useState(true);
    const [deleteConfirmServer, setDeleteConfirmServer] = useState<CombinedMcpServer | null>(null);

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const response = await api.getAllServers();
            setServers(response.servers);
            setOauthWarning(response.oauthWarning);
        } catch (error) {
            console.error("Failed to load MCP servers:", error);
        } finally {
            setIsLoading(false);
        }
    }

    function getTransportType(transport: TransportConfig): TransportType {
        if ("type" in transport && transport.type === "sse") return "sse";
        if ("type" in transport && transport.type === "http") return "http";
        return "stdio";
    }

    async function handleDelete(server: CombinedMcpServer) {
        try {
            await api.deleteServer({ serverId: server.id });
            setDeleteConfirmServer(null);
            await loadData();
        } catch (error) {
            console.error("Failed to delete MCP server:", error);
        }
    }

    function getTransportIcon(transport: TransportConfig) {
        const type = getTransportType(transport);
        if (type === "stdio") return <Terminal className="h-4 w-4" />;
        return <Globe className="h-4 w-4" />;
    }

    function getTransportLabel(transport: TransportConfig): string {
        const type = getTransportType(transport);
        if (type === "stdio" && "command" in transport) {
            return `${transport.command} ${transport.args?.join(" ") || ""}`.trim();
        } else if ("url" in transport) {
            return transport.url;
        }
        return type.toUpperCase();
    }

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center bg-bg">
                <p className="text-muted-foreground">Loading MCP servers...</p>
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-bg text-foreground">
            <div className="mx-auto w-full max-w-[620px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    <Server className="size-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-[0.14em]">MCP Servers</span>
                    <span className="text-caption text-muted-foreground">{servers.length} items</span>

                    <div className="ml-auto flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/agents")} title="Back">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => navigate("/mcp-servers/new")}>
                            <Plus className="mr-1 h-4 w-4" />
                            New
                        </Button>
                    </div>
                </div>

                <div className="mt-2.5 space-y-2">
                    {oauthWarning && (
                        <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-sm">{oauthWarning}</AlertDescription>
                        </Alert>
                    )}

                    {servers.length === 0 ? (
                        <div className="py-4 text-center text-caption text-muted-foreground">
                            no mcp servers configured yet
                        </div>
                    ) : (
                        servers.map((server) => (
                            <Card key={server.id} className="overflow-hidden rounded-lg border">
                                <CardHeader className="px-2.5 py-2 pb-1.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex min-w-0 items-start gap-2">
                                            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-bg-secondary">
                                                {getTransportIcon(server.transport)}
                                            </div>
                                            <div className="min-w-0">
                                                <CardTitle className="flex items-center gap-1.5 text-xs">
                                                    <span className="truncate">{server.name}</span>
                                                    {server.isBuiltIn && (
                                                        <Badge variant="secondary" className="px-1 py-0 text-caption">Built-in</Badge>
                                                    )}
                                                    <Badge variant="outline" className="px-1 py-0 text-caption">
                                                        {getTransportType(server.transport).toUpperCase()}
                                                    </Badge>
                                                </CardTitle>
                                                <CardDescription className="text-caption">
                                                    {server.description || "No description"}
                                                </CardDescription>
                                            </div>
                                        </div>
                                        {!server.isBuiltIn && (
                                            <div className="flex items-center gap-0.5">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() => navigate(`/mcp-servers/${server.id}/edit`)}
                                                    title="Edit"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() => setDeleteConfirmServer(server)}
                                                    title="Delete"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="px-2.5 py-1.5 pt-0">
                                    <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
                                        <ChevronRight className="size-3 opacity-70" />
                                        <span className="truncate font-mono">{getTransportLabel(server.transport)}</span>
                                    </div>
                                    {server.notes && (
                                        <p className="mt-1 text-caption text-muted-foreground">
                                            {server.notes}
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
            </div>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteConfirmServer} onOpenChange={() => setDeleteConfirmServer(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete MCP Server</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete "{deleteConfirmServer?.name}"? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirmServer(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteConfirmServer && handleDelete(deleteConfirmServer)}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function McpServersPage() {
    return <McpServersContent />;
}
