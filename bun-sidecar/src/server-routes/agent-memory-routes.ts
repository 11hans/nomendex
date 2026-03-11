import { z } from "zod";
import {
    searchAgentMemory,
    saveAgentMemory,
    deleteAgentMemory,
    listRecentAgentMemory,
} from "@/features/agent-memory/fx";
import { MemoryScopeSchema, MemoryKindSchema } from "@/features/agent-memory/index";

/**
 * Agent IDs that are allowed to use memory.
 * Prevents arbitrary agentId spoofing from the client.
 */
const MEMORY_ENABLED_AGENT_IDS = new Set(["bpagent"]);

class ForbiddenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ForbiddenError";
    }
}

function validateAgentId(agentId: unknown): string {
    if (typeof agentId !== "string" || !MEMORY_ENABLED_AGENT_IDS.has(agentId)) {
        throw new ForbiddenError(`Agent "${String(agentId)}" is not memory-enabled`);
    }
    return agentId;
}

function errorStatus(error: unknown): number {
    if (error instanceof z.ZodError) return 400;
    if (error instanceof ForbiddenError) return 403;
    return 500;
}

// --- Request schemas ---

const SearchInputSchema = z.object({
    agentId: z.string(),
    query: z.string(),
    scopes: z.array(MemoryScopeSchema).optional(),
    limit: z.number().int().min(1).max(100).optional(),
});

const SaveInputSchema = z.object({
    agentId: z.string(),
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    title: z.string().max(500),
    text: z.string().max(10_000),
    tags: z.array(z.string().max(100)).max(20).optional(),
    importance: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    sourceType: z.enum(["chat", "note", "todo", "manual", "system"]).optional(),
    sourceRef: z.string().max(500).optional(),
    ttlDays: z.number().int().min(1).max(3650).optional(),
});

const DeleteInputSchema = z.object({
    agentId: z.string(),
    memoryId: z.string(),
});

const ListRecentInputSchema = z.object({
    agentId: z.string(),
    scope: MemoryScopeSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
});

export const agentMemoryRoutes = {
    "/api/agent-memory/search": {
        async POST(req: Request) {
            try {
                const body = SearchInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const results = await searchAgentMemory(body);
                return Response.json(results);
            } catch (error) {
                const status = errorStatus(error);
                return Response.json(
                    { error: error instanceof Error ? error.message : String(error) },
                    { status }
                );
            }
        },
    },

    "/api/agent-memory/save": {
        async POST(req: Request) {
            try {
                const body = SaveInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const result = await saveAgentMemory(body);
                return Response.json(result);
            } catch (error) {
                const status = errorStatus(error);
                return Response.json(
                    { error: error instanceof Error ? error.message : String(error) },
                    { status }
                );
            }
        },
    },

    "/api/agent-memory/delete": {
        async POST(req: Request) {
            try {
                const body = DeleteInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const result = await deleteAgentMemory(body);
                return Response.json({ deleted: result });
            } catch (error) {
                const status = errorStatus(error);
                return Response.json(
                    { error: error instanceof Error ? error.message : String(error) },
                    { status }
                );
            }
        },
    },

    "/api/agent-memory/list-recent": {
        async POST(req: Request) {
            try {
                const body = ListRecentInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const results = await listRecentAgentMemory(body);
                return Response.json(results);
            } catch (error) {
                const status = errorStatus(error);
                return Response.json(
                    { error: error instanceof Error ? error.message : String(error) },
                    { status }
                );
            }
        },
    },
};
