import { useEffect, useState, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Search, MessageCircle, Plus, Trash2, Maximize2, Bot, UserRound, ChevronRight } from "lucide-react";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useTheme } from "@/hooks/useTheme";
import { DeleteChatSessionDialog } from "./delete-chat-session-dialog";
import { useChannelEvents } from "@/features/channels/useChannelEvents";
import type { UnifiedMessage, UnifiedThread } from "@/features/channels/types";
import { chatPluginSerial } from "./index";
import {
    Message,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";

// Helper: Format relative time
function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

// Helper: Highlight matching text in content
function highlightMatches(
    text: string,
    query: string,
    accentColor: string
): ReactNode {
    if (!query.trim()) return text;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);

    if (parts.length === 1) return text;

    return parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
            return (
                <mark
                    key={i}
                    style={{
                        backgroundColor: accentColor + "30",
                        color: "inherit",
                        padding: "0 1px",
                    }}
                >
                    {part}
                </mark>
            );
        }
        return part;
    });
}

function channelBadgeLabel(channel: UnifiedThread["channel"]): string {
    return channel === "telegram" ? "Telegram" : "App";
}

function messageMetaLabel(message: UnifiedMessage, thread: UnifiedThread | null): string {
    if (!thread || thread.channel === "app") {
        return message.role === "user" ? "You" : "Agent";
    }

    return message.role === "user" ? (thread.externalUsername ? `@${thread.externalUsername}` : "Contact") : "You";
}

