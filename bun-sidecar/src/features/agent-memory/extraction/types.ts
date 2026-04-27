import { z } from "zod";
import { MemoryKindSchema, MemoryScopeSchema } from "../index";

// --- Input ---

export type ConversationTurn = {
    role: "user" | "assistant";
    /** Plain text only — tool call content and images are stripped before extraction. */
    text: string;
};

export type MemoryExtractionInput = {
    agentId: string;
    sessionId: string;
    conversationHistory: ConversationTurn[];
};

// --- Output ---

export const MemoryCandidateSchema = z.object({
    kind: MemoryKindSchema,
    scope: MemoryScopeSchema,
    title: z.string().min(1).max(500),
    text: z.string().min(1).max(10_000),
    tags: z.array(z.string().max(100)).max(20).default([]),
    importance: z.number().min(0).max(1).default(0.5),
    confidence: z.number().min(0).max(1).default(0.8),
    /**
     * Optional description of an earlier memory this candidate corrects.
     * The orchestrator resolves this to a concrete memory id via search and
     * passes it as `supersedes` to saveAgentMemory.
     */
    corrects: z.string().max(500).optional(),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export const ExtractionResponseSchema = z.object({
    memories: z.array(MemoryCandidateSchema),
});

export type ExtractionResult = {
    candidates: MemoryCandidate[];
    providerUsed: "claude" | "openrouter";
    tokensUsed?: number;
    durationMs: number;
};

// --- Provider interface ---

export interface MemoryExtractionProvider {
    readonly name: "claude" | "openrouter";
    extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]>;
    healthCheck(): Promise<boolean>;
}

// --- Config (read from workspace state) ---

export type MemoryExtractionConfig = {
    provider: "disabled" | "claude" | "openrouter";
    openRouterModel: string;
    openRouterApiKey?: string;
};

export const DEFAULT_OPENROUTER_MODEL = "xiaomi/mimo-v2-flash:free";
