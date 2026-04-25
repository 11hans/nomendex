import { createServiceLogger } from "@/lib/logger";
import { buildExtractionSystemPrompt, buildExtractionUserContent, parseExtractionResponse } from "../prompt";
import { MemoryCandidateSchema, ExtractionResponseSchema } from "../types";
import type { MemoryExtractionProvider, MemoryExtractionInput, MemoryCandidate } from "../types";
import { DEV_COST_HUD_ENABLED, buildExtractionEvent, logUsageEvent } from "@/dev/usage-logger";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2_000;

const logger = createServiceLogger("MEMORY_EXTRACTION_OPENROUTER");

export class OpenRouterExtractionProvider implements MemoryExtractionProvider {
    readonly name = "openrouter" as const;

    constructor(
        private readonly config: {
            apiKey: string;
            model: string;
            timeoutMs?: number;
        }
    ) {}

    async extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]> {
        const systemPrompt = buildExtractionSystemPrompt();
        const userContent = buildExtractionUserContent(input.conversationHistory);

        const body = {
            model: this.config.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
            ],
            temperature: 0.1,
            max_tokens: DEFAULT_MAX_TOKENS,
        };

        const startedAt = Date.now();
        const response = await fetch(OPENROUTER_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://nomendex.app",
                "X-Title": "Nomendex Memory Extraction",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
            const errorText = await response.text().catch(() => "(unreadable)");
            throw new Error(
                `OpenRouter API error ${response.status}: ${errorText.slice(0, 200)}`
            );
        }

        const json = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const content = json.choices?.[0]?.message?.content ?? "";
        const usage = json.usage;

        logger.info("OpenRouter extraction complete", {
            model: this.config.model,
            inputTokens: usage?.prompt_tokens,
            outputTokens: usage?.completion_tokens,
            totalTokens: usage?.total_tokens,
            sessionId: input.sessionId,
        });

        if (DEV_COST_HUD_ENABLED) {
            // OpenRouter pricing isn't tracked in pricing.ts (varies per third-party model),
            // so we log token counts and force cost to 0 rather than misreport.
            void logUsageEvent(buildExtractionEvent({
                sessionId: input.sessionId,
                agentId: input.agentId,
                model: this.config.model,
                provider: "openrouter",
                usage: {
                    inputTokens: usage?.prompt_tokens ?? 0,
                    outputTokens: usage?.completion_tokens ?? 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                },
                durationMs,
                costUsdOverride: 0,
            }));
        }

        return parseCandidates(content, input.sessionId);
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch("https://openrouter.ai/api/v1/models", {
                headers: { "Authorization": `Bearer ${this.config.apiKey}` },
                signal: AbortSignal.timeout(5_000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}

function parseCandidates(rawContent: string, sessionId: string): MemoryCandidate[] {
    const rawMemories = parseExtractionResponse(rawContent);

    if (!rawMemories) {
        logger.warn("Could not parse extraction response", {
            sessionId,
            preview: rawContent.slice(0, 200),
        });
        return [];
    }

    const result = ExtractionResponseSchema.safeParse({ memories: rawMemories });
    if (!result.success) {
        // Partially valid: parse each candidate individually and keep valid ones
        const valid: MemoryCandidate[] = [];
        for (const raw of rawMemories) {
            const parsed = MemoryCandidateSchema.safeParse(raw);
            if (parsed.success) {
                valid.push(parsed.data);
            } else {
                logger.warn("Skipping invalid memory candidate", {
                    sessionId,
                    error: parsed.error.message,
                    title: typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).title : "(unknown)",
                });
            }
        }
        return valid;
    }

    return result.data.memories;
}
