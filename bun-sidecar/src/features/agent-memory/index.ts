import { z } from "zod";

// --- Schemas ---

export const MemoryScopeSchema = z.enum(["agent", "workspace"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryKindSchema = z.enum([
    "preference",
    "goal",
    "project",
    "decision",
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
};
