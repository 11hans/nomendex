import { useState, useEffect, useRef, useCallback } from "react";
import {
    Conversation,
    ConversationContent,
} from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import {
    ProseMirrorPromptInput,
    ProseMirrorPromptTextarea,
    ProseMirrorPromptFooter,
    ProseMirrorPromptSubmit,
    ProseMirrorPromptAttach,
    type ProseMirrorPromptTextareaHandle,
} from "@/components/prosemirror/ProseMirrorPromptInput";
import type { Attachment } from "@/types/attachments";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
    StopCircle,
    ListPlus,
    ShieldAlert,
    PauseCircle,
    MessageSquare,
    ChevronDown,
    ChevronRight,
    FileText,
    FilePlus,
    Pencil,
    FolderSearch,
    FileSearch,
    Terminal,
    Globe,
    Search,
    Bot,
    MessageCircle,
    ListChecks,
    FileCode,
    Camera,
    Monitor,
    Clock,
    LayoutGrid,
    type LucideIcon,
    Wrench,
} from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import {
    ToolInput,
    ToolOutput,
} from "@/components/ai-elements/tool";
import { RenderedUI, parseNoetectUIData } from "@/components/ai-elements/rendered-ui";
import { reconstructMessages, type ChatMessage, type ContentBlock } from "./sessionUtils";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";
import { AgentSelector } from "@/features/agents/agent-selector";
import { agentsAPI } from "@/hooks/useAgentsAPI";
import { QueuedMessagesList } from "./QueuedMessagesList";
import type { QueuedMessage } from "./index";
import { useTabScrollPersistence } from "@/hooks/useTabScrollPersistence";
import { OverlayScrollbar } from "@/components/OverlayScrollbar";
import { removeFileLock, upsertFileLock } from "@/hooks/useFileLocks";

type ToolCallState =
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";

type ToolBlock = Extract<ContentBlock, { type: "tool" }>;

type PendingPermission = {
    permissionId: string;
    toolName: string;
    input: Record<string, unknown>;
};

export type ChatViewProps = {
    sessionId?: string;
    tabId: string;
    initialPrompt?: string;
};

const TOOL_TEXT: Record<string, { pending: string; done: string }> = {
    Read: { pending: "Reading file", done: "Read file" },
    Write: { pending: "Writing file", done: "Wrote file" },
    Edit: { pending: "Editing file", done: "Edited file" },
    Glob: { pending: "Searching files", done: "Searched files" },
    Grep: { pending: "Searching code", done: "Searched code" },
    Bash: { pending: "Running command", done: "Ran command" },
    WebFetch: { pending: "Fetching URL", done: "Fetched URL" },
    WebSearch: { pending: "Searching web", done: "Searched web" },
    Task: { pending: "Running task", done: "Completed task" },
    AskUserQuestion: { pending: "Asking question", done: "Got answer" },
    TodoWrite: { pending: "Updating tasks", done: "Updated tasks" },
    NotebookEdit: { pending: "Editing notebook", done: "Edited notebook" },
    message: { pending: "Sending message", done: "Sent message" },
    screenshot: { pending: "Taking screenshot", done: "Took screenshot" },
    schedule_reminder: { pending: "Scheduling reminder", done: "Scheduled reminder" },
    schedule_recurring: { pending: "Scheduling recurring", done: "Scheduled recurring" },
    schedule_cron: { pending: "Scheduling cron", done: "Scheduled cron" },
    list_reminders: { pending: "Listing reminders", done: "Listed reminders" },
    cancel_reminder: { pending: "Cancelling reminder", done: "Cancelled reminder" },
    browser: { pending: "Using browser", done: "Used browser" },
    goals_view: { pending: "Viewing goals", done: "Viewed goals" },
    goals_add: { pending: "Adding goal", done: "Added goal" },
    goals_update: { pending: "Updating goal", done: "Updated goal" },
    goals_propose: { pending: "Proposing goals", done: "Proposed goals" },
    research_view: { pending: "Viewing research", done: "Viewed research" },
    research_add: { pending: "Adding research", done: "Added research" },
    research_update: { pending: "Updating research", done: "Updated research" },
};

const TOOL_ICONS: Record<string, LucideIcon> = {
    Read: FileText,
    Write: FilePlus,
    Edit: Pencil,
    Glob: FolderSearch,
    Grep: FileSearch,
    Bash: Terminal,
    WebFetch: Globe,
    WebSearch: Search,
    Task: Bot,
    AskUserQuestion: MessageCircle,
    TodoWrite: ListChecks,
    NotebookEdit: FileCode,
    message: MessageSquare,
    screenshot: Camera,
    browser: Monitor,
    schedule_reminder: Clock,
    schedule_recurring: Clock,
    schedule_cron: Clock,
    list_reminders: Clock,
    cancel_reminder: Clock,
    goals_view: LayoutGrid,
    goals_add: LayoutGrid,
    goals_update: LayoutGrid,
    goals_propose: LayoutGrid,
    research_view: FileSearch,
    research_add: FilePlus,
    research_update: Pencil,
};

