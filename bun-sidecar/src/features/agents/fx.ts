import { createServiceLogger } from "@/lib/logger";
import { getAgentsPath, hasActiveWorkspace } from "@/storage/root-path";
import { mkdir } from "node:fs/promises";
import path from "path";
import {
    type AgentConfig,
    AgentConfigSchema,
    type AgentPreferences,
    type LegacyAgentPreferences,
    AgentPreferencesSchema,
    DEFAULT_AGENT,
    DEFAULT_PREFERENCES,
    BPAGENT_AGENT,
    MCP_REGISTRY,
    type McpServerDefinition,
    isBuiltInAgentId,
} from "./index";

// Create logger for agents feature
const agentsLogger = createServiceLogger("AGENTS");

// Get preferences file path dynamically
function getPreferencesFile(): string {
    return path.join(getAgentsPath(), "_preferences.json");
}

// Ensure agents directory exists
async function ensureAgentsDir(): Promise<void> {
    if (!hasActiveWorkspace()) {
        throw new Error("No active workspace");
    }
    await mkdir(getAgentsPath(), { recursive: true });
}

// Get file path for an agent
function getAgentFilePath(id: string): string {
    const sanitizedId = id.replace(/[^a-zA-Z0-9-_]/g, "-");
    return path.join(getAgentsPath(), `${sanitizedId}.json`);
}

// Read preferences (with lazy migration from legacy schema)
async function getPreferences(): Promise<AgentPreferences> {
    try {
        await ensureAgentsDir();
        const file = Bun.file(getPreferencesFile());
        if (await file.exists()) {
            const raw = await file.json() as Record<string, unknown>;

            // Lazy migration: detect legacy defaultAgentAllowedTools field
            if ("defaultAgentAllowedTools" in raw) {
                const legacy = raw as unknown as LegacyAgentPreferences;
                const migrated: AgentPreferences = {
                    lastUsedAgentId: legacy.lastUsedAgentId,
                    builtInAgentAllowedTools: {
                        default: legacy.defaultAgentAllowedTools || [],
                    },
                    builtInAgentModels: {},
                };
                agentsLogger.info("Migrating legacy defaultAgentAllowedTools to builtInAgentAllowedTools");
                await savePreferences(migrated);
                return migrated;
            }

            const result = AgentPreferencesSchema.safeParse(raw);
            if (result.success) {
                return result.data;
            }
            agentsLogger.warn("Invalid preferences, returning defaults", { issues: result.error.issues });
            return DEFAULT_PREFERENCES;
        }
        return DEFAULT_PREFERENCES;
    } catch (error) {
        agentsLogger.error("Failed to read preferences", { error });
        return DEFAULT_PREFERENCES;
    }
}

function applyBuiltInAgentModelOverride(agent: AgentConfig, preferences: AgentPreferences): AgentConfig {
    const modelOverride = preferences.builtInAgentModels[agent.id];
    if (!modelOverride) return agent;
    return {
        ...agent,
        model: modelOverride,
    };
}

// Save preferences
async function savePreferences(preferences: AgentPreferences): Promise<void> {
    try {
        await ensureAgentsDir();
        await Bun.write(getPreferencesFile(), JSON.stringify(preferences, null, 2));
    } catch (error) {
        agentsLogger.error("Failed to save preferences", { error });
        throw error;
    }
}

// Get a single agent by ID
async function getAgent(input: { agentId: string }): Promise<AgentConfig | null> {
    agentsLogger.info(`Getting agent: ${input.agentId}`);

    // Return built-in agents if requested
    if (isBuiltInAgentId(input.agentId)) {
        const preferences = await getPreferences();
        const builtIn = input.agentId === "bpagent" ? BPAGENT_AGENT : DEFAULT_AGENT;
        return applyBuiltInAgentModelOverride(builtIn, preferences);
    }

    try {
        await ensureAgentsDir();
        const filePath = getAgentFilePath(input.agentId);
        const file = Bun.file(filePath);

        if (!(await file.exists())) {
            agentsLogger.warn(`Agent not found: ${input.agentId}`);
            return null;
        }

        const rawAgent = await file.json();
        const parseResult = AgentConfigSchema.safeParse(rawAgent);

        if (parseResult.success) {
            return parseResult.data;
        }

        agentsLogger.error(`Invalid agent file for ${input.agentId}`, {
            issues: parseResult.error.issues
        });
        return null;
    } catch (error) {
        agentsLogger.error(`Failed to get agent ${input.agentId}`, { error });
        return null;
    }
}

