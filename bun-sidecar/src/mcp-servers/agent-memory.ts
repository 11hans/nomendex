import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
    searchAgentMemory,
    saveAgentMemory,
    listRecentAgentMemory,
    deleteAgentMemory,
} from "@/features/agent-memory/fx";
import { MemoryScopeSchema, MemoryKindSchema } from "@/features/agent-memory/index";

/**
 * Build an inline MCP server that exposes agent memory tools.
 * Scoped to a specific agentId so the agent can only access its own + workspace memories.
 */
export function buildAgentMemoryMcpServer(ctx: { agentId: string; sessionId?: string }) {
    const { agentId } = ctx;

    return createSdkMcpServer({
        name: "agent-memory",
        version: "1.0.0",
        tools: [
            tool(
                "memory_search",
                `Search your long-term memory for relevant information from previous sessions. Use this to recall context, decisions, goals, preferences, or any knowledge you've saved before. Returns the most relevant memories ranked by relevance to your query.`,
                {
                    query: z.string().describe("Search query - describe what you're looking for"),
                    limit: z.number().optional().describe("Max results to return (default: 10)"),
                    scope: MemoryScopeSchema.optional().describe("Filter by scope: 'agent' (private) or 'workspace' (shared)"),
                },
                async (args) => {
                    const results = await searchAgentMemory({
                        agentId,
                        query: args.query,
                        scopes: args.scope ? [args.scope] : undefined,
                        limit: args.limit,
                    });

                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify(results, null, 2),
                        }],
                    };
                }
            ),

            tool(
                "memory_save",
                `Save information to your long-term memory so you can recall it in future sessions. Use this to remember:
- User preferences and working style
- Goals and objectives
- Project context and decisions
- Important references and links
- Contextual information about the workspace

Duplicate detection is automatic - saving the same fact again will merge rather than create duplicates.`,
                {
                    kind: MemoryKindSchema.describe("Type of memory: preference, goal, project, decision, context, or reference"),
                    title: z.string().describe("Short title summarizing the memory"),
                    text: z.string().describe("Detailed content of the memory"),
                    scope: MemoryScopeSchema.optional().describe("'agent' (private, default) or 'workspace' (shared with subagents)"),
                    tags: z.array(z.string()).optional().describe("Tags for categorization"),
                    importance: z.number().min(0).max(1).optional().describe("Importance score 0-1 (default: 0.5)"),
                    confidence: z.number().min(0).max(1).optional().describe("Confidence score 0-1 (default: 0.8)"),
                    ttlDays: z.number().optional().describe("Days until expiry (default depends on kind)"),
                    sourceRef: z.string().optional().describe("Reference to source (note path, todo id, etc.)"),
                },
                async (args) => {
                    const result = await saveAgentMemory({
                        agentId,
                        scope: args.scope || "agent",
                        kind: args.kind,
                        title: args.title,
                        text: args.text,
                        tags: args.tags,
                        importance: args.importance,
                        confidence: args.confidence,
                        ttlDays: args.ttlDays,
                        sourceType: "chat",
                        sourceRef: args.sourceRef,
                    });

                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({
                                saved: true,
                                deduped: result.deduped,
                                id: result.record.id,
                                fingerprint: result.record.fingerprint,
                            }),
                        }],
                    };
                }
            ),

            tool(
                "memory_list_recent",
                `List your most recently updated memories. Useful for reviewing what you know or checking recent context.`,
                {
                    limit: z.number().optional().describe("Max results (default: 20)"),
                    scope: MemoryScopeSchema.optional().describe("Filter by scope"),
                },
                async (args) => {
                    const results = await listRecentAgentMemory({
                        agentId,
                        scope: args.scope,
                        limit: args.limit,
                    });

                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify(results, null, 2),
                        }],
                    };
                }
            ),

            tool(
                "memory_delete",
                `Delete a specific memory by its ID. Use when information is outdated or incorrect.`,
                {
                    memoryId: z.string().describe("The ID of the memory to delete"),
                },
                async (args) => {
                    const deleted = await deleteAgentMemory({
                        agentId,
                        memoryId: args.memoryId,
                    });

                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({ deleted }),
                        }],
                    };
                }
            ),
        ],
    });
}
