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
import { reconstructMessages, type SessionMetadata, type ChatMessage } from "./sessionUtils";

type SessionWithSnippet = SessionMetadata & {
    matchSnippet?: { before: string; match: string; after: string };
    titleMatch?: boolean;
};
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

export default function ChatBrowserView({ tabId }: { tabId: string }) {
    const { setTabName, addNewTab, setActiveTabId, getViewSelfPlacement, setSidebarTabId, activeTab } = useWorkspaceContext();
    const { currentTheme } = useTheme();
    const { openDialog } = useCommandDialog();

    const [sessions, setSessions] = useState<SessionMetadata[]>([]);
    const [filteredSessions, setFilteredSessions] = useState<SessionWithSnippet[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedSession, setSelectedSession] = useState<SessionWithSnippet | null>(null);
    const [selectedMessages, setSelectedMessages] = useState<ChatMessage[]>([]);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const selectedRowRef = useRef<HTMLDivElement | null>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const placement = getViewSelfPlacement(tabId);

    // Set tab name
    useEffect(() => {
        setTabName(tabId, "Chat History");
    }, [tabId, setTabName]);

    // Auto-focus search input when tab becomes active
    // Refetch sessions and focus search when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId) {
            loadSessions();
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId]);

    // Load messages when session is selected
    useEffect(() => {
        if (selectedSession) {
            loadSessionMessages(selectedSession.id);
        } else {
            setSelectedMessages([]);
        }
    }, [selectedSession]);

    // Ensure selected item is visible
    useEffect(() => {
        selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedIndex]);

    async function loadSessions() {
        try {
            setIsLoadingSessions(true);
            const response = await fetch("/api/chat/sessions/list");
            const data = await response.json();
            const sessionList = data.sessions || [];
            setSessions(sessionList);

            // Select first session if available
            if (sessionList.length > 0) {
                setSelectedIndex(0);
                setSelectedSession(sessionList[0]);
            }
        } catch (error) {
            console.error("[ChatBrowser] Failed to load sessions:", error);
        } finally {
            setIsLoadingSessions(false);
        }
    }

    async function loadSessionMessages(sessionId: string) {
        try {
            setIsLoadingMessages(true);
            const response = await fetch(`/api/chat/sessions/history/${sessionId}`);
            if (!response.ok) throw new Error("Failed to load messages");

            const data = await response.json();
            const sdkMessages = data.messages || [];
            const uiMessages = reconstructMessages(sdkMessages);
            setSelectedMessages(uiMessages);
        } catch (error) {
            console.error("[ChatBrowser] Failed to load messages:", error);
            setSelectedMessages([]);
        } finally {
            setIsLoadingMessages(false);
        }
    }

    // Search sessions with debouncing
    useEffect(() => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (!searchQuery.trim()) {
            // No search query - show all sessions
            setFilteredSessions(sessions);
            if (sessions.length > 0) {
                setSelectedIndex(0);
                setSelectedSession(sessions[0]);
            }
            return;
        }

        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const response = await fetch("/api/chat/sessions/search", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: searchQuery }),
                });
                const data = await response.json();
                const results = data.sessions || [];
                setFilteredSessions(results);
                if (results.length > 0) {
                    setSelectedIndex(0);
                    setSelectedSession(results[0]);
                } else {
                    setSelectedSession(null);
                }
            } catch (error) {
                console.error("[ChatBrowser] Search failed:", error);
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [searchQuery, sessions]);

    const handleOpenChat = useCallback(
        async (sessionId: string) => {
            const newTab = await addNewTab({
                pluginMeta: chatPluginSerial,
                view: "chat",
                props: { sessionId },
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
            props: {},
        });
        if (newTab) {
            if (placement === "sidebar") {
                setSidebarTabId(newTab.id);
            } else {
                setActiveTabId(newTab.id);
            }
        }
    }, [addNewTab, setActiveTabId, placement, setSidebarTabId]);

    const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const handleSuccess = () => {
            // Remove from local state
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            setFilteredSessions(prev => prev.filter(s => s.id !== sessionId));

            // Update selection if needed
            if (selectedSession?.id === sessionId) {
                const remaining = filteredSessions.filter(s => s.id !== sessionId);
                if (remaining.length > 0) {
                    setSelectedIndex(0);
                    setSelectedSession(remaining[0]);
                } else {
                    setSelectedSession(null);
                }
            }
        };

        openDialog({
            content: (
                <DeleteChatSessionDialog
                    sessionId={sessionId}
                    onSuccess={handleSuccess}
                />
            ),
        });
    };

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (filteredSessions.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            const newIndex = (selectedIndex + 1) % filteredSessions.length;
            setSelectedIndex(newIndex);
            setSelectedSession(filteredSessions[newIndex] || null);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const newIndex = (selectedIndex - 1 + filteredSessions.length) % filteredSessions.length;
            setSelectedIndex(newIndex);
            setSelectedSession(filteredSessions[newIndex] || null);
        } else if (e.key === "Enter" && selectedSession) {
            e.preventDefault();
            handleOpenChat(selectedSession.id);
        } else if (e.key === "Escape") {
            if (searchQuery) {
                setSearchQuery("");
            } else {
                searchInputRef.current?.blur();
            }
        }
    };

    const styles = currentTheme.styles;
    const visibleSessions = searchQuery.trim() ? filteredSessions.length : sessions.length;

    return (
        <div
            className="h-full flex flex-col"
            style={{ backgroundColor: styles.surfacePrimary }}
        >
            <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Left Panel - Session List */}
                <div
                    className="w-72 shrink-0 border-r flex flex-col h-full min-h-0"
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
                                    className="text-[11px] font-medium uppercase tracking-[0.14em] truncate"
                                    style={{ color: styles.contentPrimary }}
                                >
                                    Chats
                                </h2>
                                <span
                                    className="text-[10px] shrink-0"
                                    style={{ color: styles.contentTertiary }}
                                >
                                    ({visibleSessions})
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
                        <ScrollArea className="h-full">
                            <div className="px-2 py-2 space-y-1.5">
                                {isLoadingSessions ? (
                                    <div className="p-6 text-center" style={{ color: styles.contentSecondary }}>
                                        <p className="text-xs">Loading...</p>
                                    </div>
                                ) : isSearching ? (
                                    <div className="p-6 text-center" style={{ color: styles.contentSecondary }}>
                                        <p className="text-xs">Searching...</p>
                                    </div>
                                ) : filteredSessions.length === 0 ? (
                                    <div className="p-6 text-center" style={{ color: styles.contentSecondary }}>
                                        {searchQuery ? (
                                            <p className="text-xs">No chats match "{searchQuery}"</p>
                                        ) : (
                                            <div className="space-y-2">
                                                <MessageCircle className="h-12 w-12 mx-auto" style={{ color: styles.contentTertiary }} />
                                                <p className="text-xs">No chats yet</p>
                                                <Button size="sm" className="h-7 px-2 text-[11px]" onClick={handleNewChat}>
                                                    <Plus className="h-4 w-4 mr-1" /> Start a chat
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    filteredSessions.map((session, index) => {
                                        const isSelected = index === selectedIndex;
                                        return (
                                            <div
                                                key={session.id}
                                                ref={isSelected ? selectedRowRef : undefined}
                                                className="group relative overflow-hidden rounded-lg border transition-colors"
                                                style={{
                                                    borderColor: isSelected ? styles.surfaceAccent : styles.borderDefault,
                                                    backgroundColor: styles.surfaceSecondary,
                                                }}
                                                onMouseEnter={() => {
                                                    setSelectedIndex(index);
                                                    setSelectedSession(session);
                                                }}
                                            >
                                                <button
                                                    className="w-full px-2.5 py-2 text-left"
                                                    onClick={() => handleOpenChat(session.id)}
                                                    style={{
                                                        backgroundColor: isSelected ? styles.surfaceAccent : "transparent",
                                                    }}
                                                >
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className="truncate text-xs font-medium"
                                                            style={{ color: styles.contentPrimary }}
                                                        >
                                                            {session.title}
                                                        </span>
                                                        <ChevronRight className="ml-auto size-3 opacity-60 shrink-0" style={{ color: styles.contentTertiary }} />
                                                    </div>
                                                    <div
                                                        className="mt-0.5 text-[10px] truncate"
                                                        style={{ color: styles.contentTertiary }}
                                                    >
                                                        {formatRelativeTime(session.updatedAt)} • {session.messageCount} messages
                                                    </div>
                                                    {session.matchSnippet && (
                                                        <div
                                                            className="mt-1 text-[10px] line-clamp-1"
                                                            style={{ color: styles.contentSecondary }}
                                                        >
                                                            {session.matchSnippet.before}
                                                            <span
                                                                className="font-semibold rounded px-0.5"
                                                                style={{
                                                                    backgroundColor: styles.contentAccent + "30",
                                                                    color: styles.contentPrimary,
                                                                }}
                                                            >
                                                                {session.matchSnippet.match}
                                                            </span>
                                                            {session.matchSnippet.after}
                                                        </div>
                                                    )}
                                                </button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="absolute top-1.5 right-1.5 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    style={{ color: styles.contentTertiary }}
                                                    onClick={(e) => handleDeleteSession(session.id, e)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                {/* Right Panel - Chat Preview */}
                <div
                    className="flex-1 flex flex-col overflow-hidden relative min-w-0"
                    style={{ backgroundColor: styles.surfacePrimary }}
                >
                    {selectedSession ? (
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
                                            className="text-[11px] font-medium uppercase tracking-[0.14em] truncate"
                                            style={{ color: styles.contentPrimary }}
                                        >
                                            Preview
                                        </h2>
                                        <span
                                            className="text-[10px] shrink-0"
                                            style={{ color: styles.contentTertiary }}
                                        >
                                            ({selectedSession.messageCount})
                                        </span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => handleOpenChat(selectedSession.id)}
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
                                    <div className="mx-auto max-w-3xl space-y-3 p-4">
                                        {selectedMessages.map((message) => (
                                            <Message key={message.id} from={message.role}>
                                                <div
                                                    className={message.role === "user"
                                                        ? "ml-auto w-fit max-w-[90%] rounded-lg border px-2.5 py-2"
                                                        : "w-full rounded-lg border px-2.5 py-2"
                                                    }
                                                    style={{
                                                        borderColor: styles.borderDefault,
                                                        backgroundColor: message.role === "user" ? styles.surfaceAccent : styles.surfaceSecondary,
                                                    }}
                                                >
                                                    <div
                                                        className={message.role === "user"
                                                            ? "mb-1 flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-[0.08em]"
                                                            : "mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em]"
                                                        }
                                                        style={{ color: styles.contentSecondary }}
                                                    >
                                                        {message.role === "user" ? (
                                                            <>
                                                                <span>You</span>
                                                                <UserRound className="h-3.5 w-3.5" />
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Bot className="h-3.5 w-3.5" />
                                                                <span>Agent</span>
                                                            </>
                                                        )}
                                                    </div>

                                                    <MessageContent>
                                                        {message.blocks.map((block) => {
                                                            if (block.type === "text") {
                                                                if (searchQuery.trim()) {
                                                                    return (
                                                                        <div key={block.id} className="whitespace-pre-wrap">
                                                                            {highlightMatches(
                                                                                block.content,
                                                                                searchQuery,
                                                                                styles.contentAccent
                                                                            )}
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <MessageResponse key={block.id}>
                                                                        {block.content}
                                                                    </MessageResponse>
                                                                );
                                                            }

                                                            if (block.type === "tool") {
                                                                return (
                                                                    <div
                                                                        key={block.id}
                                                                        className="rounded px-2 py-1 text-xs"
                                                                        style={{
                                                                            backgroundColor: styles.surfacePrimary,
                                                                            color: styles.contentSecondary,
                                                                        }}
                                                                    >
                                                                        Tool: {block.toolCall.name}
                                                                    </div>
                                                                );
                                                            }

                                                            return null;
                                                        })}
                                                    </MessageContent>
                                                </div>
                                            </Message>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}
                        </>
                    ) : !isLoadingSessions && sessions.length > 0 ? (
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
                    ) : !isLoadingSessions ? (
                        <div className="flex-1 flex items-center justify-center p-6">
                            <div className="text-center space-y-3">
                                <MessageCircle className="h-12 w-12 mx-auto" style={{ color: styles.contentTertiary }} />
                                <p className="text-xs" style={{ color: styles.contentSecondary }}>
                                    No chats yet
                                </p>
                                <Button className="h-7 px-2 text-[11px]" onClick={handleNewChat}>
                                    <Plus className="h-4 w-4 mr-1" /> Start a chat
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
