import { z } from "zod";

// Model schema - accepts any string for flexibility with new/preview models
export const ModelSchema = z.string();

export type AgentModel = z.infer<typeof ModelSchema>;

// Curated fallback models (canonical IDs) used when dynamic model listing is unavailable.
export const PREDEFINED_MODELS = [
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-opus-4-6",
    "claude-opus-4-1",
    "claude-haiku-4-5",
    "claude-3-5-haiku-20241022",
] as const;

export type PredefinedModel = (typeof PREDEFINED_MODELS)[number];

// Legacy model IDs can be normalized to canonical IDs for a cleaner model picker.
const MODEL_CANONICAL_ID_MAP: Record<string, string> = {
    "claude-sonnet-4-5-20250929": "claude-sonnet-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
    "claude-opus-4-1-20250805": "claude-opus-4-1",
};

// Display names for known model IDs (canonical + legacy aliases).
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-sonnet-4-5": "Claude Sonnet 4.5",
    "claude-sonnet-4-5-20250929": "Claude Sonnet 4.5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-opus-4-1": "Claude Opus 4.1",
    "claude-opus-4-1-20250805": "Claude Opus 4.1",
    "claude-opus-4-5-20251101": "Claude Opus 4.5",
    "claude-opus-4-20250514": "Claude Opus 4",
    "claude-3-5-haiku-20241022": "Claude Haiku 3.5",
};

export function normalizeAgentModelId(model: string): string {
    const mapped = MODEL_CANONICAL_ID_MAP[model];
    if (mapped) return mapped;

    // Normalize dated snapshots to canonical aliases:
    // claude-{family}-{major}-{minor}-{yyyymmdd} -> claude-{family}-{major}-{minor}
    const datedSnapshotMatch = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)-\d{8}$/);
    if (datedSnapshotMatch) {
        const [, family, major, minor] = datedSnapshotMatch;
        return `claude-${family}-${major}-${minor}`;
    }

    return model;
}

function isSupportedAgentModel(model: string): boolean {
    if ((PREDEFINED_MODELS as readonly string[]).includes(model)) return true;
    // claude-{family}-{major}-{minor}[-yyyymmdd]
    const modernMatch = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8})?$/);
    if (modernMatch) {
        const major = Number(modernMatch[2]);
        return major >= 4;
    }
    return false;
}

export function buildAgentModelCatalog(models: string[]): string[] {
    const normalized = models
        .map((model) => normalizeAgentModelId(model.trim()))
        .filter((model) => model.length > 0)
        .filter(isSupportedAgentModel);

    const merged = Array.from(new Set([...PREDEFINED_MODELS, ...normalized]));
    const orderedDefaults = PREDEFINED_MODELS.filter((model) => merged.includes(model));
    const orderedDefaultsSet = new Set<string>(orderedDefaults);
    const extras = merged
        .filter((model) => !orderedDefaultsSet.has(model))
        .sort((a, b) => a.localeCompare(b));

    return [...orderedDefaults, ...extras];
}

// Helper to get display name for any model (predefined or custom)
export function getModelDisplayName(model: string): string {
    const normalized = normalizeAgentModelId(model);
    if (normalized in MODEL_DISPLAY_NAMES) {
        return MODEL_DISPLAY_NAMES[normalized];
    }
    if (model in MODEL_DISPLAY_NAMES) {
        return MODEL_DISPLAY_NAMES[model];
    }

    // Best-effort human label for unseen Claude models (future-proofing).
    const modernMatch = normalized.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/);
    if (modernMatch) {
        const family = modernMatch[1][0].toUpperCase() + modernMatch[1].slice(1);
        return `Claude ${family} ${modernMatch[2]}.${modernMatch[3]}`;
    }

    const legacyMatch = normalized.match(/^claude-(\d+)-(\d+)-(opus|sonnet|haiku)-\d{8}$/);
    if (legacyMatch) {
        const family = legacyMatch[3][0].toUpperCase() + legacyMatch[3].slice(1);
        return `Claude ${family} ${legacyMatch[1]}.${legacyMatch[2]}`;
    }

    return model; // Return raw identifier for custom models
}

// Agent configuration schema
export const AgentConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    systemPrompt: z.string(),
    model: ModelSchema,
    mcpServers: z.array(z.string()).default([]), // Array of MCP server IDs from registry
    allowedTools: z.array(z.string()).default([]), // Tools that are always allowed (persisted permissions)
    isDefault: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export type AgentEffectivePromptSource = "custom" | "default_with_context" | "bpagent_runtime";

