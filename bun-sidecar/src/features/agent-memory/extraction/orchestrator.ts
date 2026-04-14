import path from "node:path";
import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { WorkspaceStateSchema } from "@/types/Workspace";
import { saveAgentMemory } from "../fx";
import { OpenRouterExtractionProvider } from "./providers/openrouter";
import { ClaudeExtractionProvider } from "./providers/claude";
import type { MemoryExtractionInput, MemoryExtractionConfig, MemoryExtractionProvider } from "./types";

const logger = createServiceLogger("MEMORY_EXTRACTION");

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export async function loadExtractionConfig(): Promise<MemoryExtractionConfig> {
    if (!hasActiveWorkspace()) {
        return { provider: "disabled", openRouterModel: "xiaomi/mimo-v2-flash:free" };
    }

    try {
        const workspaceFile = Bun.file(path.join(getNomendexPath(), "workspace.json"));
        if (!(await workspaceFile.exists())) {
            return { provider: "disabled", openRouterModel: "xiaomi/mimo-v2-flash:free" };
        }
        const raw = await workspaceFile.json();
        const state = WorkspaceStateSchema.parse(raw);
        const { provider, openRouterModel } = state.memoryExtraction;

        let openRouterApiKey: string | undefined;
        if (provider === "openrouter") {
            openRouterApiKey = await secrets.get("OPENROUTER_API_KEY");
        }

        return { provider, openRouterModel, openRouterApiKey };
    } catch (error) {
        logger.warn("Failed to load extraction config, defaulting to disabled", {
            error: error instanceof Error ? error.message : String(error),
        });
        return { provider: "disabled", openRouterModel: "xiaomi/mimo-v2-flash:free" };
    }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

async function buildProvider(config: MemoryExtractionConfig): Promise<MemoryExtractionProvider | null> {
    if (config.provider === "disabled") return null;

    if (config.provider === "openrouter") {
        if (!config.openRouterApiKey) {
            logger.warn("OpenRouter provider configured but OPENROUTER_API_KEY is missing");
            return null;
        }
        return new OpenRouterExtractionProvider({
            apiKey: config.openRouterApiKey,
            model: config.openRouterModel,
        });
    }

    if (config.provider === "claude") {
        return new ClaudeExtractionProvider();
    }

    return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export type ExtractionSummary = {
    saved: number;
    deduped: number;
    skipped: number;
    providerUsed: "claude" | "openrouter" | "none";
    durationMs: number;
};

/**
 * Runs post-session memory extraction fire-and-forget.
 * Reads config from workspace.json, picks a provider, extracts candidates,
 * and saves them via saveAgentMemory().
 *
 * This function never throws — all errors are caught and logged.
 */
export async function triggerPostSessionExtraction(
    input: MemoryExtractionInput
): Promise<ExtractionSummary> {
    const startTime = Date.now();

    const config = await loadExtractionConfig();
    if (config.provider === "disabled") {
        return { saved: 0, deduped: 0, skipped: 0, providerUsed: "none", durationMs: 0 };
    }

    if (input.conversationHistory.length < 2) {
        logger.debug("Skipping extraction — conversation too short", {
            turns: input.conversationHistory.length,
            sessionId: input.sessionId,
        });
        return { saved: 0, deduped: 0, skipped: 0, providerUsed: "none", durationMs: 0 };
    }

    let provider = await buildProvider(config);

    if (!provider) {
        return { saved: 0, deduped: 0, skipped: 0, providerUsed: "none", durationMs: 0 };
    }

    let candidates;
    try {
        candidates = await provider.extract(input);
    } catch (primaryError) {
        logger.warn(`Primary extraction provider (${provider.name}) failed, trying Claude fallback`, {
            error: primaryError instanceof Error ? primaryError.message : String(primaryError),
            sessionId: input.sessionId,
        });

        // Fallback to Claude only if primary was OpenRouter
        if (provider.name === "openrouter") {
            try {
                const fallback = new ClaudeExtractionProvider();
                candidates = await fallback.extract(input);
                provider = fallback;
            } catch (fallbackError) {
                logger.warn("Claude fallback also failed, aborting extraction", {
                    error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                    sessionId: input.sessionId,
                });
                return {
                    saved: 0,
                    deduped: 0,
                    skipped: 0,
                    providerUsed: "none",
                    durationMs: Date.now() - startTime,
                };
            }
        } else {
            return {
                saved: 0,
                deduped: 0,
                skipped: 0,
                providerUsed: "none",
                durationMs: Date.now() - startTime,
            };
        }
    }

    if (candidates.length === 0) {
        logger.debug("Extraction produced no candidates", { sessionId: input.sessionId });
        return {
            saved: 0,
            deduped: 0,
            skipped: 0,
            providerUsed: provider.name,
            durationMs: Date.now() - startTime,
        };
    }

    // Save all candidates
    let saved = 0;
    let deduped = 0;
    let skipped = 0;

    for (const candidate of candidates) {
        try {
            const result = await saveAgentMemory({
                agentId: input.agentId,
                scope: candidate.scope,
                kind: candidate.kind,
                title: candidate.title,
                text: candidate.text,
                tags: candidate.tags,
                importance: candidate.importance,
                confidence: candidate.confidence,
                sourceType: "chat",
                sourceRef: input.sessionId,
            });

            if (result.deduped) {
                deduped++;
            } else {
                saved++;
            }
        } catch (saveError) {
            skipped++;
            logger.warn("Failed to save extracted memory candidate", {
                title: candidate.title,
                error: saveError instanceof Error ? saveError.message : String(saveError),
                sessionId: input.sessionId,
            });
        }
    }

    const durationMs = Date.now() - startTime;
    logger.info("Post-session extraction complete", {
        providerUsed: provider.name,
        model: config.provider === "openrouter" ? config.openRouterModel : undefined,
        saved,
        deduped,
        skipped,
        total: candidates.length,
        durationMs,
        sessionId: input.sessionId,
    });

    return { saved, deduped, skipped, providerUsed: provider.name, durationMs };
}