function asText(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
}

function firstLine(value: string): string {
    return value.split("\n")[0]?.trim() || "";
}

function toolInputDetail(input?: Record<string, unknown>): string {
    if (!input) return "";

    const command = firstLine(asText(input.command));
    if (command) return command;

    const filePath = asText(input.file_path) || asText(input.path);
    if (filePath) return filePath;

    const pattern = asText(input.pattern);
    if (pattern) return pattern;

    const url = asText(input.url);
    if (url) return url;

    const query = asText(input.query);
    if (query) return query;

    const description = asText(input.description);
    if (description) return description;

    return "";
}

function isToolPending(state: ToolCallState): boolean {
    return state === "input-streaming" || state === "input-available";
}

type StreamBlockOrder = {
    turn: number;
    index: number;
};

function parseStreamBlockOrder(blockId: string, assistantMessageId: string): StreamBlockOrder | null {
    const prefix = `${assistantMessageId}-t`;
    if (!blockId.startsWith(prefix)) return null;

    const rest = blockId.slice(prefix.length);
    const [turnPart, indexPart] = rest.split("-");
    const turn = Number(turnPart);
    const index = Number(indexPart);

    if (!Number.isInteger(turn) || !Number.isInteger(index)) return null;
    return { turn, index };
}

function insertBlockByStreamOrder(
    blocks: ContentBlock[],
    assistantMessageId: string,
    newBlock: ContentBlock,
    turn: number,
    index: number
): ContentBlock[] {
    let insertAt = blocks.length;

    for (let i = 0; i < blocks.length; i++) {
        const existingOrder = parseStreamBlockOrder(blocks[i].id, assistantMessageId);
        if (!existingOrder) continue;

        const isAfterNewBlock =
            existingOrder.turn > turn ||
            (existingOrder.turn === turn && existingOrder.index > index);

        if (isAfterNewBlock) {
            insertAt = i;
            break;
        }
    }

    return [...blocks.slice(0, insertAt), newBlock, ...blocks.slice(insertAt)];
}

function toolText(name: string, pending: boolean): string {
    const text = TOOL_TEXT[name];
    if (!text) return pending ? `Running ${name}` : `Ran ${name}`;
    return pending ? text.pending : text.done;
}

