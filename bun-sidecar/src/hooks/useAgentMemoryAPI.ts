import type { AgentMemoryRecord, MemoryKind } from "@/features/agent-memory";

const AGENT_ID = "bpagent";

async function fetchAPI<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`/api/agent-memory/manage/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: AGENT_ID, ...body }),
    });
    if (!response.ok) {
        let errorMessage = `API error: ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData && typeof errorData.error === "string") {
                errorMessage = errorData.error;
            }
        } catch {
            // parsing failed, use default message
        }
        throw new Error(errorMessage);
    }
    return response.json();
}

export const agentMemoryAPI = {
    listManagedMemories: (args: {
        search?: string;
        kinds?: MemoryKind[];
        limit?: number;
        offset?: number;
    } = {}) => fetchAPI<{ items: AgentMemoryRecord[]; total: number }>("list", args),

    getMemoryMarkdown: (args: { memoryId: string }) =>
        fetchAPI<{ markdown: string; record: AgentMemoryRecord }>("get-markdown", args),

    createMemoryFromMarkdown: (args: { kind?: MemoryKind } = {}) =>
        fetchAPI<{ markdown: string }>("create-markdown", args),

    saveMemoryMarkdown: (args: { memoryId?: string; markdown: string }) =>
        fetchAPI<{ record: AgentMemoryRecord }>("save-markdown", args),

    deleteMemory: (args: { memoryId: string }) =>
        fetchAPI<{ deleted: boolean }>("delete", args),
};

export function useAgentMemoryAPI() {
    return agentMemoryAPI;
}