export type AgentEffectivePromptInfo = {
    source: AgentEffectivePromptSource;
    summary: string;
    previewText: string;
};

export function getAgentEffectivePromptSource(agent: Pick<AgentConfig, "id" | "systemPrompt">): AgentEffectivePromptSource {
    if (agent.id === "bpagent") return "bpagent_runtime";
    if (agent.systemPrompt.trim().length > 0) return "custom";
    return "default_with_context";
}

export function getAgentEffectivePromptInfo(
    agent: Pick<AgentConfig, "id" | "systemPrompt">,
    options?: { customPreviewMaxLength?: number }
): AgentEffectivePromptInfo {
    const source = getAgentEffectivePromptSource(agent);

    if (source === "bpagent_runtime") {
        return {
            source,
            summary: "Prompt is composed at runtime for BPagent sessions.",
            previewText: "Runtime-composed: <agent-context> (notes path) + BP template + optional memory block.",
        };
    }

    if (source === "custom") {
        const maxLength = options?.customPreviewMaxLength ?? 200;
        const prompt = agent.systemPrompt.trim();
        return {
            source,
            summary: "Uses the custom system prompt saved in this agent profile.",
            previewText: prompt.length > maxLength ? `${prompt.slice(0, maxLength)}...` : prompt,
        };
    }

    return {
        source,
        summary: "Uses Claude Code default system prompt with runtime context injection.",
        previewText: "Claude Code default system prompt + runtime <agent-context> (date + workspace folder).",
    };
}

// Built-in agent IDs that cannot be updated or deleted
export const BUILT_IN_AGENT_IDS = ["default", "bpagent"] as const;
export type BuiltInAgentId = (typeof BUILT_IN_AGENT_IDS)[number];

export function isBuiltInAgentId(id: string): id is BuiltInAgentId {
    return (BUILT_IN_AGENT_IDS as readonly string[]).includes(id);
}

// Agent preferences schema
export const AgentPreferencesSchema = z.object({
    lastUsedAgentId: z.string(),
    builtInAgentAllowedTools: z.record(z.string(), z.array(z.string())).default({}),
    builtInAgentModels: z.record(z.string(), z.string()).default({}),
});

// Legacy schema shape for migration detection
export interface LegacyAgentPreferences {
    lastUsedAgentId: string;
    defaultAgentAllowedTools?: string[];
}

export type AgentPreferences = z.infer<typeof AgentPreferencesSchema>;

// MCP Server config types - supports stdio and SSE transports
const StdioConfigSchema = z.object({
    type: z.literal("stdio").optional(), // Default if not specified
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()).optional(),
});

const SseConfigSchema = z.object({
    type: z.literal("sse"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
});

const HttpConfigSchema = z.object({
    type: z.literal("http"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
});

const McpConfigSchema = z.union([StdioConfigSchema, SseConfigSchema, HttpConfigSchema]);

// MCP Server definition in the app registry
export const McpServerDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    config: McpConfigSchema,
});

export type McpServerDefinition = z.infer<typeof McpServerDefinitionSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

// App-level MCP Server Registry (hardcoded, user selects from these)
// User-defined servers can be added via the MCP Servers settings page
export const MCP_REGISTRY: McpServerDefinition[] = [
    // Built-in MCP servers can be added here
    // Most servers should be user-defined via the MCP Servers settings
];

// Default agent that ships with the app
export const DEFAULT_AGENT: AgentConfig = {
    id: "default",
    name: "General Assistant",
    description: "A general-purpose coding assistant",
    systemPrompt: "", // Empty = uses SDK's default Claude Code system prompt
    model: "claude-sonnet-4-5",
    mcpServers: [], // No MCP servers enabled by default
    allowedTools: [], // No tools pre-allowed
    isDefault: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
};

// BPagent - built-in planning and project agent
export const BPAGENT_AGENT: AgentConfig = {
    id: "bpagent",
    name: "BPagent",
    description: "Planning workflows: review, goals, projects, and note organization",
    systemPrompt: "", // Set at runtime from built-in-bpagent.ts
    model: "claude-opus-4-6", // Default BP model, can be overridden in preferences
    mcpServers: [],
    allowedTools: [],
    isDefault: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
};

// Default preferences
export const DEFAULT_PREFERENCES: AgentPreferences = {
    lastUsedAgentId: "default",
    builtInAgentAllowedTools: {},
    builtInAgentModels: {},
};