// List all agents (including default)
async function listAgents(): Promise<AgentConfig[]> {
    agentsLogger.info("Listing all agents");

    try {
        await ensureAgentsDir();
        const preferences = await getPreferences();
        const agents: AgentConfig[] = [
            applyBuiltInAgentModelOverride(DEFAULT_AGENT, preferences),
            applyBuiltInAgentModelOverride(BPAGENT_AGENT, preferences),
        ];

        // Read all JSON files in agents directory except _preferences.json
        const { readdir } = await import("node:fs/promises");
        const files = await readdir(getAgentsPath());

        for (const fileName of files) {
            if (!fileName.endsWith(".json") || fileName.startsWith("_")) continue;

            const filePath = path.join(getAgentsPath(), fileName);
            try {
                const file = Bun.file(filePath);
                const rawAgent = await file.json();
                const parseResult = AgentConfigSchema.safeParse(rawAgent);

                if (parseResult.success) {
                    agents.push(parseResult.data);
                } else {
                    agentsLogger.error(`Invalid agent file ${fileName}`, {
                        issues: parseResult.error.issues
                    });
                }
            } catch (error) {
                agentsLogger.error(`Error reading agent file ${fileName}`, { error });
            }
        }

        // Sort: default first, then bpagent, then user agents by name
        agents.sort((a, b) => {
            if (a.id === "default") return -1;
            if (b.id === "default") return 1;
            if (a.id === "bpagent") return -1;
            if (b.id === "bpagent") return 1;
            return a.name.localeCompare(b.name);
        });

        agentsLogger.info(`Found ${agents.length} agents`);
        return agents;
    } catch (error) {
        agentsLogger.error("Failed to list agents", { error });
        return [DEFAULT_AGENT, BPAGENT_AGENT];
    }
}

