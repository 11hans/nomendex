import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { Check, ChevronsDown, MessageSquare, X, Loader2, AlertCircle, RotateCcw, CornerDownLeft, Square, Copy, ChevronRight, ChevronDown, Wrench } from "lucide-react";
import type { AgentBlockData } from "./in-note-agent-plugin";
import { QUICK_ACTIONS, REFINE_CHIPS, TRANSFORM_ACTION_IDS } from "./quick-action-types";
import { wordDiff } from "./word-diff";

export interface AgentBlockCallbacks {
    onAccept: (blockId: string) => void;
    onInsertBelow: (blockId: string) => void;
    onDiscard: (blockId: string) => void;
    onContinueInChat: (blockId: string) => void;
    onPermissionAllow: (blockId: string) => void;
    onPermissionDeny: (blockId: string) => void;
    /** Retry with same prompt/action (re-runs over original selection) */
    onRetry: (blockId: string) => void;
    /** Refine the current output with a new instruction */
    onRefine: (blockId: string, instruction: string) => void;
    /** Stop streaming but keep partial text (user can still Accept/Retry). */
    onStop: (blockId: string) => void;
}

interface Props extends AgentBlockCallbacks {
    block: AgentBlockData;
}

function getModelBadge(block: AgentBlockData): string | null {
    if (block.agentId) return null; // agent name already in label
    if (block.actionId || block.customPrompt) return "Haiku";
    return null;
}

function getActionLabel(block: AgentBlockData): string {
    if (block.actionId) {
        return QUICK_ACTIONS.find((a) => a.id === block.actionId)?.label ?? block.actionId;
    }
    if (block.customPrompt) {
        const trimmed = block.customPrompt.trim();
        return trimmed.length > 40 ? `Ask AI · ${trimmed.slice(0, 40)}…` : `Ask AI · ${trimmed}`;
    }
    return "Agent";
}

function StatusDot({ status }: { status: AgentBlockData["status"] }) {
    if (status === "streaming") {
        return <Loader2 className="h-3 w-3 animate-spin shrink-0" />;
    }
    if (status === "error") {
        return <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />;
    }
    return null;
}

