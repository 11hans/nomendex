import { z } from "zod";
import {
    searchAgentMemory,
    saveAgentMemory,
    deleteAgentMemory,
    listRecentAgentMemory,
    listManagedMemories,
    getMemoryMarkdown,
    createMemoryTemplate,
    saveMemoryFromMarkdown,
    syncAgentMemoryFromVault,
    MemoryWorkspaceMismatchError,
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

// --- Management route schemas ---

const ManageListInputSchema = z.object({
    agentId: z.string(),
    search: z.string().optional(),
    kinds: z.array(MemoryKindSchema).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
});

const ManageGetMarkdownInputSchema = z.object({
    agentId: z.string(),
    memoryId: z.string(),
});

const ManageCreateMarkdownInputSchema = z.object({
    agentId: z.string(),
    kind: MemoryKindSchema.optional(),
});

const ManageSaveMarkdownInputSchema = z.object({
    agentId: z.string(),
    memoryId: z.string().optional(),
    markdown: z.string().max(15_000),
});

const ManageDeleteInputSchema = z.object({
    agentId: z.string(),
    memoryId: z.string(),
});

const ManageSyncVaultInputSchema = z.object({
    agentId: z.string(),
    maxProjectFiles: z.number().int().min(1).max(500).optional(),
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

    // --- Management routes (Memory Studio) ---

    "/api/agent-memory/manage/list": {
        async POST(req: Request) {
            try {
                const body = ManageListInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const result = await listManagedMemories(body);
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

    "/api/agent-memory/manage/get-markdown": {
        async POST(req: Request) {
            try {
                const body = ManageGetMarkdownInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const result = await getMemoryMarkdown(body);
                if (!result) {
                    return Response.json({ error: "Memory not found" }, { status: 404 });
                }
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

    "/api/agent-memory/manage/create-markdown": {
        async POST(req: Request) {
            try {
                const body = ManageCreateMarkdownInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const markdown = createMemoryTemplate({ kind: body.kind });
                return Response.json({ markdown });
            } catch (error) {
                const status = errorStatus(error);
                return Response.json(
                    { error: error instanceof Error ? error.message : String(error) },
                    { status }
                );
            }
        },
    },

    "/api/agent-memory/manage/save-markdown": {
        async POST(req: Request) {
            try {
                const body = ManageSaveMarkdownInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const result = await saveMemoryFromMarkdown(body);
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

    "/api/agent-memory/manage/delete": {
        async POST(req: Request) {
            try {
                const body = ManageDeleteInputSchema.parse(await req.json());
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

    "/api/agent-memory/manage/sync-vault": {
        async POST(req: Request) {
            try {
                const body = ManageSyncVaultInputSchema.parse(await req.json());
                validateAgentId(body.agentId);
                const result = await syncAgentMemoryFromVault(body);
                return Response.json(result);
            } catch (error) {
                if (error instanceof MemoryWorkspaceMismatchError) {
                    return Response.json(
                        {
                            code: error.code,
                            expectedWorkspacePath: error.expectedWorkspacePath,
                            activeWorkspacePath: error.activeWorkspacePath,
                            error: error.message,
                        },
                        { status: 409 }
                    );
                }
                const status = errorStatus(error);
                return Response.json(
                    { error: error instanceof Error ? error.message : String(error) },
                    { status }
                );
            }
        },
    },
};
