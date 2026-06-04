import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
    searchAgentMemory,
    saveAgentMemory,
    listRecentAgentMemory,
    deleteAgentMemory,
} from "@/features/agent-memory/fx";
import { MemoryScopeSchema, MemoryKindSchema } from "@/features/agent-memory/index";
import type { AgentMemoryRecord } from "@/features/agent-memory/index";

/**
 * Format memory records as compact, token-efficient lines for tool output.
 * One record per line:
 *   • [scope/kind imp=0.85] mem_abc12: <title> — <text> [corrects: ...]
 */
function formatMemoryLines(records: AgentMemoryRecord[]): string {
    if (records.length === 0) return "(no matching memories)";

    const sanitize = (s: string): string => s.trim().replace(/[\r\n]+/g, " ");
    const truncate = (s: string, limit: number): string =>
        s.length <= limit ? s : s.slice(0, limit - 1) + "…";

    const lines: string[] = [];
    for (const r of records) {
        const impToken = typeof r.importance === "number"
            ? ` imp=${r.importance.toFixed(2)}`
            : "";
        const header = `[${r.scope}/${r.kind}${impToken}]`;
        const title = sanitize(r.title ?? "");
        const text = truncate(sanitize(r.text ?? ""), 240);

        // Support metadata.corrects (string or array) when present.
        const metaCorrects = (r as unknown as { metadata?: { corrects?: unknown } })
            ?.metadata?.corrects;
        // Also support the top-level `corrects` string field already on the record.
        const topCorrects = (r as { corrects?: unknown }).corrects;

        let correctsToken = "";
        const rawCorrects = metaCorrects ?? topCorrects;
        if (typeof rawCorrects === "string" && rawCorrects.trim().length > 0) {
            correctsToken = ` [corrects: ${truncate(sanitize(rawCorrects), 200)}]`;
        } else if (Array.isArray(rawCorrects) && rawCorrects.length > 0) {
            const joined = rawCorrects
                .filter((c): c is string => typeof c === "string")
                .map((c) => sanitize(c))
                .join(", ");
            if (joined.length > 0) {
                correctsToken = ` [corrects: ${truncate(joined, 200)}]`;
            }
        }

        lines.push(`• ${header} ${r.id}: ${title} — ${text}${correctsToken}`);
    }
    return lines.join("\n");
}

/**
 * Build an inline MCP server that exposes agent memory tools.
 * Scoped to a specific agentId so the agent can only access its own + workspace memories.
 *
 * When readOnly is true (extraction is enabled), only search/list tools are exposed.
 * Write tools (save/delete) are omitted — the extraction model handles writing after each session.
 */
export function buildAgentMemoryMcpServer(ctx: { agentId: string; sessionId?: string; readOnly?: boolean }) {
    const { agentId, readOnly = false } = ctx;

    return createSdkMcpServer({
        name: "agent-memory",
        version: "1.0.0",
        tools: [
            tool(
                "memory_search",
                `REQUIRED FIRST STEP for any user-specific question (identity, preferences, ongoing goals/projects, prior decisions, relationships). Searches the user's persistent memory across past sessions. Returns compact lines in the form \`• [scope/kind imp=X] id: title — text\` — NOT JSON. Call this BEFORE asking the user a question whose answer might already be stored, and BEFORE suggesting defaults based on your priors. Use short lexical queries (3–8 keywords) drawn from the user's message; if the first query returns 0 hits, do not reword and retry — just proceed.`,
                {
                    query: z.string().describe("Search query - 3-8 short keywords from the user's message"),
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
                            text: formatMemoryLines(results),
                        }],
                    };
                }
            ),

            ...(readOnly ? [] : [tool(
                "memory_save",
                `Save a durable fact the user revealed in conversation. ONLY save when: (a) the user explicitly told you to remember it, OR (b) the fact will be useful in a future session AND is unlikely to be re-derivable from project state, files, or the live API. DO NOT save transient task state, code patterns, file paths, lookup answers, or anything the file system / API already knows. The \`correction\` kind is RESERVED for the consolidation pipeline — to record a corrected fact, save it under its natural kind (identity / preference / decision / etc.) and the maintenance loop will link it to the outdated record automatically. Dedup by fingerprint is automatic.`,
                {
                    kind: MemoryKindSchema.describe("Type of memory: identity, preference, goal, project, decision, relationship, knowledge, context, or reference. NOTE: 'correction' is reserved for the consolidation pipeline and will be refused here."),
                    title: z.string().describe("Short title summarizing the memory"),
                    text: z.string().describe("Detailed content of the memory"),
                    scope: MemoryScopeSchema.optional().describe("'agent' (private, default) or 'workspace' (shared with subagents)"),
                    tags: z.array(z.string()).optional().describe("Tags for categorization"),
                    importance: z.number().min(0).max(1).optional().describe("Importance score 0-1 (default: 0.5). Use >=0.7 only for permanent identity/preferences/durable goals."),
                    confidence: z.number().min(0).max(1).optional().describe("Confidence score 0-1 (default: 0.8)"),
                    ttlDays: z.number().optional().describe("Days until expiry (default depends on kind)"),
                    sourceRef: z.string().optional().describe("Reference to source (note path, todo id, etc.)"),
                    supersedes: z.array(z.string()).optional().describe("IDs of older memories this one replaces. Listed memories will be archived (hidden but recoverable). Use when correcting an outdated or wrong memory."),
                },
                async (args) => {
                    if (args.kind === "correction") {
                        return {
                            content: [{
                                type: "text" as const,
                                text: "Refused: kind 'correction' is reserved for the consolidation pipeline. Save the new corrected fact normally (kind: preference/identity/etc.) and the maintenance loop will link it to the outdated record automatically.",
                            }],
                            isError: true,
                        };
                    }

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
                        supersedes: args.supersedes,
                    });

                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({
                                saved: true,
                                deduped: result.deduped,
                                id: result.record.id,
                                fingerprint: result.record.fingerprint,
                                supersededIds: result.supersededIds,
                            }),
                        }],
                    };
                }
            )]),

            tool(
                "memory_list_recent",
                `Lists the most recently updated memories in the requested scope. Use for orientation at the start of a session, NOT as a substitute for memory_search — keyword search is far more accurate when you have a specific question. Returns compact lines in the same format as memory_search.`,
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
                            text: formatMemoryLines(results),
                        }],
                    };
                }
            ),

            ...(readOnly ? [] : [tool(
                "memory_delete",
                `Permanently removes a memory record. PREFER letting the daily consolidation pipeline retire outdated facts (it preserves them via \`supersedes\`, so they remain recoverable). Only delete if the record is clearly invalid (corrupt, test data) or the user explicitly asks you to forget it.`,
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
            )]),
        ],
    });
}