export function InNoteAgentBlock({
    block,
    onAccept,
    onInsertBelow,
    onDiscard,
    onContinueInChat,
    onPermissionAllow,
    onPermissionDeny,
    onRetry,
    onRefine,
    onStop,
}: Props) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const [refineText, setRefineText] = useState("");
    const [refineOpen, setRefineOpen] = useState(false);
    const [showDiff, setShowDiff] = useState(true);
    const [toolsExpanded, setToolsExpanded] = useState(false);
    const isStreaming = block.status === "streaming";
    const isDone = block.status === "done";
    const isError = block.status === "error";
    const hasContent = block.text.length > 0;
    const actionLabel = getActionLabel(block);
    const isTransform = block.actionId !== null && TRANSFORM_ACTION_IDS.has(block.actionId);
    const renderAsDiff = isTransform && hasContent && !isStreaming && !isError && showDiff && block.originalText.length > 0;
    const modelBadge = getModelBadge(block);

    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, []);

    const handleCopy = () => {
        if (!hasContent) return;
        void navigator.clipboard.writeText(block.text);
    };

    return (
        <div
            ref={rootRef}
            className="in-note-agent-block in-note-agent-block-mount my-2 rounded-lg border text-sm"
            style={{
                backgroundColor: styles.surfaceSecondary,
                borderColor: styles.borderDefault,
                color: styles.contentPrimary,
            }}
        >
            {/* Header */}
            <div
                className="flex items-center gap-2 px-3 py-2 rounded-t-lg border-b"
                style={{
                    backgroundColor: styles.surfaceTertiary,
                    borderColor: styles.borderDefault,
                }}
            >
                <StatusDot status={block.status} />
                <span className="font-medium text-xs" style={{ color: styles.contentSecondary }}>
                    {actionLabel}
                </span>
                {isStreaming && (
                    <span className="text-xs" style={{ color: styles.contentTertiary }}>
                        Writing…
                    </span>
                )}
                {isDone && (
                    <span className="text-xs" style={{ color: styles.contentTertiary }}>
                        Done
                    </span>
                )}
                {isError && (
                    <span className="text-xs text-red-500">
                        Error
                    </span>
                )}
                {modelBadge && (
                    <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{
                            backgroundColor: styles.surfacePrimary,
                            color: styles.contentTertiary,
                            border: `1px solid ${styles.borderDefault}`,
                        }}
                    >
                        {modelBadge}
                    </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                    {isStreaming && (
                        <button
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded opacity-80 hover:opacity-100 transition-opacity"
                            style={{ color: styles.contentSecondary }}
                            onClick={() => onStop(block.id)}
                            title="Stop streaming (keep partial text)"
                        >
                            <Square className="h-2.5 w-2.5" />
                            Stop
                        </button>
                    )}
                    {hasContent && !isStreaming && !isError && (
                        <button
                            className="p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity"
                            onClick={handleCopy}
                            title="Copy result"
                        >
                            <Copy className="h-3 w-3" style={{ color: styles.contentSecondary }} />
                        </button>
                    )}
                    <button
                        className="p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity"
                        onClick={() => onDiscard(block.id)}
                        title="Discard"
                    >
                        <X className="h-3 w-3" style={{ color: styles.contentSecondary }} />
                    </button>
                </div>
            </div>

            {/* §10 Tool activity strip (full-agent mode) */}
            {block.toolCalls.length > 0 && (
                <div
                    className="border-b"
                    style={{ borderColor: styles.borderDefault }}
                >
                    <button
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] hover:opacity-80 transition-opacity"
                        style={{ color: styles.contentTertiary }}
                        onClick={() => setToolsExpanded((v) => !v)}
                    >
                        {toolsExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronRight className="h-3 w-3" />
                        )}
                        <Wrench className="h-3 w-3" />
                        <span>
                            Used {block.toolCalls.length} tool{block.toolCalls.length === 1 ? "" : "s"}
                        </span>
                    </button>
                    {toolsExpanded && (
                        <ul
                            className="px-3 pb-2 pl-8 space-y-0.5 text-[11px]"
                            style={{ color: styles.contentSecondary }}
                        >
                            {block.toolCalls.map((t) => (
                                <li key={t.id} className="font-mono truncate">
                                    {t.name}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Permission UI */}
            {block.status === "awaiting_permission" && block.permissionPending && (
                <div className="px-3 py-2 border-b" style={{ borderColor: styles.borderDefault }}>
                    <p className="text-xs mb-2" style={{ color: styles.contentSecondary }}>
                        Allow tool:{" "}
                        <code
                            className="px-1 py-0.5 rounded text-xs"
                            style={{ backgroundColor: styles.surfaceTertiary }}
                        >
                            {block.permissionPending.toolName}
                        </code>
                    </p>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="default"
                            className="h-6 text-xs px-2"
                            onClick={() => onPermissionAllow(block.id)}
                        >
                            Allow
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs px-2"
                            onClick={() => onPermissionDeny(block.id)}
                        >
                            Deny
                        </Button>
                    </div>
                </div>
            )}

            {/* Content */}
            {(hasContent || isError) && (
                <div
                    className="px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed"
                    style={{ color: styles.contentPrimary }}
                >
                    {isError ? (
                        block.error ?? "An error occurred. Try again."
                    ) : renderAsDiff ? (
                        wordDiff(block.originalText, block.text).map((tok, idx) => {
                            if (tok.op === "equal") return <span key={idx}>{tok.text}</span>;
                            if (tok.op === "removed")
                                return (
                                    <span key={idx} className="in-note-agent-diff-removed">
                                        {tok.text}
                                    </span>
                                );
                            return (
                                <span key={idx} className="in-note-agent-diff-added">
                                    {tok.text}
                                </span>
                            );
                        })
                    ) : (
                        block.text
                    )}
                    {isStreaming && (
                        <span
                            className="inline-block w-0.5 h-4 ml-0.5 align-text-bottom animate-pulse"
                            style={{ backgroundColor: styles.contentPrimary }}
                        />
                    )}
                </div>
            )}
            {/* Diff toggle (transform actions) */}
            {isTransform && hasContent && !isStreaming && !isError && (
                <div
                    className="flex items-center justify-end px-3 pb-1"
                >
                    <button
                        className="text-[10px] uppercase tracking-wider hover:opacity-80"
                        style={{ color: styles.contentTertiary }}
                        onClick={() => setShowDiff((v) => !v)}
                        title={showDiff ? "Show only result" : "Show diff vs original"}
                    >
                        {showDiff ? "Hide diff" : "Show diff"}
                    </button>
                </div>
            )}

            {/* Refine bar — shown when done, above action bar */}
            {hasContent && !isStreaming && !isError && (
                <div
                    className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-t"
                    style={{ borderColor: styles.borderDefault }}
                >
                    <span
                        className="text-[10px] uppercase tracking-wider mr-1"
                        style={{ color: styles.contentTertiary }}
                    >
                        Refine
                    </span>
                    {REFINE_CHIPS.map((chip) => (
                        <button
                            key={chip.id}
                            className="h-5 px-2 text-[11px] rounded-full border hover:opacity-80 transition-opacity"
                            style={{
                                borderColor: styles.borderDefault,
                                color: styles.contentSecondary,
                                backgroundColor: styles.surfacePrimary,
                            }}
                            onClick={() => onRefine(block.id, chip.instruction)}
                            title={chip.instruction}
                        >
                            {chip.label}
                        </button>
                    ))}
                    <button
                        className="h-5 px-2 text-[11px] rounded-full border hover:opacity-80 transition-opacity flex items-center gap-1"
                        style={{
                            borderColor: styles.borderDefault,
                            color: styles.contentSecondary,
                            backgroundColor: styles.surfacePrimary,
                        }}
                        onClick={() => setRefineOpen((v) => !v)}
                        title="Custom refine instruction"
                    >
                        {refineOpen ? "Close" : "Custom…"}
                    </button>
                    <button
                        className="h-5 px-2 text-[11px] rounded-full border hover:opacity-80 transition-opacity flex items-center gap-1"
                        style={{
                            borderColor: styles.borderDefault,
                            color: styles.contentSecondary,
                            backgroundColor: styles.surfacePrimary,
                        }}
                        onClick={() => onRetry(block.id)}
                        title="Re-run the same action"
                    >
                        <RotateCcw className="h-2.5 w-2.5" />
                        Try again
                    </button>
                </div>
            )}

            {/* Custom refine input */}
            {hasContent && !isStreaming && !isError && refineOpen && (
                <div
                    className="flex items-center gap-2 px-3 py-2 border-t"
                    style={{ borderColor: styles.borderDefault, backgroundColor: styles.surfaceTertiary }}
                >
                    <input
                        type="text"
                        autoFocus
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && refineText.trim()) {
                                e.preventDefault();
                                onRefine(block.id, refineText.trim());
                                setRefineText("");
                                setRefineOpen(false);
                            } else if (e.key === "Escape") {
                                setRefineOpen(false);
                            }
                        }}
                        placeholder="Tell AI what to change…"
                        className="flex-1 bg-transparent border-0 outline-none text-xs"
                        style={{ color: styles.contentPrimary }}
                    />
                    <CornerDownLeft
                        className="h-3 w-3 shrink-0"
                        style={{ color: styles.contentTertiary }}
                    />
                </div>
            )}

            {/* Action bar — shown when done and has content */}
            {hasContent && !isStreaming && !isError && (
                <div
                    className="flex items-center gap-1 px-2 py-1.5 border-t"
                    style={{ borderColor: styles.borderDefault }}
                >
                    <Button
                        size="sm"
                        className="h-6 text-xs gap-1 px-2"
                        onClick={() => onAccept(block.id)}
                        title="Replace selection with this text"
                    >
                        <Check className="h-3 w-3" />
                        Accept
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs gap-1 px-2"
                        onClick={() => onInsertBelow(block.id)}
                        title="Insert below selection"
                    >
                        <ChevronsDown className="h-3 w-3" />
                        Insert below
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs gap-1 px-2"
                        onClick={() => onContinueInChat(block.id)}
                        title="Continue this conversation in Chat"
                    >
                        <MessageSquare className="h-3 w-3" />
                        Chat
                    </Button>
                    <div className="ml-auto">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs px-2"
                            onClick={() => onDiscard(block.id)}
                            title="Discard"
                        >
                            Discard
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