function ToolUseItem({ block }: { block: ToolBlock }) {
    const [manualOpen, setManualOpen] = useState<boolean | null>(null);
    const toolCall = block.toolCall;
    const uiData = parseNoetectUIData(toolCall.output);

    if (uiData) {
        return (
            <div className="my-1.5">
                <RenderedUI
                    html={uiData.html}
                    title={uiData.title}
                    height={uiData.height}
                />
            </div>
        );
    }

    const hasOutput = toolCall.output !== undefined || !!toolCall.errorText;
    const pending = isToolPending(toolCall.state) && !hasOutput;
    const hasError = toolCall.state === "output-error";
    const startCollapsed = toolCall.name === "Read" || toolCall.name === "Grep" || toolCall.name === "Glob";
    const isOpen = manualOpen !== null ? manualOpen : (pending && !startCollapsed);
    const detail = toolInputDetail(toolCall.input);
    const label = toolText(toolCall.name, pending);
    const Icon = TOOL_ICONS[toolCall.name] || Wrench;

    return (
        <div className="my-1.5 max-w-xl">
            <Collapsible open={isOpen} onOpenChange={(open) => setManualOpen(open)}>
                {!isOpen && (
                    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs transition-colors hover:bg-secondary/50">
                        <Icon className={cn("size-3.5 shrink-0", hasError ? "text-destructive" : pending ? "text-muted-foreground animate-pulse" : "text-muted-foreground")} />
                        <span className="font-medium text-muted-foreground">{label}</span>
                        <span className="flex-1 truncate text-left text-[11px] text-muted-foreground/70">{detail}</span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </CollapsibleTrigger>
                )}
                <CollapsibleContent forceMount={isOpen ? true : undefined}>
                    {isOpen && (
                        <div className="overflow-hidden rounded-md border border-border/60 bg-card">
                            <div className="flex items-center gap-2 border-b border-border/50 bg-secondary/30 px-3 py-1.5 text-xs">
                                <Icon className={cn("size-3.5 shrink-0", hasError ? "text-destructive" : pending ? "text-muted-foreground animate-pulse" : "text-foreground")} />
                                <span className={cn("font-medium", hasError ? "text-destructive" : "text-foreground")}>{label}</span>
                                <span className="flex-1 truncate text-[11px] text-muted-foreground">{detail}</span>
                                <Badge
                                    variant={hasError ? "destructive" : pending ? "secondary" : "outline"}
                                    className="h-4 rounded-full px-1.5 text-xs uppercase"
                                >
                                    {hasError ? "error" : pending ? "running" : "done"}
                                </Badge>
                                {!pending && (
                                    <button
                                        type="button"
                                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary"
                                        onClick={() => setManualOpen(false)}
                                        title="Collapse"
                                    >
                                        <ChevronDown className="size-3.5" />
                                    </button>
                                )}
                            </div>
                            <div className="bg-background">
                                {toolCall.input && <ToolInput input={toolCall.input} />}
                                {(toolCall.output !== undefined || toolCall.errorText) ? (
                                    <ToolOutput output={toolCall.output ?? null} errorText={toolCall.errorText} />
                                ) : (
                                    <div className="px-3 py-2 text-[11px] text-muted-foreground">Waiting for result...</div>
                                )}
                            </div>
                        </div>
                    )}
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

export default function ChatView({ sessionId: initialSessionId, tabId, initialPrompt }: ChatViewProps) {
    const { setTabName, updateTabProps, activeTab, setActiveTabId, chatInputEnterToSend } = useWorkspaceContext();

    // Capture the initial sessionId at mount time - don't react to prop changes
    // This prevents reloading history when updateTabProps adds sessionId during conversation
    const initialSessionIdRef = useRef(initialSessionId);

    // Chat state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [sessionSaved, setSessionSaved] = useState(!!initialSessionId);
    const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
    const [currentAgentId, setCurrentAgentId] = useState<string | undefined>(undefined);
    const [queryTrackingId, setQueryTrackingId] = useState<string | null>(null);

    // Message queue state
    const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
    const [queuePaused, setQueuePaused] = useState(false);

    const scrollRef = useTabScrollPersistence(tabId);
    const inputRef = useRef<ProseMirrorPromptTextareaHandle>(null);
    const activeTabIdRef = useRef<string | null>(null);
    const isProcessingQueueRef = useRef(false);
    const handleSubmitRef = useRef<((params: { text: string; attachments: Attachment[] }) => Promise<void>) | null>(null);

    // Keep ref in sync with activeTab
    useEffect(() => {
        activeTabIdRef.current = activeTab?.id ?? null;
    }, [activeTab?.id]);

    // Load session history if we have a sessionId at mount, or load agent preferences for new sessions
    // Only runs once on mount - uses ref to avoid reacting to prop changes from updateTabProps
    useEffect(() => {
        if (initialSessionIdRef.current) {
            loadSessionHistory(initialSessionIdRef.current);
        } else {
            // New session - load last used agent from preferences
            agentsAPI.getPreferences().then((prefs) => {
                setCurrentAgentId(prefs.lastUsedAgentId);
            }).catch((err) => {
                console.error("[Chat] Failed to load agent preferences:", err);
                setCurrentAgentId("default");
            });
        }
    }, []);

    // Auto-focus input when tab becomes active or on initial load
    useEffect(() => {
        if (!isLoadingHistory) {
            // Small delay to ensure ProseMirror editor is initialized
            const timer = setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [isLoadingHistory]);

    // Set initial prompt if provided (for pre-populated chats)
    useEffect(() => {
        if (initialPrompt && !isLoadingHistory && !initialSessionId) {
            // Small delay to ensure ProseMirror editor is initialized
            const timer = setTimeout(() => {
                inputRef.current?.setContent(initialPrompt);
                inputRef.current?.focus();
            }, 150);
            return () => clearTimeout(timer);
        }
    }, [initialPrompt, isLoadingHistory, initialSessionId]);

    // Re-focus when switching tabs
    useEffect(() => {
        if (activeTab?.id === tabId && !isLoadingHistory) {
            requestAnimationFrame(() => {
                inputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId, isLoadingHistory]);

    // Update tab name based on first message
    useEffect(() => {
        if (messages.length > 0) {
            const firstUserMessage = messages.find(m => m.role === "user");
            if (firstUserMessage) {
                const textBlock = firstUserMessage.blocks.find(b => b.type === "text");
                if (textBlock && textBlock.type === "text") {
                    const title = textBlock.content.length > 30
                        ? textBlock.content.slice(0, 30) + "..."
                        : textBlock.content;
                    setTabName(tabId, title);
                }
            }
        } else {
            setTabName(tabId, "New Chat");
        }
    }, [messages, tabId, setTabName]);

    async function loadSessionHistory(id: string) {
        try {
            setIsLoadingHistory(true);

            // Fetch both history and session metadata in parallel
            const [historyResponse, sessionsResponse] = await Promise.all([
                fetch(`/api/chat/sessions/history/${id}`),
                fetch("/api/chat/sessions/list"),
            ]);

            if (!historyResponse.ok) {
                const errorData = await historyResponse.json().catch(() => ({}));
                console.error("[Chat] Session history not found:", errorData);
                toast.error(`Session history not found. The session file may have been deleted.`);
                // Clear the sessionId since the session doesn't exist
                setSessionId(undefined);
                setSessionSaved(false);
                return;
            }

            const historyData = await historyResponse.json();
            const sdkMessages = historyData.messages || [];
            const uiMessages = reconstructMessages(sdkMessages);

            setMessages(uiMessages);
            setSessionId(id);
            setSessionSaved(true);

            // Load the session's agentId from metadata
            if (sessionsResponse.ok) {
                const data = await sessionsResponse.json();
                console.log("[Chat] Sessions list response:", typeof data, Array.isArray(data), data);
                const sessions = Array.isArray(data) ? data : (data.sessions || []);
                const sessionMeta = sessions.find((s: { id: string }) => s.id === id);
                if (sessionMeta?.agentId) {
                    setCurrentAgentId(sessionMeta.agentId);
                }
            }
        } catch (error) {
            console.error("[Chat] Error loading session history:", error);
        } finally {
            setIsLoadingHistory(false);
        }
    }

    async function saveSessionMetadata(id: string, title: string, messageCount: number, agentId?: string) {
        try {
            const now = new Date().toISOString();
            const response = await fetch("/api/chat/sessions/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    messageCount,
                    agentId,
                }),
            });

            if (response.ok) {
                setSessionSaved(true);
            }
        } catch (error) {
            console.error("[Chat] Error saving session metadata:", error);
        }
    }

    async function updateSessionMetadata(id: string, messageCount: number) {
        try {
            await fetch("/api/chat/sessions/update", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, messageCount }),
            });
        } catch (error) {
            console.error("[Chat] Error updating session metadata:", error);
        }
    }

    const respondToPermission = useCallback(async (
        decision: "allow" | "deny",
        options?: { permissionId?: string; alwaysAllow?: boolean }
    ) => {
        // Get the ID from the passed param or current pending permission
        const id = options?.permissionId ?? pendingPermission?.permissionId;
        const toolName = pendingPermission?.toolName;
        if (!id) return;

        // Dismiss any toast for this permission
        toast.dismiss(id);

        // Clear the banner immediately (optimistic update)
        setPendingPermission(null);

        try {
            await fetch("/api/chat/permission-response", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    permissionId: id,
                    decision,
                    alwaysAllow: options?.alwaysAllow,
                    toolName,
                }),
            });
        } catch (error) {
            console.error("[Chat] Error sending permission response:", error);
        }
    }, [pendingPermission]);

    // Queue management functions
    const addToQueue = useCallback((text: string, attachments: Attachment[]) => {
        const queuedMessage: QueuedMessage = {
            id: crypto.randomUUID(),
            text,
            attachments,
            createdAt: new Date().toISOString(),
        };
        setMessageQueue((prev) => [...prev, queuedMessage]);
        setQueuePaused(false); // Resume queue when adding new messages
    }, []);

    const removeFromQueue = useCallback((id: string) => {
        setMessageQueue((prev) => prev.filter((m) => m.id !== id));
    }, []);

    const editQueuedMessage = useCallback((id: string, newText: string) => {
        setMessageQueue((prev) =>
            prev.map((m) => (m.id === id ? { ...m, text: newText } : m))
        );
    }, []);

    const reorderQueue = useCallback((reorderedMessages: QueuedMessage[]) => {
        setMessageQueue(reorderedMessages);
    }, []);

    const clearQueue = useCallback(() => {
        setMessageQueue([]);
    }, []);

    const handleSubmit = async ({ text, attachments }: { text: string; attachments: Attachment[] }): Promise<void> => {
        if (!text.trim() && attachments.length === 0) return;

        // If loading, queue the message instead of sending
        if (isLoading) {
            addToQueue(text, attachments);
            return;
        }

        const userMessageId = Date.now().toString();
        const userBlocks: ContentBlock[] = [];

        // Add image blocks for attachments
        attachments.forEach((attachment, idx) => {
            userBlocks.push({
                type: "image",
                content: attachment.url,
                id: `user-image-${userMessageId}-${idx}`,
            } as ContentBlock);
        });

        // Add text block if there's text
        if (text.trim()) {
            userBlocks.push({ type: "text", content: text, id: `user-text-${userMessageId}` });
        }

        const userMessage: ChatMessage = {
            id: userMessageId,
            role: "user",
            blocks: userBlocks,
        };

        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);

        const assistantMessageId = (Date.now() + 1).toString();
        const initialAssistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            blocks: [],
        };
        setMessages((prev) => [...prev, initialAssistantMessage]);

        try {
            // Convert attachments to the format expected by the API
            const imageUrls = attachments.map(a => a.url);

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    images: imageUrls,
                    sessionId,
                    agentId: currentAgentId,
                }),
            });

            if (!response.ok || !response.body) {
                // Try to get detailed error info from response
                let errorDetails = "Failed to get streaming response";
                try {
                    const errorData = await response.json();
                    errorDetails = JSON.stringify(errorData, null, 2);
                } catch {
                    errorDetails = `HTTP ${response.status}: ${response.statusText}`;
                }
                throw new Error(errorDetails);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let currentTurn = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = JSON.parse(line.slice(6));

                        if (data.type === "message") {
                            const msg = data.data;

                            if (data.sessionId && !sessionId) {
                                setSessionId(data.sessionId);

                                // Update tab props with the new sessionId so the tab persists across switches
                                updateTabProps(tabId, { sessionId: data.sessionId });

                                // Save session immediately when we get the ID (not waiting for done)
                                if (!sessionSaved) {
                                    setSessionSaved(true); // Prevent duplicate saves
                                    const title = text.length > 60 ? text.slice(0, 60) + "..." : text;
                                    saveSessionMetadata(data.sessionId, title, 1, currentAgentId);
                                }
                            }

                            // Track the query ID for cancellation
                            if (data.queryTrackingId) {
                                setQueryTrackingId(data.queryTrackingId);
                            }

                            if (msg.type === "stream_event" && msg.event) {
                                const event = msg.event;
                                const streamIndex = event.index;

                                if (event.type === "message_start") {
                                    currentTurn++;
                                }

                                const blockId = `${assistantMessageId}-t${currentTurn}-${streamIndex}`;

                                if (event.type === "content_block_start" && event.content_block && streamIndex !== undefined) {
                                    const blockType = event.content_block.type;

                                    if (blockType === "text") {
                                        setMessages((prev) =>
                                            prev.map((m) => {
                                                if (m.id !== assistantMessageId) return m;
                                                if (m.blocks.some((b) => b.id === blockId)) return m;
                                                return {
                                                    ...m,
                                                    blocks: insertBlockByStreamOrder(
                                                        m.blocks,
                                                        assistantMessageId,
                                                        { type: "text", content: "", id: blockId },
                                                        currentTurn,
                                                        streamIndex
                                                    ),
                                                };
                                            })
                                        );
                                    } else if (blockType === "thinking") {
                                        setMessages((prev) =>
                                            prev.map((m) => {
                                                if (m.id !== assistantMessageId) return m;
                                                if (m.blocks.some((b) => b.id === blockId)) return m;
                                                return {
                                                    ...m,
                                                    blocks: insertBlockByStreamOrder(
                                                        m.blocks,
                                                        assistantMessageId,
                                                        { type: "thinking", content: "", id: blockId },
                                                        currentTurn,
                                                        streamIndex
                                                    ),
                                                };
                                            })
                                        );
                                    } else if (blockType === "tool_use" && event.content_block.id) {
                                        const toolId = event.content_block.id;
                                        setMessages((prev) =>
                                            prev.map((m) => {
                                                if (m.id !== assistantMessageId) return m;
                                                if (m.blocks.some((b) => b.type === "tool" && b.toolCall.id === toolId)) return m;
                                                return {
                                                    ...m,
                                                    blocks: [...m.blocks, {
                                                        type: "tool",
                                                        id: toolId,
                                                        toolCall: {
                                                            id: toolId,
                                                            name: event.content_block.name || "unknown",
                                                            state: "input-streaming" as const,
                                                            input: {},
                                                        },
                                                    }],
                                                };
                                            })
                                        );
                                    }
                                }

                                if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && streamIndex !== undefined) {
                                    const deltaText = event.delta.text || "";
                                    if (deltaText) {
                                        setMessages((prev) =>
                                            prev.map((m) => {
                                                if (m.id !== assistantMessageId) return m;
                                                const updatedBlocks = m.blocks.map((block) => {
                                                    if (block.id === blockId && block.type === "text") {
                                                        return { ...block, content: block.content + deltaText };
                                                    }
                                                    return block;
                                                });
                                                return { ...m, blocks: updatedBlocks };
                                            })
                                        );
                                    }
                                }

                                if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta" && streamIndex !== undefined) {
                                    const deltaThinking = event.delta.thinking || "";
                                    if (deltaThinking) {
                                        setMessages((prev) =>
                                            prev.map((m) => {
                                                if (m.id !== assistantMessageId) return m;
                                                const updatedBlocks = m.blocks.map((block) => {
                                                    if (block.id === blockId && block.type === "thinking") {
                                                        return { ...block, content: block.content + deltaThinking };
                                                    }
                                                    return block;
                                                });
                                                return { ...m, blocks: updatedBlocks };
                                            })
                                        );
                                    }
                                }

                                continue;
                            }

                            if (msg.type === "assistant" && msg.message) {
                                const content = msg.message.content;
                                const textStr = content
                                    .filter((block: { type: string }) => block.type === "text")
                                    .map((block: { text?: string }) => block.text || "")
                                    .join("");

                                const thinking = content
                                    .filter((block: { type: string }) => block.type === "thinking")
                                    .map((block: { thinking?: string }) => block.thinking || "")
                                    .join("\n\n");

                                const toolUseBlocks = content.filter(
                                    (block: { type: string }) => block.type === "tool_use"
                                );

                                if (textStr || thinking || toolUseBlocks.length > 0) {
                                    setMessages((prev) =>
                                        prev.map((m) => {
                                            if (m.id !== assistantMessageId) return m;

                                            const newBlocks: ContentBlock[] = [];
                                            const hasExistingText = m.blocks.some((b) => b.type === "text" && b.content.length > 0);
                                            const hasExistingThinking = m.blocks.some((b) => b.type === "thinking" && b.content.length > 0);

                                            let updatedBlocks = m.blocks.map((block) => {
                                                if (block.type !== "tool") return block;
                                                const matchingTool = toolUseBlocks.find(
                                                    (tb: { id: string }) => tb.id === block.toolCall.id
                                                );
                                                if (matchingTool) {
                                                    return {
                                                        ...block,
                                                        toolCall: {
                                                            ...block.toolCall,
                                                            state: "input-available" as const,
                                                            input: matchingTool.input,
                                                        },
                                                    };
                                                }
                                                return block;
                                            });

                                            if (thinking && !hasExistingThinking) {
                                                updatedBlocks = updatedBlocks.filter((b) => !(b.type === "thinking" && b.content.length === 0));
                                                newBlocks.push({ type: "thinking", content: thinking, id: `thinking-${Date.now()}` });
                                            }

                                            if (textStr && !hasExistingText) {
                                                updatedBlocks = updatedBlocks.filter((b) => !(b.type === "text" && b.content.length === 0));
                                                newBlocks.push({ type: "text", content: textStr, id: `text-${Date.now()}` });
                                            }

                                            if (toolUseBlocks.length > 0) {
                                                const existingToolIds = new Set(
                                                    updatedBlocks
                                                        .filter((b): b is Extract<ContentBlock, { type: "tool" }> => b.type === "tool")
                                                        .map((b) => b.toolCall.id)
                                                );

                                                toolUseBlocks.forEach(
                                                    (block: { id: string; name: string; input: Record<string, unknown> }) => {
                                                        if (!existingToolIds.has(block.id)) {
                                                            newBlocks.push({
                                                                type: "tool",
                                                                id: block.id,
                                                                toolCall: {
                                                                    id: block.id,
                                                                    name: block.name,
                                                                    state: "input-available",
                                                                    input: block.input,
                                                                },
                                                            });
                                                        }
                                                    }
                                                );
                                            }

                                            return { ...m, blocks: [...updatedBlocks, ...newBlocks] };
                                        })
                                    );
                                }
                            } else if (msg.type === "user" && msg.tool_use_result) {
                                const toolUseId = msg.message?.content?.find(
                                    (block: { type: string; tool_use_id?: string }) => block.type === "tool_result"
                                )?.tool_use_id;

                                if (toolUseId) {
                                    setMessages((prev) =>
                                        prev.map((m) => {
                                            const updatedBlocks = m.blocks.map((block) => {
                                                if (block.type !== "tool" || block.toolCall.id !== toolUseId) return block;

                                                const isError = msg.message?.content?.find(
                                                    (c: { type: string; tool_use_id?: string; is_error?: boolean }) =>
                                                        c.type === "tool_result" && c.tool_use_id === toolUseId
                                                )?.is_error;

                                                return {
                                                    ...block,
                                                    toolCall: {
                                                        ...block.toolCall,
                                                        state: isError ? ("output-error" as ToolCallState) : ("output-available" as ToolCallState),
                                                        output: msg.tool_use_result,
                                                        errorText: isError ? String(msg.tool_use_result) : undefined,
                                                    },
                                                };
                                            });
                                            return { ...m, blocks: updatedBlocks };
                                        })
                                    );
                                }
                            }
                        } else if (data.type === "permission_request") {
                            const permission = {
                                permissionId: data.permissionId,
                                toolName: data.toolName,
                                input: data.input,
                            };
                            setPendingPermission(permission);

                            // Show toast if this chat tab is not active
                            // Use ref to get current value (activeTab would be stale in this closure)
                            if (activeTabIdRef.current !== tabId) {
                                toast(`Allow ${data.toolName}?`, {
                                    duration: Infinity,
                                    id: data.permissionId,
                                    action: {
                                        label: "Always",
                                        onClick: () => {
                                            respondToPermission("allow", {
                                                permissionId: data.permissionId,
                                                alwaysAllow: true
                                            });
                                        },
                                    },
                                    cancel: {
                                        label: "View",
                                        onClick: () => {
                                            setActiveTabId(tabId);
                                            toast.dismiss(data.permissionId);
                                        },
                                    },
                                });
                            }
                        } else if (data.type === "file_lock") {
                            if (data.lock) {
                                upsertFileLock(data.lock);
                            }
                        } else if (data.type === "file_unlock") {
                            if (data.noteFileName) {
                                removeFileLock(data.noteFileName);
                            }
                        } else if (data.type === "done") {
                            // Clear query tracking - query is complete
                            setQueryTrackingId(null);

                            // Update current agent ID from response
                            if (data.agentId) {
                                setCurrentAgentId(data.agentId);
                            }

                            // Update session with final message count (session was already saved on init)
                            if (data.sessionId || sessionId) {
                                const currentMessageCount = messages.length + 2;
                                await updateSessionMetadata(data.sessionId || sessionId!, currentMessageCount);
                            }
                        } else if (data.type === "cancelled") {
                            // User cancelled - not an error, just stop processing
                            console.log("[Chat] Query was cancelled by user");
                            break;
                        } else if (data.type === "error") {
                            throw new Error(data.error);
                        }
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Check if this is a user-initiated cancellation (not a real error)
            const isAbort = errorMessage.includes("aborted by user") ||
                            errorMessage.includes("AbortError") ||
                            (error instanceof Error && error.name === "AbortError");

            if (isAbort) {
                console.log("[Chat] Query was cancelled");
                // Optionally add a "Cancelled" indicator to the message
                setMessages((prev) =>
                    prev.map((m) => {
                        if (m.id !== assistantMessageId) return m;
                        // Only add cancelled message if there's no content yet
                        if (m.blocks.length === 0 || (m.blocks.length === 1 && m.blocks[0].type === "text" && !m.blocks[0].content)) {
                            return { ...m, blocks: [{ type: "text", content: "*Cancelled*", id: `cancelled-${Date.now()}` }] };
                        }
                        return m;
                    })
                );
                // Pause the queue on cancel
                if (messageQueue.length > 0) {
                    setQueuePaused(true);
                    toast.info(`Queue paused. ${messageQueue.length} message${messageQueue.length > 1 ? "s" : ""} remaining.`);
                }
            } else {
                console.error("Error sending message:", error);
                const errorContent = `**Error:** ${errorMessage}`;
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === assistantMessageId
                            ? { ...m, blocks: [{ type: "text", content: errorContent, id: `error-${Date.now()}` }] }
                            : m
                    )
                );
                // Pause the queue on error
                if (messageQueue.length > 0) {
                    setQueuePaused(true);
                    toast.error(`Queue paused due to error. ${messageQueue.length} message${messageQueue.length > 1 ? "s" : ""} remaining.`);
                }
            }
        } finally {
            setIsLoading(false);
            setQueryTrackingId(null);
            isProcessingQueueRef.current = false;
        }
    };

    // Keep ref in sync with handleSubmit for use in effects
    handleSubmitRef.current = handleSubmit;

    const handleCancel = useCallback(async () => {
        if (!queryTrackingId) return;

        try {
            const response = await fetch("/api/chat/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ queryTrackingId }),
            });

            if (response.ok) {
                console.log("[Chat] Cancelled query:", queryTrackingId);
            } else {
                console.error("[Chat] Failed to cancel query:", await response.text());
            }
        } catch (error) {
            console.error("[Chat] Error cancelling query:", error);
        }
    }, [queryTrackingId]);

    // Process queue when isLoading becomes false and queue has items
    useEffect(() => {
        if (!isLoading && messageQueue.length > 0 && !queuePaused && !isProcessingQueueRef.current) {
            isProcessingQueueRef.current = true;
            const nextMessage = messageQueue[0];
            setMessageQueue((prev) => prev.slice(1));

            // Small delay to ensure state is settled before sending next message
            // Note: We intentionally don't return a cleanup function because the ref guard
            // prevents double-processing, and clearing the timeout would break the queue
            setTimeout(() => {
                handleSubmitRef.current?.({ text: nextMessage.text, attachments: nextMessage.attachments });
            }, 50);
        }
    }, [isLoading, messageQueue, queuePaused]);

    const sessionStatus = sessionId ? (sessionSaved ? "Saved session" : "Unsaved session") : "New session";
    const showBootstrapLoader = isLoading && !(messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1].blocks.length > 0);

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
            <div className="shrink-0 border-b border-border px-4 py-2.5">
                <div className="mx-auto flex w-full max-w-3xl min-w-0 items-center gap-2">
                    <MessageSquare className="size-3.5 text-primary" />
                    <span className="truncate text-[11px] font-medium uppercase tracking-[0.14em]">Chat</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                        {sessionStatus} • {isLoading ? "running" : "ready"}
                    </span>
                    {messageQueue.length > 0 && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                            queue {messageQueue.length}
                        </span>
                    )}
                </div>
            </div>

            <OverlayScrollbar scrollRef={scrollRef} className="min-h-0 flex-1">
                {isLoadingHistory ? (
                    <div className="flex h-full min-h-0 flex-col items-center justify-center">
                        <Loader />
                        <p className="mt-4 text-xs text-muted-foreground">Loading session...</p>
                    </div>
                ) : (
                    <Conversation className="min-h-0">
                        <ConversationContent className="max-w-3xl gap-2 px-4 pb-6 pt-3">
                            {messages.map((message, messageIndex) => {
                                if (message.role === "user") {
                                    return (
                                        <div key={message.id} className="space-y-1">
                                            {message.blocks.map((block) => {
                                                if (block.type === "image") {
                                                    return (
                                                        <img
                                                            key={block.id}
                                                            src={block.content}
                                                            alt="Attached image"
                                                            className="max-h-56 max-w-xs cursor-pointer rounded-md border border-border/50 object-cover"
                                                            onClick={() => window.open(block.content, "_blank")}
                                                        />
                                                    );
                                                }
                                                if (block.type === "text") {
                                                    return (
                                                        <div key={block.id} className="my-1 flex min-w-0 gap-2 rounded-md bg-secondary px-2 py-1.5 text-sm">
                                                            <span className="shrink-0 font-semibold text-primary">{">"}</span>
                                                            <span className="min-w-0 break-words whitespace-pre-wrap text-foreground">{block.content}</span>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })}
                                        </div>
                                    );
                                }

                                const isStreamingMessage = isLoading && messageIndex === messages.length - 1;
                                const lastTextBlockId = [...message.blocks].reverse().find((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")?.id;
                                const lastThinkingBlockId = [...message.blocks].reverse().find((b): b is Extract<ContentBlock, { type: "thinking" }> => b.type === "thinking")?.id;

                                return (
                                    <div key={message.id} className="space-y-1.5">
                                        {message.blocks.map((block) => {
                                            if (block.type === "thinking") {
                                                return (
                                                    <div
                                                        key={block.id}
                                                        className="my-1 min-w-0 break-words whitespace-pre-wrap border-l-2 border-border pl-2 text-xs italic text-muted-foreground"
                                                    >
                                                        {block.content}
                                                        {isStreamingMessage && block.id === lastThinkingBlockId && <span className="streaming-cursor" />}
                                                    </div>
                                                );
                                            }

                                            if (block.type === "image") {
                                                return (
                                                    <img
                                                        key={block.id}
                                                        src={block.content}
                                                        alt="Generated image"
                                                        className="max-h-72 max-w-sm rounded-md border border-border/50 object-cover"
                                                    />
                                                );
                                            }

                                            if (block.type === "text") {
                                                return (
                                                    <div key={block.id} className="prose-chat py-1.5 text-sm">
                                                        <MessageResponse>{block.content}</MessageResponse>
                                                        {isStreamingMessage && block.id === lastTextBlockId && <span className="streaming-cursor" />}
                                                    </div>
                                                );
                                            }

                                            if (block.type === "tool") {
                                                return <ToolUseItem key={block.id} block={block} />;
                                            }

                                            return null;
                                        })}
                                    </div>
                                );
                            })}

                            {showBootstrapLoader && (
                                <div className="flex w-full items-center gap-2 py-1.5 text-xs text-muted-foreground">
                                    <Bot className="size-3.5" />
                                    <Loader />
                                </div>
                            )}
                        </ConversationContent>
                    </Conversation>
                )}
            </OverlayScrollbar>

            {/* Permission Request Banner */}
            {pendingPermission && (
                <div className="mx-auto w-full max-w-3xl px-4 pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-2.5 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                                Allow <span className="font-mono text-foreground">{pendingPermission.toolName}</span>?
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => respondToPermission("deny")}
                            >
                                Deny
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => respondToPermission("allow")}
                            >
                                Allow
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => respondToPermission("allow", { alwaysAllow: true })}
                            >
                                Always Allow
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-1">
                {/* Queued messages list */}
                <QueuedMessagesList
                    messages={messageQueue}
                    onRemove={removeFromQueue}
                    onEdit={editQueuedMessage}
                    onReorder={reorderQueue}
                    onClearAll={clearQueue}
                />

                {/* Queue paused banner */}
                {queuePaused && messageQueue.length > 0 && (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-2.5 py-2 text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <PauseCircle className="h-3.5 w-3.5" />
                            Queue paused ({messageQueue.length} remaining)
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setQueuePaused(false)}
                        >
                            Resume
                        </Button>
                    </div>
                )}

                <div className="rounded-2xl border border-border bg-card p-2 chat-input-area">
                    <ProseMirrorPromptInput onSubmit={handleSubmit} className="border-0 bg-transparent shadow-none">
                        <ProseMirrorPromptTextarea
                            ref={inputRef}
                            placeholder={isLoading ? "Type to queue next message..." : "Message..."}
                            disabled={!!pendingPermission}
                            enterToSend={chatInputEnterToSend}
                            className="min-h-[64px] [&_.pm-chat-input]:text-[11px] [&>div.absolute]:text-[11px]"
                        />
                        <ProseMirrorPromptFooter className="justify-between">
                            <div className="flex items-center gap-1">
                                <AgentSelector
                                    currentAgentId={currentAgentId}
                                    onAgentChange={setCurrentAgentId}
                                    disabled={isLoading}
                                />
                                <ProseMirrorPromptAttach disabled={!!pendingPermission} />
                                {messageQueue.length > 0 && (
                                    <Badge variant="outline" className="h-5 px-2 text-[10px]">
                                        queue {messageQueue.length}
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                {isLoading && (
                                    <Button
                                        type="button"
                                        onClick={handleCancel}
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-lg p-0"
                                        title="Stop"
                                    >
                                        <StopCircle className="h-4 w-4" />
                                    </Button>
                                )}
                                {isLoading ? (
                                    <Button
                                        type="submit"
                                        size="icon"
                                        className="h-8 w-8 rounded-lg p-0"
                                        disabled={!!pendingPermission}
                                        title="Queue message"
                                    >
                                        <ListPlus className="h-4 w-4" />
                                    </Button>
                                ) : (
                                    <ProseMirrorPromptSubmit disabled={!!pendingPermission} className="rounded-lg" />
                                )}
                            </div>
                        </ProseMirrorPromptFooter>
                    </ProseMirrorPromptInput>
                    <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                        {chatInputEnterToSend ? "Enter sends, Shift+Enter adds a new line." : "Enter adds a new line."}
                    </p>
                </div>
            </div>
        </div>
    );
}
