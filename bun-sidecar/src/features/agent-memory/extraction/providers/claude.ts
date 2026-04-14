import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { buildExtractionSystemPrompt, buildExtractionUserContent, parseExtractionResponse } from "../prompt";
import { MemoryCandidateSchema, ExtractionResponseSchema } from "../types";
import type { MemoryExtractionProvider, MemoryExtractionInput, MemoryCandidate } from "../types";

/** Use a cheap model for extraction — cost matters here. */
const DEFAULT_EXTRACTION_MODEL = "claude-haiku-4-5";

const logger = createServiceLogger("MEMORY_EXTRACTION_CLAUDE");

export class ClaudeExtractionProvider implements MemoryExtractionProvider {
    readonly name = "claude" as const;

    constructor(
        private readonly config: {
            model?: string;
        } = {}
    ) {}

    async extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]> {
        const apiKey = await secrets.get("ANTHROPIC_API_KEY");
        const oauthToken = await secrets.get("CLAUDE_CODE_OAUTH_TOKEN");

        if (!apiKey && !oauthToken) {
            throw new Error("No Anthropic API key available for Claude extraction provider");
        }

        const anthropic = createAnthropic({
            apiKey: apiKey ?? oauthToken ?? "",
        });

        const systemPrompt = buildExtractionSystemPrompt();
        const userContent = buildExtractionUserContent(input.conversationHistory);
        const model = this.config.model ?? DEFAULT_EXTRACTION_MODEL;

        const { text, usage } = await generateText({
            model: anthropic(model),
            system: systemPrompt,
            prompt: userContent,
            temperature: 0.1,
        });

        logger.info("Claude extraction complete", {
            model,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            sessionId: input.sessionId,
        });

        return parseCandidates(text, input.sessionId);
    }

    async healthCheck(): Promise<boolean> {
        const apiKey = await secrets.get("ANTHROPIC_API_KEY");
        const oauthToken = await secrets.get("CLAUDE_CODE_OAUTH_TOKEN");
        return !!(apiKey || oauthToken);
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
