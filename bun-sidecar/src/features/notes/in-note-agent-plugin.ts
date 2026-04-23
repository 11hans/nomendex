import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Transaction } from "prosemirror-state";
import type { QuickActionId } from "./quick-action-types";

export type AgentBlockStatus = "streaming" | "awaiting_permission" | "done" | "error";

export interface AgentBlockData {
    id: string;
    /** null for full-agent mode and custom-prompt mode */
    actionId: QuickActionId | null;
    /** null for quick-action mode */
    agentId: string | null;
    /** free-form user instruction (§1 Ask AI) — mutually exclusive with actionId */
    customPrompt: string | null;
    originalFrom: number;
    originalTo: number;
    /** Snapshot of the selected text at block open — used for §3 diff preview. */
    originalText: string;
    /** Document position right after the top-level block — widget lives here */
    afterPos: number;
    status: AgentBlockStatus;
    text: string;
    error: string | null;
    permissionPending: {
        permissionId: string;
        toolName: string;
        input: unknown;
    } | null;
    /** §10 tool activity strip — aggregated tool_use events from full-agent mode. */
    toolCalls: { id: string; name: string }[];
}

export interface ToolbarState {
    from: number;
    to: number;
    selectedText: string;
    coords: {
        top: number;
        bottom: number;
        left: number;
    };
}

export interface InNoteAgentPluginState {
    toolbar: ToolbarState | null;
    blocks: Map<string, AgentBlockData>;
}

export const inNoteAgentPluginKey = new PluginKey<InNoteAgentPluginState>("inNoteAgent");

// Meta keys for dispatching commands to the plugin
export const META_OPEN_BLOCK = "inNoteAgent:openBlock";
export const META_UPDATE_BLOCK = "inNoteAgent:updateBlock";
export const META_CLOSE_BLOCK = "inNoteAgent:closeBlock";
export const META_SET_TOOLBAR = "inNoteAgent:setToolbar";
export const META_ADD_TOOL_CALL = "inNoteAgent:addToolCall";

// Commands

export function openAgentBlock(
    view: EditorView,
    params: {
        blockId: string;
        actionId: QuickActionId | null;
        agentId: string | null;
        customPrompt?: string | null;
        from: number;
        to: number;
        afterPos: number;
        selectedText: string;
    },
) {
    const tr = view.state.tr.setMeta(inNoteAgentPluginKey, {
        type: META_OPEN_BLOCK,
        ...params,
    });
    view.dispatch(tr);
}

export function updateAgentBlock(
    view: EditorView,
    blockId: string,
    updates: Partial<Pick<AgentBlockData, "status" | "text" | "error" | "permissionPending">>,
) {
    view.dispatch(
        view.state.tr.setMeta(inNoteAgentPluginKey, {
            type: META_UPDATE_BLOCK,
            blockId,
            updates,
        }),
    );
}

export function addAgentBlockToolCall(
    view: EditorView,
    blockId: string,
    toolCall: { id: string; name: string },
) {
    view.dispatch(
        view.state.tr.setMeta(inNoteAgentPluginKey, {
            type: META_ADD_TOOL_CALL,
            blockId,
            toolCall,
        }),
    );
}

export function closeAgentBlock(view: EditorView, blockId: string) {
    view.dispatch(
        view.state.tr.setMeta(inNoteAgentPluginKey, {
            type: META_CLOSE_BLOCK,
            blockId,
        }),
    );
}

// Get the mapped original range for a block (after document edits)
export function getBlockOriginalRange(
    state: ReturnType<typeof inNoteAgentPluginKey.getState>,
    blockId: string,
): { from: number; to: number } | null {
    const block = state?.blocks.get(blockId);
    if (!block) return null;
    return { from: block.originalFrom, to: block.originalTo };
}


const MAX_CONCURRENT_BLOCKS = 3;
const MIN_SELECTION_LENGTH = 5;

export interface CreatePluginOptions {
    onToolbarChange: (state: ToolbarState | null) => void;
    onBlocksChange: (blocks: Map<string, AgentBlockData>) => void;
    /** Called when the plugin needs a widget DOM node for a block */
    getOrCreateWidget: (blockId: string) => HTMLElement;
}

