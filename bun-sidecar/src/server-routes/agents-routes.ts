// API routes for agents feature

import {
    getAgent,
    listAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    duplicateAgent,
    getPreferences,
    savePreferences,
    getMcpRegistry,
} from "@/features/agents/fx";
import { buildAgentModelCatalog } from "@/features/agents/index";

type AgentModelsResponse = {
    models: string[];
    source: "anthropic" | "fallback";
    hasAnthropicApiKey: boolean;
    error?: string;
};

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedModels: (AgentModelsResponse & { cachedAt: number }) | null = null;

async function listAvailableAgentModels(): Promise<AgentModelsResponse> {
    const now = Date.now();
    if (cachedModels && now - cachedModels.cachedAt < MODELS_CACHE_TTL_MS) {
        const { cachedAt: _cachedAt, ...response } = cachedModels;
        return response;
    }

    const fallbackModels = buildAgentModelCatalog([]);
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();

    if (!anthropicApiKey) {
        const response: AgentModelsResponse = {
            models: fallbackModels,
            source: "fallback",
            hasAnthropicApiKey: false,
        };
        cachedModels = { ...response, cachedAt: now };
        return response;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 5000);

    try {
        const response = await fetch("https://api.anthropic.com/v1/models", {
            method: "GET",
            headers: {
                "x-api-key": anthropicApiKey,
                "anthropic-version": "2023-06-01",
            },
            signal: abortController.signal,
        });

        if (!response.ok) {
            throw new Error(`Anthropic models request failed (${response.status})`);
        }

        const body = await response.json() as { data?: Array<{ id?: string }> };
        const anthropicModels = (body.data || [])
            .map((model) => model.id?.trim() || "")
            .filter(Boolean);

        const apiResponse: AgentModelsResponse = {
            models: buildAgentModelCatalog(anthropicModels),
            source: "anthropic",
            hasAnthropicApiKey: true,
        };
        cachedModels = { ...apiResponse, cachedAt: now };
        return apiResponse;
    } catch (error) {
        const fallbackResponse: AgentModelsResponse = {
            models: fallbackModels,
            source: "fallback",
            hasAnthropicApiKey: true,
            error: error instanceof Error ? error.message : String(error),
        };
        cachedModels = { ...fallbackResponse, cachedAt: now };
        return fallbackResponse;
    } finally {
        clearTimeout(timeoutId);
    }
}

export const agentsRoutes = {
    "/api/agents/list": {
        async GET() {
            const agents = await listAgents();
            return Response.json(agents);
        },
    },

    "/api/agents/get": {
        async POST(req: Request) {
            const { agentId } = await req.json();
            const agent = await getAgent({ agentId });
            if (!agent) {
                return Response.json({ error: "Agent not found" }, { status: 404 });
            }
            return Response.json(agent);
        },
    },

    "/api/agents/create": {
        async POST(req: Request) {
            const args = await req.json();
            const agent = await createAgent(args);
            return Response.json(agent);
        },
    },

    "/api/agents/update": {
        async POST(req: Request) {
            const args = await req.json();
            const agent = await updateAgent(args);
            if (!agent) {
                return Response.json({ error: "Agent not found" }, { status: 404 });
            }
            return Response.json(agent);
        },
    },

    "/api/agents/delete": {
        async POST(req: Request) {
            const { agentId } = await req.json();
            const result = await deleteAgent({ agentId });
            return Response.json(result);
        },
    },

    "/api/agents/duplicate": {
        async POST(req: Request) {
            const { agentId } = await req.json();
            const agent = await duplicateAgent({ agentId });
            return Response.json(agent);
        },
    },

    "/api/agents/preferences": {
        async GET() {
            const preferences = await getPreferences();
            return Response.json(preferences);
        },
        async POST(req: Request) {
            const preferences = await req.json();
            await savePreferences(preferences);
            return Response.json({ success: true });
        },
    },

    "/api/agents/models": {
        async GET() {
            const models = await listAvailableAgentModels();
            return Response.json(models);
        },
    },

    "/api/mcp-registry": {
        async GET() {
            const registry = getMcpRegistry();
            return Response.json(registry);
        },
    },
};