// Create a new agent
async function createAgent(input: {
    name: string;
    description?: string;
    systemPrompt: string;
    model: AgentConfig["model"];
    mcpServers: string[];
}): Promise<AgentConfig> {
    agentsLogger.info(`Creating agent: ${input.name}`);

    try {
        await ensureAgentsDir();

        const now = new Date().toISOString();
        const agent: AgentConfig = {
            id: `agent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name: input.name,
            description: input.description,
            systemPrompt: input.systemPrompt,
            model: input.model,
            mcpServers: input.mcpServers,
            allowedTools: [],
            createdAt: now,
            updatedAt: now,
        };

        const filePath = getAgentFilePath(agent.id);
        await Bun.write(filePath, JSON.stringify(agent, null, 2));

        agentsLogger.info(`Created agent: ${agent.id}`);
        return agent;
    } catch (error) {
        agentsLogger.error("Failed to create agent", { error });
        throw error;
    }
}

// Update an existing agent
async function updateAgent(input: {
    agentId: string;
    updates: {
        name?: string;
        description?: string;
        systemPrompt?: string;
        model?: AgentConfig["model"];
        mcpServers?: string[];
        allowedTools?: string[];
    };
}): Promise<AgentConfig | null> {
    agentsLogger.info(`Updating agent: ${input.agentId}`);

    // Built-in agents only support model override updates.
    if (isBuiltInAgentId(input.agentId)) {
        const unsupportedField = Object.entries(input.updates).some(
            ([key, value]) => key !== "model" && value !== undefined
        );
        if (unsupportedField || !input.updates.model) {
            agentsLogger.warn(`Unsupported built-in update payload for ${input.agentId}`);
            return getAgent({ agentId: input.agentId });
        }

        const prefs = await getPreferences();
        await savePreferences({
            ...prefs,
            builtInAgentModels: {
                ...prefs.builtInAgentModels,
                [input.agentId]: input.updates.model,
            },
        });
        agentsLogger.info(`Updated built-in model override for ${input.agentId}`, {
            model: input.updates.model,
        });
        return getAgent({ agentId: input.agentId });
    }

    try {
        const existing = await getAgent({ agentId: input.agentId });
        if (!existing) {
            agentsLogger.warn(`Agent not found for update: ${input.agentId}`);
            return null;
        }

        const updated: AgentConfig = {
            ...existing,
            ...input.updates,
            id: input.agentId, // Ensure ID doesn't change
            updatedAt: new Date().toISOString(),
        };

        const filePath = getAgentFilePath(input.agentId);
        await Bun.write(filePath, JSON.stringify(updated, null, 2));

        agentsLogger.info(`Updated agent: ${input.agentId}`);
        return updated;
    } catch (error) {
        agentsLogger.error(`Failed to update agent ${input.agentId}`, { error });
        throw error;
    }
}

// Delete an agent
async function deleteAgent(input: { agentId: string }): Promise<{ success: boolean }> {
    agentsLogger.info(`Deleting agent: ${input.agentId}`);

    // Cannot delete built-in agents
    if (isBuiltInAgentId(input.agentId)) {
        agentsLogger.warn(`Cannot delete built-in agent: ${input.agentId}`);
        return { success: false };
    }

    try {
        const filePath = getAgentFilePath(input.agentId);
        const { unlink } = await import("node:fs/promises");

        await unlink(filePath);
        agentsLogger.info(`Deleted agent: ${input.agentId}`);

        // If deleted agent was the last used, reset to default
        const prefs = await getPreferences();
        if (prefs.lastUsedAgentId === input.agentId) {
            await savePreferences({ ...prefs, lastUsedAgentId: "default" });
        }

        return { success: true };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { success: false };
        }
        agentsLogger.error(`Failed to delete agent ${input.agentId}`, { error });
        throw error;
    }
}

// Duplicate an agent
async function duplicateAgent(input: { agentId: string }): Promise<AgentConfig> {
    agentsLogger.info(`Duplicating agent: ${input.agentId}`);

    const source = await getAgent({ agentId: input.agentId });
    if (!source) {
        throw new Error(`Agent not found: ${input.agentId}`);
    }

    return createAgent({
        name: `${source.name} (Copy)`,
        description: source.description,
        systemPrompt: source.systemPrompt,
        model: source.model,
        mcpServers: [...source.mcpServers],
    });
}

// Get MCP registry (app-defined servers)
function getMcpRegistry(): McpServerDefinition[] {
    return MCP_REGISTRY;
}

// Add an allowed tool to an agent's configuration
async function addAllowedTool(input: { agentId: string; toolName: string }): Promise<boolean> {
    agentsLogger.info(`Adding allowed tool ${input.toolName} to agent ${input.agentId}`);

    try {
        if (isBuiltInAgentId(input.agentId)) {
            // For built-in agents, store in preferences under builtInAgentAllowedTools
            const prefs = await getPreferences();
            const currentTools = prefs.builtInAgentAllowedTools[input.agentId] || [];

            if (!currentTools.includes(input.toolName)) {
                await savePreferences({
                    ...prefs,
                    builtInAgentAllowedTools: {
                        ...prefs.builtInAgentAllowedTools,
                        [input.agentId]: [...currentTools, input.toolName],
                    },
                });
                agentsLogger.info(`Added ${input.toolName} to ${input.agentId}'s allowed tools`);
            }
            return true;
        }

        // For custom agents, update the agent config
        const agent = await getAgent({ agentId: input.agentId });
        if (!agent) {
            agentsLogger.warn(`Agent not found: ${input.agentId}`);
            return false;
        }

        const currentTools = agent.allowedTools || [];
        if (!currentTools.includes(input.toolName)) {
            await updateAgent({
                agentId: input.agentId,
                updates: {
                    allowedTools: [...currentTools, input.toolName],
                },
            });
            agentsLogger.info(`Added ${input.toolName} to agent ${input.agentId}'s allowed tools`);
        }
        return true;
    } catch (error) {
        agentsLogger.error(`Failed to add allowed tool ${input.toolName} to agent ${input.agentId}`, { error });
        return false;
    }
}

// Get allowed tools for an agent (handles built-in agents via preferences)
async function getAgentAllowedTools(input: { agentId: string }): Promise<string[]> {
    if (isBuiltInAgentId(input.agentId)) {
        const prefs = await getPreferences();
        return prefs.builtInAgentAllowedTools[input.agentId] || [];
    }

    const agent = await getAgent({ agentId: input.agentId });
    return agent?.allowedTools || [];
}

// Export functions
export {
    getAgent,
    listAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    duplicateAgent,
    getPreferences,
    savePreferences,
    getMcpRegistry,
    addAllowedTool,
    getAgentAllowedTools,
};
