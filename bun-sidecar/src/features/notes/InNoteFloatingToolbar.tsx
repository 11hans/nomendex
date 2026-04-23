import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/hooks/useTheme";
import { Sparkles, CornerDownLeft } from "lucide-react";
import type { ToolbarState } from "./in-note-agent-plugin";
import { QUICK_ACTIONS, type QuickActionId } from "./quick-action-types";
import type { AgentConfig } from "@/features/agents/index";

interface Props {
    toolbar: ToolbarState | null;
    agents: AgentConfig[];
    activeBlockIds: Set<string>;
    onQuickAction: (actionId: QuickActionId) => void;
    onAgentAction: (agentId: string) => void;
    onCustomPrompt: (prompt: string) => void;
    /** External open request (e.g. ⌘J) */
    externalOpenSignal?: number;
}

export function InNoteFloatingToolbar({
    toolbar,
    agents,
    onQuickAction,
    onAgentAction,
    onCustomPrompt,
    externalOpenSignal,
}: Props) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const [open, setOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const popoverRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Cache last non-null toolbar so popover stays usable after editor selection is lost
    const cachedToolbarRef = useRef<ToolbarState | null>(null);
    if (toolbar) cachedToolbarRef.current = toolbar;
    const activeToolbar = toolbar ?? (open ? cachedToolbarRef.current : null);

    // Reopen on external signal (⌘J)
    useEffect(() => {
        if (externalOpenSignal !== undefined && externalOpenSignal > 0) {
            setOpen(true);
        }
    }, [externalOpenSignal]);

    // Focus input when popover opens
    useEffect(() => {
        if (open) {
            setPrompt("");
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    if (!activeToolbar) return null;

    // Position: above selection
    const viewportWidth = window.innerWidth;
    const toolbarWidth = 360;
    const rawLeft = activeToolbar.coords.left;
    const left = Math.max(8, Math.min(rawLeft, viewportWidth - toolbarWidth - 8));
    const top = activeToolbar.coords.top - 44;

    const pillStyle: React.CSSProperties = {
        position: "fixed",
        top: Math.max(8, top),
        left,
        zIndex: 9999,
        pointerEvents: "auto",
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text) return;
        setOpen(false);
        onCustomPrompt(text);
    };

    const editActions = QUICK_ACTIONS.filter((a) => a.category === "edit");
    const generateActions = QUICK_ACTIONS.filter((a) => a.category === "generate");
    const isEmptyTrigger = (activeToolbar?.selectedText ?? "").length === 0;

    const content = !open ? (
        <div style={pillStyle}>
            <button
                type="button"
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-md shadow-lg font-medium"
                style={{
                    backgroundColor: styles.contentPrimary,
                    color: styles.surfacePrimary,
                }}
                onMouseDown={(e) => {
                    // Preserve editor selection — opening happens on click.
                    e.preventDefault();
                }}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(true);
                }}
                title="Ask AI (⌘J)"
            >
                <Sparkles className="h-3 w-3" />
                Ask AI
                <kbd
                    className="ml-1 text-[10px] px-1 rounded opacity-70"
                    style={{ backgroundColor: "rgba(0,0,0,0.12)" }}
                >
                    ⌘J
                </kbd>
            </button>
        </div>
    ) : (
        <div
            ref={popoverRef}
            style={{
                ...pillStyle,
                width: 340,
                borderRadius: 10,
                border: `1px solid ${styles.borderDefault}`,
                backgroundColor: styles.surfacePrimary,
                boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                overflow: "hidden",
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Input row */}
            <div
                className="flex items-center gap-2 px-3 py-2 border-b"
                style={{ borderColor: styles.borderDefault }}
            >
                <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: styles.contentAccent }} />
                <input
                    ref={inputRef}
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submit();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            setOpen(false);
                        }
                    }}
                    placeholder={isEmptyTrigger ? "Ask AI to write…" : "Tell AI what to do with selection…"}
                    className="flex-1 bg-transparent border-0 outline-none text-sm"
                    style={{ color: styles.contentPrimary }}
                />
                {prompt.trim() && (
                    <CornerDownLeft
                        className="h-3 w-3 shrink-0"
                        style={{ color: styles.contentTertiary }}
                    />
                )}
            </div>

            {/* Sections */}
            <div className="py-1 max-h-[320px] overflow-y-auto">
                {!isEmptyTrigger && (
                <Section label="Edit" styles={styles}>
                    {editActions.map((a) => (
                        <MenuItem
                            key={a.id}
                            styles={styles}
                            onClick={() => {
                                setOpen(false);
                                onQuickAction(a.id);
                            }}
                        >
                            {a.label}
                        </MenuItem>
                    ))}
                </Section>
                )}

                {!isEmptyTrigger && (
                <Section label="Generate" styles={styles}>
                    {generateActions.map((a) => (
                        <MenuItem
                            key={a.id}
                            styles={styles}
                            onClick={() => {
                                setOpen(false);
                                onQuickAction(a.id);
                            }}
                        >
                            {a.label}
                        </MenuItem>
                    ))}
                </Section>
                )}

                {agents.length > 0 && (
                    <Section label="Agents" styles={styles}>
                        {agents.map((agent) => (
                            <MenuItem
                                key={agent.id}
                                styles={styles}
                                onClick={() => {
                                    setOpen(false);
                                    onAgentAction(agent.id);
                                }}
                            >
                                {agent.name}
                            </MenuItem>
                        ))}
                    </Section>
                )}
            </div>
        </div>
    );

    return createPortal(content, document.body);
}

function Section({
    label,
    children,
    styles,
}: {
    label: string;
    children: React.ReactNode;
    styles: ReturnType<typeof useTheme>["currentTheme"]["styles"];
}) {
    return (
        <div className="py-1">
            <div
                className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider"
                style={{ color: styles.contentTertiary }}
            >
                {label}
            </div>
            {children}
        </div>
    );
}

function MenuItem({
    children,
    onClick,
    styles,
}: {
    children: React.ReactNode;
    onClick: () => void;
    styles: ReturnType<typeof useTheme>["currentTheme"]["styles"];
}) {
    return (
        <button
            className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80 transition-opacity"
            style={{ color: styles.contentPrimary }}
            onMouseDown={(e) => {
                e.preventDefault();
                onClick();
            }}
        >
            {children}
        </button>
    );
}