export function createInNoteAgentPlugin(options: CreatePluginOptions) {
    const { onToolbarChange, onBlocksChange, getOrCreateWidget } = options;

    return new Plugin<InNoteAgentPluginState>({
        key: inNoteAgentPluginKey,

        state: {
            init(): InNoteAgentPluginState {
                return { toolbar: null, blocks: new Map() };
            },

            apply(tr: Transaction, prev: InNoteAgentPluginState): InNoteAgentPluginState {
                const meta = tr.getMeta(inNoteAgentPluginKey) as
                    | { type: string; [key: string]: unknown }
                    | undefined;

                let toolbar = prev.toolbar;
                let blocks = prev.blocks;

                // Handle meta commands
                if (meta) {
                    if (meta.type === META_OPEN_BLOCK) {
                        const running = [...blocks.values()].filter(
                            (b) => b.status === "streaming" || b.status === "awaiting_permission",
                        ).length;
                        if (running < MAX_CONCURRENT_BLOCKS) {
                            const newBlock: AgentBlockData = {
                                id: meta.blockId as string,
                                actionId: meta.actionId as QuickActionId | null,
                                agentId: meta.agentId as string | null,
                                customPrompt: (meta.customPrompt as string | null | undefined) ?? null,
                                originalFrom: meta.from as number,
                                originalTo: meta.to as number,
                                originalText: meta.selectedText as string,
                                afterPos: meta.afterPos as number,
                                status: "streaming",
                                text: "",
                                error: null,
                                permissionPending: null,
                                toolCalls: [],
                            };
                            blocks = new Map(blocks);
                            blocks.set(newBlock.id, newBlock);
                        }
                        // Hide toolbar when a block opens
                        toolbar = null;
                    } else if (meta.type === META_UPDATE_BLOCK) {
                        const existing = blocks.get(meta.blockId as string);
                        if (existing) {
                            blocks = new Map(blocks);
                            blocks.set(existing.id, {
                                ...existing,
                                ...(meta.updates as Partial<AgentBlockData>),
                            });
                        }
                    } else if (meta.type === META_ADD_TOOL_CALL) {
                        const existing = blocks.get(meta.blockId as string);
                        const call = meta.toolCall as { id: string; name: string };
                        if (existing && !existing.toolCalls.some((t) => t.id === call.id)) {
                            blocks = new Map(blocks);
                            blocks.set(existing.id, {
                                ...existing,
                                toolCalls: [...existing.toolCalls, call],
                            });
                        }
                    } else if (meta.type === META_CLOSE_BLOCK) {
                        blocks = new Map(blocks);
                        blocks.delete(meta.blockId as string);
                    } else if (meta.type === META_SET_TOOLBAR) {
                        toolbar = meta.toolbar as ToolbarState | null;
                    }

                    return { toolbar, blocks };
                }

                // Remap positions when document changes
                if (tr.docChanged) {
                    // Remap toolbar
                    if (toolbar) {
                        const newFrom = tr.mapping.map(toolbar.from);
                        const newTo = tr.mapping.map(toolbar.to);
                        if (newFrom !== toolbar.from || newTo !== toolbar.to) {
                            toolbar = { ...toolbar, from: newFrom, to: newTo };
                        }
                    }

                    // Remap block positions
                    let remapped = false;
                    const remappedBlocks = new Map<string, AgentBlockData>();
                    for (const [id, block] of blocks) {
                        const newFrom = tr.mapping.map(block.originalFrom);
                        const newTo = tr.mapping.map(block.originalTo);
                        const newAfter = tr.mapping.map(block.afterPos, -1);
                        if (newFrom !== block.originalFrom || newTo !== block.originalTo || newAfter !== block.afterPos) {
                            remapped = true;
                            remappedBlocks.set(id, {
                                ...block,
                                originalFrom: newFrom,
                                originalTo: newTo,
                                afterPos: newAfter,
                            });
                        } else {
                            remappedBlocks.set(id, block);
                        }
                    }
                    if (remapped) blocks = remappedBlocks;
                }

                // Update toolbar visibility based on selection
                if (tr.selectionSet || tr.docChanged) {
                    const sel = tr.selection;
                    const isEmpty = sel.empty;
                    const selectedText = isEmpty ? "" : tr.doc.textBetween(sel.from, sel.to, " ");
                    const hasEnoughText = selectedText.trim().length >= MIN_SELECTION_LENGTH;

                    // §4 Empty-line trigger: allow toolbar when cursor is in an empty top-level block
                    let emptyLineTrigger = false;
                    if (isEmpty) {
                        try {
                            const $pos = tr.doc.resolve(sel.from);
                            const parent = $pos.parent;
                            if (parent.isTextblock && parent.content.size === 0) {
                                emptyLineTrigger = true;
                            }
                        } catch {
                            // ignore resolution errors
                        }
                    }

                    if (!isEmpty && hasEnoughText) {
                        if (!toolbar || toolbar.from !== sel.from || toolbar.to !== sel.to) {
                            toolbar = {
                                from: sel.from,
                                to: sel.to,
                                selectedText: selectedText.trim(),
                                coords: toolbar?.coords ?? { top: 0, bottom: 0, left: 0 },
                            };
                        }
                    } else if (emptyLineTrigger) {
                        if (!toolbar || toolbar.from !== sel.from || toolbar.to !== sel.from) {
                            toolbar = {
                                from: sel.from,
                                to: sel.from,
                                selectedText: "",
                                coords: toolbar?.coords ?? { top: 0, bottom: 0, left: 0 },
                            };
                        }
                    } else {
                        toolbar = null;
                    }
                }

                return { toolbar, blocks };
            },
        },

        props: {
            decorations(state) {
                const pluginState = inNoteAgentPluginKey.getState(state);
                if (!pluginState || pluginState.blocks.size === 0) return DecorationSet.empty;

                const decorations: Decoration[] = [];
                for (const block of pluginState.blocks.values()) {
                    const pos = block.afterPos;
                    if (pos < 0 || pos > state.doc.content.size) continue;

                    const dom = getOrCreateWidget(block.id);
                    const deco = Decoration.widget(pos, dom, {
                        key: block.id,
                        side: 1,
                        stopEvent: () => true,
                        // Mark as non-editable so ProseMirror ignores it
                        marks: [],
                    });
                    decorations.push(deco);

                    // §8 Source escrow: fade original range while block is active
                    const isActive = block.status === "streaming" || block.status === "awaiting_permission";
                    if (isActive && block.originalFrom < block.originalTo) {
                        const from = Math.max(0, Math.min(block.originalFrom, state.doc.content.size));
                        const to = Math.max(from, Math.min(block.originalTo, state.doc.content.size));
                        if (from < to) {
                            decorations.push(
                                Decoration.inline(from, to, {
                                    class: "in-note-agent-source-pending",
                                }),
                            );
                        }
                    }
                }

                return DecorationSet.create(state.doc, decorations);
            },
        },

        view(_editorView) {
            return {
                update(view: EditorView) {
                    const pluginState = inNoteAgentPluginKey.getState(view.state);
                    if (!pluginState) return;

                    // Update toolbar coords
                    let toolbarState = pluginState.toolbar;
                    if (toolbarState) {
                        try {
                            const coords = view.coordsAtPos(toolbarState.from);
                            if (
                                coords.top !== toolbarState.coords.top ||
                                coords.left !== toolbarState.coords.left ||
                                coords.bottom !== toolbarState.coords.bottom
                            ) {
                                toolbarState = { ...toolbarState, coords };
                            }
                        } catch {
                            // pos out of bounds — clear toolbar
                            toolbarState = null;
                        }
                    }

                    onToolbarChange(toolbarState);
                    onBlocksChange(pluginState.blocks);
                },

                destroy() {
                    onToolbarChange(null);
                    onBlocksChange(new Map());
                },
            };
        },
    });
}

/** Compute the position right after the top-level block containing `pos`. */
export function computeAfterPos(doc: import("prosemirror-model").Node, pos: number): number {
    const $pos = doc.resolve(pos);
    try {
        return $pos.after(1);
    } catch {
        return pos;
    }
}
