import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ConversationTurn } from "./types";

const MAX_TURNS = 40;

/**
 * Converts a list of raw SDK messages into simplified ConversationTurn[].
 *
 * - Skips meta messages, tool_use blocks, tool_result blocks, thinking blocks, images
 * - Skips system messages entirely
 * - Caps the result to the last MAX_TURNS turns (sliding window)
 */
export function sdkMessagesToTurns(messages: SDKMessage[]): ConversationTurn[] {
    const turns: ConversationTurn[] = [];

    for (const msg of messages) {
        if (msg.type === "user") {
            const text = extractUserText(msg);
            if (text) turns.push({ role: "user", text });
        } else if (msg.type === "assistant") {
            const text = extractAssistantText(msg);
            if (text) turns.push({ role: "assistant", text });
        }
        // system, result, tool_result — skip
    }

    // Apply sliding window: keep last MAX_TURNS turns
    return turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RawUserMsg = {
    isMeta?: boolean;
    message?: { content?: unknown };
    content?: unknown;
};

type ContentBlock = {
    type?: string;
    text?: string;
    [key: string]: unknown;
};

function extractUserText(msg: SDKMessage): string | null {
    const raw = msg as RawUserMsg;

    if (raw.isMeta) return null;

    let text = "";
    const messageContent = raw.message?.content;

    if (typeof messageContent === "string") {
        text = messageContent;
    } else if (Array.isArray(messageContent)) {
        text = messageContent
            .filter((b): b is ContentBlock => typeof b === "object" && b !== null)
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("\n");
    } else if (typeof raw.content === "string") {
        text = raw.content;
    }

    // Strip internal system injection markers
    const cleaned = stripSystemMarkers(text.trim());
    return cleaned || null;
}

type RawAssistantMsg = {
    message?: { content?: unknown };
};

function extractAssistantText(msg: SDKMessage): string | null {
    const raw = msg as RawAssistantMsg;
    const content = raw.message?.content;

    if (!Array.isArray(content)) return null;

    const textParts = content
        .filter((b): b is ContentBlock => typeof b === "object" && b !== null)
        .filter((b) => b.type === "text")  // skip tool_use, thinking, image
        .map((b) => b.text ?? "")
        .filter(Boolean);

    if (textParts.length === 0) return null;
    return textParts.join("\n").trim() || null;
}

/**
 * Strips system injection markers and other non-conversational content.
 */
function stripSystemMarkers(text: string): string {
    return text
        .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
        .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
        .replace(/<agent-memory>[\s\S]*?<\/agent-memory>/g, "")
        .replace(/<system[\s\S]*?<\/system>/g, "")
        .trim();
}
