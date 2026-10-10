import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

/**
 * Per-message BPagent context — the daily-notes block and memory recall —
 * reaches the model through a UserPromptSubmit hook (`additionalContext`,
 * stored as a hook_additional_context attachment on the user's turn) instead
 * of the system prompt. Both change between messages, and any change in the
 * system prompt rewrites the whole ~20k-token prompt cache on every resume.
 *
 * Each turn's context stays in the session transcript, so a resumed session
 * only gets what it has not seen yet: the daily block when it changed, and
 * memories not recalled earlier in the session. Tracking lives in memory;
 * after a sidecar restart a session gets its context once more.
 */
export type DeliveredTurnContext = {
    daily: string | null;
    memoryIds: ReadonlySet<string>;
};

const MAX_TRACKED_SESSIONS = 200;
const deliveredBySession = new Map<string, DeliveredTurnContext>();

export function getDeliveredTurnContext(sessionId: string | undefined): DeliveredTurnContext | undefined {
    return sessionId ? deliveredBySession.get(sessionId) : undefined;
}

function rememberDelivered(sessionId: string, delivered: DeliveredTurnContext): void {
    deliveredBySession.delete(sessionId);
    deliveredBySession.set(sessionId, delivered);
    if (deliveredBySession.size > MAX_TRACKED_SESSIONS) {
        const oldest = deliveredBySession.keys().next().value;
        if (oldest !== undefined) deliveredBySession.delete(oldest);
    }
}

/**
 * `memoryBlock`/`memoryIds` must already exclude `previous.memoryIds` (see
 * buildMemoryPromptBlock's `excludeIds`); the daily block is compared here.
 */
export function buildTurnContextHook(args: {
    daily: string | null;
    memoryBlock: string;
    memoryIds: readonly string[];
    previous: DeliveredTurnContext | undefined;
}): HookCallback {
    const { daily, memoryBlock, memoryIds, previous } = args;
    const additionalContext = [daily !== previous?.daily ? daily : null, memoryBlock || null]
        .filter((part): part is string => Boolean(part))
        .join("\n\n");

    return async (input) => {
        if (input.hook_event_name !== "UserPromptSubmit") return {};
        rememberDelivered(input.session_id, {
            daily: daily ?? previous?.daily ?? null,
            memoryIds: new Set([...(previous?.memoryIds ?? []), ...memoryIds]),
        });
        if (!additionalContext) return {};
        return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } };
    };
}
