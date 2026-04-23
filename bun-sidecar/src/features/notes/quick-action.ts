import { existsSync } from "node:fs";
import { createServiceLogger } from "@/lib/logger";
import {
    QUICK_ACTIONS,
    CUSTOM_PROMPT_MODEL,
    buildCustomSystemPrompt,
    type QuickActionId,
} from "./quick-action-types";

const logger = createServiceLogger("QUICK_ACTION");

function getClaudeCliPath(): string {
    return process.env.CLAUDE_CLI_PATH || `${process.env.HOME}/.local/bin/claude`;
}

export class NoClaudeCliError extends Error {
    statusCode = 503;
    constructor() {
        super("Claude CLI not found. Is Claude Code installed?");
    }
}

// CLI outputs {"type":"assistant","message":{...}} for stream-json format
type AssistantEvent = {
    type: "assistant";
    message: {
        content: Array<{ type: string; text?: string }>;
    };
};
type ResultEvent = {
    type: "result";
    result?: string;
    is_error?: boolean;
};
type CliEvent = AssistantEvent | ResultEvent | { type: string };

export function streamQuickAction(params: {
    actionId?: QuickActionId | null;
    customPrompt?: string | null;
    selectionText: string;
    signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
    const { actionId, customPrompt, selectionText, signal } = params;

    let systemPrompt: string;
    let model: string;

    if (customPrompt && customPrompt.trim()) {
        systemPrompt = buildCustomSystemPrompt(customPrompt);
        model = CUSTOM_PROMPT_MODEL;
    } else if (actionId) {
        const action = QUICK_ACTIONS.find((a) => a.id === actionId);
        if (!action) {
            throw Object.assign(new Error(`Unknown quick action: ${actionId}`), { statusCode: 400 });
        }
        systemPrompt = action.systemPrompt;
        model = action.model;
    } else {
        throw Object.assign(new Error("actionId or customPrompt required"), { statusCode: 400 });
    }

    const claudePath = getClaudeCliPath();
    if (!existsSync(claudePath)) throw new NoClaudeCliError();

    const userPrompt = selectionText.trim()
        ? `<text>\n${selectionText}\n</text>`
        : "Generate the requested content.";

    const proc = Bun.spawn(
        [
            claudePath,
            "--print",
            "--verbose",           // required for stream-json
            "--model", model,
            "--append-system-prompt", systemPrompt,
            "--output-format", "stream-json",
            userPrompt,
        ],
        { stdout: "pipe", stderr: "pipe" },
    );

    if (signal) {
        signal.addEventListener("abort", () => proc.kill(), { once: true });
    }

    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            // Track emitted text length to emit only incremental deltas
            let emittedLen = 0;

            const push = (data: object) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (signal?.aborted) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        let event: CliEvent;
                        try {
                            event = JSON.parse(trimmed) as CliEvent;
                        } catch {
                            continue; // skip non-JSON lines
                        }

                        if (event.type === "assistant") {
                            // Extract latest text from assistant message content
                            const content = (event as AssistantEvent).message?.content ?? [];
                            const fullText = content
                                .filter((b) => b.type === "text" && typeof b.text === "string")
                                .map((b) => b.text as string)
                                .join("");

                            if (fullText.length > emittedLen) {
                                const delta = fullText.slice(emittedLen);
                                emittedLen = fullText.length;
                                push({ type: "text_delta", text: delta });
                            }
                        } else if (event.type === "result") {
                            const resultEvent = event as ResultEvent;
                            if (resultEvent.is_error) {
                                push({ type: "error", error: "Claude returned an error" });
                                return;
                            }
                            // result.result is the final full text — emit any remaining delta
                            const finalText = resultEvent.result ?? "";
                            if (finalText.length > emittedLen) {
                                push({ type: "text_delta", text: finalText.slice(emittedLen) });
                            }
                            return; // done
                        }
                    }
                }
            } catch (err) {
                if (!signal?.aborted) {
                    logger.error("Quick action stream error", { error: err, actionId });
                    push({ type: "error", error: err instanceof Error ? err.message : String(err) });
                }
            } finally {
                push({ type: "done" });
                controller.close();
                reader.releaseLock();
            }
        },
        cancel() {
            proc.kill();
        },
    });
}