export default function ChatBrowserView({ tabId, initialChannel = "all" }: { tabId: string; initialChannel?: "all" | "app" | "telegram" }) {
    const { setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId, activeTab } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const { openDialog } = useCommandDialog();

    const [channelFilter, setChannelFilter] = useState<"all" | "app" | "telegram">(initialChannel);
    const [threads, setThreads] = useState<UnifiedThread[]>([]);
    const [isLoadingThreads, setIsLoadingThreads] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedThread, setSelectedThread] = useState<UnifiedThread | null>(null);
    const [selectedMessages, setSelectedMessages] = useState<UnifiedMessage[]>([]);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const selectedRowRef = useRef<HTMLDivElement | null>(null);
    const selectedThreadRef = useRef<UnifiedThread | null>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const placement = getViewSelfPlacement(tabId);

    useEffect(() => {
        selectedThreadRef.current = selectedThread;
    }, [selectedThread]);

    // Set tab name
    useEffect(() => {
        setTabName(tabId, "Chat History");
    }, [tabId, setTabName]);

    const loadThreads = useCallback(async () => {
        try {
            setIsLoadingThreads(true);
            const url = new URL("/api/channels/threads", window.location.origin);
            url.searchParams.set("channel", channelFilter);
            if (searchQuery.trim()) {
                url.searchParams.set("query", searchQuery.trim());
            }

            const response = await fetch(`${url.pathname}${url.search}`);
            const data = await response.json();
            const loadedThreads: UnifiedThread[] = data.threads || [];

            setThreads(loadedThreads);

            if (loadedThreads.length === 0) {
                setSelectedIndex(0);
                setSelectedThread(null);
                setSelectedMessages([]);
                return;
            }

            const nextSelection = selectedThreadRef.current
                ? loadedThreads.find((thread) => thread.id === selectedThreadRef.current?.id) || loadedThreads[0]
                : loadedThreads[0];

            setSelectedThread(nextSelection);
            const nextIndex = loadedThreads.findIndex((thread) => thread.id === nextSelection.id);
            setSelectedIndex(Math.max(nextIndex, 0));
        } catch (error) {
            console.error("[ChatBrowser] Failed to load threads:", error);
            setThreads([]);
            setSelectedThread(null);
            setSelectedMessages([]);
        } finally {
            setIsLoadingThreads(false);
        }
    }, [channelFilter, searchQuery]);

    // Refetch threads and focus search when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId) {
            void loadThreads();
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId, loadThreads]);

    // Debounce search / channel filter changes
    useEffect(() => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        searchTimeoutRef.current = setTimeout(() => {
            void loadThreads();
        }, 250);

        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [searchQuery, channelFilter, loadThreads]);

    // Load messages for selected thread
    useEffect(() => {
        async function loadMessages() {
            if (!selectedThread) {
                setSelectedMessages([]);
                return;
            }

            try {
                setIsLoadingMessages(true);
                const response = await fetch(`/api/channels/threads/${encodeURIComponent(selectedThread.id)}`);
                if (!response.ok) throw new Error("Failed to load messages");
                const data = await response.json();
                setSelectedMessages(data.messages || []);
            } catch (error) {
                console.error("[ChatBrowser] Failed to load thread messages:", error);
                setSelectedMessages([]);
            } finally {
                setIsLoadingMessages(false);
            }
        }

        void loadMessages();
    }, [selectedThread]);

    // Refresh on realtime channel events
    useChannelEvents((event) => {
        if (
            event.id === "channel.message.received"
            || event.id === "channel.message.sent"
            || event.id === "channel.thread.updated"
            || event.id === "channel.backlog.drained"
        ) {
            void loadThreads();
            if (selectedThread) {
                void fetch(`/api/channels/threads/${encodeURIComponent(selectedThread.id)}`)
                    .then((res) => res.json())
                    .then((data) => setSelectedMessages(data.messages || []))
                    .catch(() => undefined);
            }
        }
    });

    // Ensure selected item is visible
    useEffect(() => {
        selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedIndex]);

    const handleOpenChat = useCallback(
        async (thread: UnifiedThread) => {
            const props = thread.channel === "app"
                ? { sessionId: thread.sessionId, channel: "app" as const }
                : { threadId: thread.id, channel: "telegram" as const };

            const newTab = await addNewTab({
                pluginMeta: chatPluginSerial,
                view: "chat",
                props,
                preferExisting: true,
            });
            if (newTab) {
                if (placement === "sidebar") {
                    setSidebarTabId(newTab.id);
                } else {
                    setActiveTabId(newTab.id);
                }
            }
        },
        [addNewTab, setActiveTabId, placement, setSidebarTabId]
    );

    const handleNewChat = useCallback(async () => {
        const newTab = await addNewTab({
            pluginMeta: chatPluginSerial,
            view: "chat",
            props: { channel: "app" },
        });
        if (newTab) {
            if (placement === "sidebar") {
                setSidebarTabId(newTab.id);
            } else {
                setActiveTabId(newTab.id);
            }
        }
    }, [addNewTab, setActiveTabId, placement, setSidebarTabId]);

    const handleDeleteThread = (thread: UnifiedThread, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (thread.channel !== "app" || !thread.sessionId) {
            return;
        }

        const handleSuccess = () => {
            const remaining = threads.filter((item) => item.id !== thread.id);
            setThreads(remaining);
            if (selectedThread?.id === thread.id) {
                setSelectedThread(remaining[0] || null);
                setSelectedIndex(0);
            }
        };

        openDialog({
            content: (
                <DeleteChatSessionDialog
                    sessionId={thread.sessionId}
                    onSuccess={handleSuccess}
                />
            ),
        });
    };

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (threads.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            const newIndex = (selectedIndex + 1) % threads.length;
            setSelectedIndex(newIndex);
            setSelectedThread(threads[newIndex] || null);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const newIndex = (selectedIndex - 1 + threads.length) % threads.length;
            setSelectedIndex(newIndex);
            setSelectedThread(threads[newIndex] || null);
        } else if (e.key === "Enter" && selectedThread) {
            e.preventDefault();
            void handleOpenChat(selectedThread);
        } else if (e.key === "Escape") {
            if (searchQuery) {
                setSearchQuery("");
            } else {
                searchInputRef.current?.blur();
            }
        }
    };

    const styles = currentTheme.styles;

    return (
        <div
            className="h-full flex flex-col"
            style={{ backgroundColor: styles.surfacePrimary }}
        >
            <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Left Panel - Thread List */}
                <div
                    className="w-72 shrink-0 overflow-hidden border-r flex flex-col h-full min-h-0"
                    style={{
                        backgroundColor: styles.surfacePrimary,
                        borderColor: styles.borderDefault,
                    }}
                >
                    <div
                        className="shrink-0 px-4 py-2.5 border-b space-y-2"
                        style={{
                            backgroundColor: styles.surfacePrimary,
                            borderColor: styles.borderDefault,
                        }}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <MessageCircle size={15} style={{ color: styles.contentAccent }} />
                                <h2
                                    className="text-xs font-medium uppercase tracking-[0.14em] truncate"
                                    style={{ color: styles.contentPrimary }}
                                >
                                    Chats
                                </h2>
                                <span
                                    className="text-caption shrink-0"
                                    style={{ color: styles.contentTertiary }}
                                >
                                    ({threads.length})
                                </span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={handleNewChat}
                                    title="New chat"
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="flex items-center gap-1">
                            {(["all", "app", "telegram"] as const).map((channel) => (
                                <button
                                    key={channel}
                                    onClick={() => setChannelFilter(channel)}
                                    className="px-2.5 py-1 rounded text-xs transition-colors"
                                    style={{
                                        backgroundColor: channelFilter === channel ? styles.surfaceAccent : "transparent",
                                        color: channelFilter === channel ? styles.contentPrimary : styles.contentSecondary,
                                    }}
                                >
                                    {channel === "all" ? "All" : channel === "app" ? "App" : "Telegram"}
                                </button>
                            ))}
                        </div>

                        <div className="relative">
                            <Search
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4"
                                style={{ color: styles.contentTertiary }}
                            />
                            <Input
                                ref={searchInputRef}
                                placeholder="Search chats..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="h-8 pl-8 text-xs bg-transparent"
                                style={{
                                    backgroundColor: styles.surfaceSecondary,
                                    borderColor: styles.borderDefault,
                                    color: styles.contentPrimary,
                                }}
                                autoFocus
                            />
                        </div>
                    </div>

                    <div
                        className="flex-1 overflow-hidden outline-none"
                        tabIndex={0}
                        onKeyDown={handleKeyDown}
                    >
                        <div className="h-full overflow-y-auto overflow-x-hidden">
                            <div className="px-2 py-2 space-y-1.5">
                                {isLoadingThreads ? (
                                    <div className="p-6 text-center" style={{ color: styles.contentSecondary }}>
                                        <p className="text-xs">Loading...</p>
                                    </div>
                                ) : threads.length === 0 ? (
                                    <div className="p-6 text-center" style={{ color: styles.contentSecondary }}>
                                        {searchQuery ? (
                                            <p className="text-xs">No chats match "{searchQuery}"</p>
                                        ) : (
                                            <div className="space-y-2">
                                                <MessageCircle className="h-12 w-12 mx-auto" style={{ color: styles.contentTertiary }} />
                                                <p className="text-xs">No chats yet</p>
                                                {channelFilter !== "telegram" && (
                                                    <Button size="sm" className="h-7 px-2 text-xs" onClick={handleNewChat}>
                                                        <Plus className="h-4 w-4 mr-1" /> Start a chat
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    threads.map((thread, index) => {
                                        const isSelected = index === selectedIndex;
                                        return (
                                            <div
                                                key={thread.id}
                                                ref={isSelected ? selectedRowRef : undefined}
                                                className="group relative min-w-0 overflow-hidden rounded-lg border transition-colors"
                                                style={{
                                                    borderColor: isSelected ? styles.surfaceAccent : styles.borderDefault,
                                                    backgroundColor: styles.surfaceSecondary,
                                                }}
                                                onMouseEnter={() => {
                                                    setSelectedIndex(index);
                                                    setSelectedThread(thread);
                                                }}
                                            >
                                                <button
                                                    className="w-full px-2.5 py-2 text-left"
                                                    onClick={() => void handleOpenChat(thread)}
                                                    style={{
                                                        backgroundColor: isSelected ? styles.surfaceAccent : "transparent",
                                                    }}
                                                >
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className="truncate text-xs font-medium"
                                                            style={{ color: styles.contentPrimary }}
                                                        >
                                                            {thread.title}
                                                        </span>
                                                        {channelFilter === "all" && (
                                                            <span className="text-[9px] uppercase shrink-0" style={{ color: styles.contentTertiary }}>
                                                                {channelBadgeLabel(thread.channel)}
                                                            </span>
                                                        )}
                                                        {thread.channel === "app" && thread.sessionId && (
                                                            <span
                                                                className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-red-500"
                                                                style={{ color: styles.contentTertiary }}
                                                                onClick={(e) => {
                                                                    handleDeleteThread(thread, e);
                                                                }}
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </span>
                                                        )}
                                                        <ChevronRight
                                                            className={thread.channel === "app" && thread.sessionId
                                                                ? "size-3 opacity-60 shrink-0"
                                                                : "ml-auto size-3 opacity-60 shrink-0"
                                                            }
                                                            style={{ color: styles.contentTertiary }}
                                                        />
                                                    </div>
                                                    <div
                                                        className="mt-0.5 text-caption truncate"
                                                        style={{ color: styles.contentTertiary }}
                                                    >
                                                        {formatRelativeTime(thread.updatedAt)} • {thread.messageCount} messages
                                                    </div>
                                                    {!!thread.preview && (
                                                        <div
                                                            className="mt-1 text-caption line-clamp-1"
                                                            style={{ color: styles.contentSecondary }}
                                                        >
                                                            {highlightMatches(thread.preview, searchQuery, styles.contentAccent)}
                                                        </div>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Panel - Chat Preview */}
                <div
                    className="flex-1 flex flex-col overflow-hidden relative min-w-0"
                    style={{ backgroundColor: styles.surfacePrimary }}
                >
                    {selectedThread ? (
                        <>
                            <div
                                className="shrink-0 px-4 py-2.5 border-b"
                                style={{
                                    backgroundColor: styles.surfacePrimary,
                                    borderColor: styles.borderDefault,
                                }}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <MessageCircle size={15} style={{ color: styles.contentAccent }} />
                                        <h2
                                            className="text-xs font-medium uppercase tracking-[0.14em] truncate"
                                            style={{ color: styles.contentPrimary }}
                                        >
                                            Preview
                                        </h2>
                                        <span
                                            className="text-caption shrink-0"
                                            style={{ color: styles.contentTertiary }}
                                        >
                                            ({selectedThread.messageCount})
                                        </span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => void handleOpenChat(selectedThread)}
                                        title="Open chat in new tab"
                                    >
                                        <Maximize2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {isLoadingMessages ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <p className="text-xs" style={{ color: styles.contentSecondary }}>
                                        Loading messages...
                                    </p>
                                </div>
                            ) : (
                                <ScrollArea className="flex-1">
                                    <div className="mx-auto max-w-3xl min-w-0 space-y-3 p-4">
                                        {selectedMessages.map((message) => (
                                            <Message key={message.id} from={message.role}>
                                                <div
                                                    className={message.role === "user"
                                                        ? "ml-auto w-fit max-w-[90%] min-w-0 overflow-hidden rounded-lg border px-2.5 py-2"
                                                        : "w-full min-w-0 overflow-hidden rounded-lg border px-2.5 py-2"
                                                    }
                                                    style={{
                                                        borderColor: styles.borderDefault,
                                                        backgroundColor: message.role === "user" ? styles.surfaceAccent : styles.surfaceSecondary,
                                                    }}
                                                >
                                                    <div
                                                        className={message.role === "user"
                                                            ? "mb-1 flex items-center justify-end gap-1.5 text-caption uppercase tracking-[0.08em]"
                                                            : "mb-1 flex items-center gap-1.5 text-caption uppercase tracking-[0.08em]"
                                                        }
                                                        style={{ color: styles.contentSecondary }}
                                                    >
                                                        {message.role === "user" ? (
                                                            <>
                                                                <span>{messageMetaLabel(message, selectedThread)}</span>
                                                                <UserRound className="h-3.5 w-3.5" />
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Bot className="h-3.5 w-3.5" />
                                                                <span>{messageMetaLabel(message, selectedThread)}</span>
                                                            </>
                                                        )}
                                                    </div>

                                                    <MessageContent>
                                                        {searchQuery.trim() ? (
                                                            <div className="whitespace-pre-wrap break-words overflow-hidden">
                                                                {highlightMatches(message.text, searchQuery, styles.contentAccent)}
                                                            </div>
                                                        ) : (
                                                            <MessageResponse>{message.text}</MessageResponse>
                                                        )}
                                                    </MessageContent>
                                                </div>
                                            </Message>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}
                        </>
                    ) : !isLoadingThreads && threads.length > 0 ? (
                        <div className="flex-1 flex items-center justify-center p-6">
                            <div className="text-center space-y-2">
                                <MessageCircle
                                    className="h-12 w-12 mx-auto"
                                    style={{ color: styles.contentTertiary }}
                                />
                                <p className="text-xs" style={{ color: styles.contentSecondary }}>
                                    Select a chat to preview
                                </p>
                            </div>
                        </div>
                    ) : !isLoadingThreads ? (
                        <div className="flex-1 flex items-center justify-center p-6">
                            <div className="text-center space-y-3">
                                <MessageCircle className="h-12 w-12 mx-auto" style={{ color: styles.contentTertiary }} />
                                <p className="text-xs" style={{ color: styles.contentSecondary }}>
                                    No chats yet
                                </p>
                                {channelFilter !== "telegram" && (
                                    <Button className="h-7 px-2 text-xs" onClick={handleNewChat}>
                                        <Plus className="h-4 w-4 mr-1" /> Start a chat
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
