import { useCallback, useRef } from "react";
import type { QuickActionId } from "@/features/notes/quick-action-types";

export type AgentStreamMode = "quick" | "agent";

export interface StreamCallbacks {
    onDelta: (text: string) => void;
    onPermissionRequest?: (permissionId: string, toolName: string, input: unknown) => void;
    onError: (error: string) => void;
    onDone: () => void;
}

type QuickStreamParams = {
    mode: "quick";
    actionId: QuickActionId;
    selectionText: string;
};

type AgentStreamParams = {
    mode: "agent";
    agentId: string;
    selectionText: string;
};

export type StartStreamParams = (QuickStreamParams | AgentStreamParams) & StreamCallbacks;

/** Unified SSE parser for both quick actions and full agent sessions. */
export function useAgentStream() {
    const abortControllerRef = useRef<AbortController | null>(null);

    const start = useCallback((params: StartStreamParams): AbortController => {
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const { onDelta, onPermissionRequest, onError, onDone } = params;

        (async () => {
            try {
                let response: Response;

                if (params.mode === "quick") {
                    response = await fetch("/api/notes/quick-action", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ actionId: params.actionId, selectionText: params.selectionText }),
                        signal: controller.signal,
                    });
                } else {
                    response = await fetch("/api/chat", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            message: params.selectionText,
                            agentId: params.agentId,
                            transient: true,
                        }),
                        signal: controller.signal,
                    });
                }

                if (!response.ok) {
                    const err = await response.json().catch(() => ({ error: "Request failed" }));
                    onError((err as { error?: string }).error ?? "Request failed");
                    return;
                }

                if (!response.body) {
                    onError("No response body");
                    return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (controller.signal.aborted) break;

                    buffer += decoder.decode(value, { stream: true });
                    const parts = buffer.split("\n\n");
                    buffer = parts.pop() ?? "";

                    for (const part of parts) {
                        for (const line of part.split("\n")) {
                            if (!line.startsWith("data: ")) continue;
                            const raw = line.slice(6).trim();
                            if (!raw) continue;

                            let envelope: Record<string, unknown>;
                            try {
                                envelope = JSON.parse(raw) as Record<string, unknown>;
                            } catch {
                                continue;
                            }

                            const evType = envelope.type as string;

                            if (evType === "text_delta") {
                                // Quick action format
                                onDelta(envelope.text as string);
                            } else if (evType === "message") {
                                // Full-agent SDK message wrapper
                                const sdkMsg = envelope.data as Record<string, unknown> | undefined;
                                if (!sdkMsg) continue;

                                if (sdkMsg.type === "stream_event") {
                                    const event = sdkMsg.event as Record<string, unknown> | undefined;
                                    if (
                                        event?.type === "content_block_delta" &&
                                        (event.delta as Record<string, unknown>)?.type === "text_delta"
                                    ) {
                                        const text = (event.delta as { text?: string }).text;
                                        if (text) onDelta(text);
                                    }
                                } else if (sdkMsg.type === "assistant") {
                                    // Completed assistant message (includePartialMessages: true emits these too)
                                    const content = (sdkMsg.message as { content?: Array<{ type: string; text?: string }> })?.content;
                                    if (content) {
                                        for (const block of content) {
                                            if (block.type === "text" && block.text) onDelta(block.text);
                                        }
                                    }
                                }
                            } else if (evType === "permission_request") {
                                onPermissionRequest?.(
                                    envelope.permissionId as string,
                                    envelope.toolName as string,
                                    envelope.input,
                                );
                            } else if (evType === "error") {
                                onError(envelope.error as string);
                                return;
                            } else if (evType === "cancelled") {
                                onDone();
                                return;
                            } else if (evType === "done") {
                                onDone();
                                return;
                            }
                        }
                    }
                }

                onDone();
            } catch (err) {
                if (controller.signal.aborted) return;
                onError(err instanceof Error ? err.message : String(err));
            }
        })();

        return controller;
    }, []);

    const cancel = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
    }, []);

    const respondToPermission = useCallback((permissionId: string, decision: "allow" | "deny") => {
        fetch("/api/chat/permission-response", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ permissionId, decision }),
        }).catch(() => {/* best-effort */});
    }, []);

    return { start, cancel, respondToPermission };
}
