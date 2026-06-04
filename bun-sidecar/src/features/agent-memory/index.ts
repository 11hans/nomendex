import { z } from "zod";

// --- Schemas ---

export const MemoryScopeSchema = z.enum(["agent", "workspace"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryKindSchema = z.enum([
    "identity",
    "preference",
    "goal",
    "project",
    "decision",
    "relationship",
    "knowledge",
    "context",
    "reference",
    "correction",
]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const AgentMemoryRecordSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    title: z.string(),
    text: z.string(),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(0).max(1).default(0.5),
    confidence: z.number().min(0).max(1).default(0.8),
    fingerprint: z.string(),
    sourceType: z.enum(["chat", "note", "todo", "manual", "system"]).optional(),
    sourceRef: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastAccessedAt: z.string(),
    expiresAt: z.string().nullish(),
    archived: z.boolean().optional(),
    accessCount: z.number().int().min(0).default(0),
    supersedes: z.array(z.string()).default([]),
    /**
     * Free-text description of the older fact this memory corrects.
     * Set on records of kind="correction" (and optionally on others) to record
     * what was previously believed.
     */
    corrects: z.string().max(1000).optional(),
});
export type AgentMemoryRecord = z.infer<typeof AgentMemoryRecordSchema>;

// --- Default TTL by kind (days, undefined = no expiry) ---

export const DEFAULT_TTL_DAYS: Record<MemoryKind, number | undefined> = {
    context: 14,
    reference: 90,
    goal: undefined,
    project: undefined,
    decision: undefined,
    preference: undefined,
    correction: undefined,
    identity: undefined,
    relationship: undefined,
    knowledge: 365,
};

/**
 * Per-kind decay multiplier. Multiplied into lambda when computing decayed score.
 * < 1.0 = slower decay (more durable); > 1.0 = faster decay (more ephemeral).
 * 1.0 is the historical default.
 */
export const DECAY_RATE_BY_KIND: Record<MemoryKind, number> = {
    identity: 0.3,        // very stable: name, role, languages
    preference: 0.6,      // taste shifts slowly
    goal: 0.7,            // can pivot but not weekly
    project: 0.8,         // active projects churn
    decision: 0.8,        // decisions get revisited
    relationship: 0.4,    // people endure
    knowledge: 0.7,       // domain knowledge ages slowly
    context: 1.5,         // ephemeral by design
    reference: 1.0,       // baseline
    correction: 0.5,      // a correction is a deliberate overwrite — keep it durable
};
