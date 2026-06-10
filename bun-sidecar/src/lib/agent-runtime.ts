import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getRootPath } from "@/storage/root-path";
import { getAgent, getAgentAllowedTools } from "@/features/agents/fx";
import { DEFAULT_AGENT, MCP_REGISTRY } from "@/features/agents/index";
import type { AgentConfig } from "@/features/agents/index";
import { listUserMcpServers, expandEnvVars } from "@/features/mcp-servers/fx";
import { secrets } from "@/lib/secrets";
import { createServiceLogger } from "@/lib/logger";

const runtimeLogger = createServiceLogger("AGENT-RUNTIME");

// Map of MCP server IDs to their secret key names
const MCP_SERVER_SECRETS: Record<string, string> = {
    "linear": "LINEAR_OAUTH_TOKEN",
};

// Build context information for the agent's system prompt
export function buildAgentContext(workspaceFolder: string): string {
    const now = new Date();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = dayNames[now.getDay()];
    const dateStr = now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const serverPort = parseInt(process.env.PORT || "1234", 10);
    const apiBaseUrl = `http://localhost:${serverPort}`;

    return `<agent-context>
Today is ${dayOfWeek}, ${dateStr}.
You are working in the folder: ${workspaceFolder}
The Nomendex API server is running at: ${apiBaseUrl} (use this base URL for all /api/* calls — do not assume a default port).

## AskUserQuestion tool
You have access to the AskUserQuestion tool which presents the user with multiple-choice questions in a clickable UI. Use it instead of plain-text questions whenever the user needs to choose between 2-4 concrete options. This is much faster for the user than typing an answer.

When to use:
- Clarifying ambiguous instructions (e.g. "which approach?", "which file?")
- Gathering preferences or configuration choices
- Offering implementation alternatives before starting work
- Any decision point where you can enumerate the reasonable options

When NOT to use:
- Questions that require a free-form, detailed answer
- Simple yes/no confirmations (just ask in text)
- When there is only one reasonable path forward

Tips:
- Put the recommended option first and append "(Recommended)" to its label
- Use multiSelect: true only when choices are genuinely non-exclusive
- Keep option labels short (1-5 words); put detail in the description field
- The user always has an "Other" option to type a custom answer
</agent-context>`;
}

// Build MCP servers from agent config - supports stdio, sse, and http transports
// Checks user-defined servers first, then falls back to built-in registry
export async function buildMcpServersFromConfig(mcpServerIds: string[]): Promise<Record<string, McpServerConfig>> {
    runtimeLogger.info("Building MCP servers", { serverIds: mcpServerIds });
    const mcpServers: Record<string, McpServerConfig> = {};

    // Load user-defined servers
    const userServers = await listUserMcpServers();
    runtimeLogger.info("User-defined MCP servers loaded", { count: userServers.length });

    for (const serverId of mcpServerIds) {
        // First, check user-defined servers
        const userServer = userServers.find((s) => s.id === serverId);

        if (userServer) {
            // Build config from user-defined server with environment variable expansion
            const transport = userServer.transport;

            if ("type" in transport && transport.type === "sse") {
                const config: McpServerConfig = {
                    type: "sse",
                    url: await expandEnvVars(transport.url),
                };
                if (transport.headers) {
                    config.headers = {};
                    for (const [key, value] of Object.entries(transport.headers)) {
                        config.headers[key] = await expandEnvVars(value);
                    }
                }
                mcpServers[serverId] = config;
                runtimeLogger.info(`MCP server added (user-defined SSE): ${serverId}`, { url: config.url });
            } else if ("type" in transport && transport.type === "http") {
                const config: McpServerConfig = {
                    type: "http",
                    url: await expandEnvVars(transport.url),
                };
                if (transport.headers) {
                    config.headers = {};
                    for (const [key, value] of Object.entries(transport.headers)) {
                        config.headers[key] = await expandEnvVars(value);
                    }
                }
                mcpServers[serverId] = config;
                runtimeLogger.info(`MCP server added (user-defined HTTP): ${serverId}`, { url: config.url });
            } else if ("command" in transport) {
                // stdio transport
                const config: McpServerConfig = {
                    command: await expandEnvVars(transport.command),
                    args: await Promise.all(transport.args.map((arg) => expandEnvVars(arg))),
                };
                if (transport.env) {
                    config.env = {};
                    for (const [key, value] of Object.entries(transport.env)) {
                        config.env[key] = await expandEnvVars(value);
                    }
                }
                mcpServers[serverId] = config;
                runtimeLogger.info(`MCP server added (user-defined stdio): ${serverId}`, { command: config.command });
            }
            continue;
        }

        // Fall back to built-in registry
        const serverDef = MCP_REGISTRY.find((s) => s.id === serverId);
        runtimeLogger.info(`MCP server lookup in registry: ${serverId}`, { found: !!serverDef });

        if (serverDef) {
            const sourceConfig = serverDef.config;

            // Check if this server needs an OAuth token from secrets
            const secretKey = MCP_SERVER_SECRETS[serverId];
            let authToken: string | undefined;
            if (secretKey) {
                authToken = await secrets.get(secretKey);
                runtimeLogger.info(`MCP server auth: ${serverId}`, { hasToken: !!authToken });
            }

            // Handle different transport types
            if ("type" in sourceConfig && sourceConfig.type === "sse") {
                // SSE transport - no subprocess needed
                const config: McpServerConfig = {
                    type: "sse",
                    url: sourceConfig.url,
                };
                // Merge headers from config and add auth token if available
                const headers: Record<string, string> = { ...sourceConfig.headers };
                if (authToken) {
                    headers["Authorization"] = `Bearer ${authToken}`;
                }
                if (Object.keys(headers).length > 0) {
                    config.headers = headers;
                }
                mcpServers[serverId] = config;
                runtimeLogger.info(`MCP server added (registry SSE): ${serverId}`, { url: sourceConfig.url, hasAuth: !!authToken });
            } else if ("type" in sourceConfig && sourceConfig.type === "http") {
                // HTTP transport
                const config: McpServerConfig = {
                    type: "http",
                    url: sourceConfig.url,
                };
                const headers: Record<string, string> = { ...sourceConfig.headers };
                if (authToken) {
                    headers["Authorization"] = `Bearer ${authToken}`;
                }
                if (Object.keys(headers).length > 0) {
                    config.headers = headers;
                }
                mcpServers[serverId] = config;
                runtimeLogger.info(`MCP server added (registry HTTP): ${serverId}`, { url: sourceConfig.url, hasAuth: !!authToken });
            } else if ("command" in sourceConfig) {
                // stdio transport (default)
                const config: McpServerConfig = {
                    command: sourceConfig.command,
                    args: sourceConfig.args,
                };
                if (sourceConfig.env) {
                    config.env = sourceConfig.env;
                }
                mcpServers[serverId] = config;
                runtimeLogger.info(`MCP server added (registry stdio): ${serverId}`, { command: sourceConfig.command });
            }
        }
    }

    runtimeLogger.info("Final MCP servers config", { mcpServers });
    return mcpServers;
}

type ToolPolicy = "deny-unapproved" | "allow-unapproved";

export type RunAgentTextQueryInput = {
    prompt: string;
    agentId: string;
    maxTurns?: number;
    toolPolicy?: ToolPolicy;
    unapprovedToolMessage?: string;
    onStderr?: (data: string) => void;
    cwd?: string;
    systemPromptOverride?: string;
};

function collectAssistantText(msg: unknown): string {
    if (!msg || typeof msg !== "object") return "";
    const assistant = msg as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
    if (assistant.type !== "assistant") return "";
    const content = assistant.message?.content;
    if (!Array.isArray(content)) return "";
    return content
        .filter((block) => block.type === "text")
        .map((block) => block.text || "")
        .join("\n")
        .trim();
}

/**
 * Headless single-text agent query for non-interactive callers (e.g. the
 * channels gateway auto-reply). No streaming, no permission prompts: tools are
 * either pre-approved on the agent or denied. AskUserQuestion is always denied
 * because there is no UI to answer it.
 */
export async function runAgentTextQuery(input: RunAgentTextQueryInput): Promise<{ text: string; agentConfig: AgentConfig }> {
    const agentConfig = (await getAgent({ agentId: input.agentId })) || DEFAULT_AGENT;

    const allowedTools = new Set(await getAgentAllowedTools({ agentId: agentConfig.id }));
    const mcpServers = await buildMcpServersFromConfig(agentConfig.mcpServers);
    const cwd = input.cwd || getRootPath();
    const claudeCliPath = process.env.CLAUDE_CLI_PATH || `${process.env.HOME}/.local/bin/claude`;
    const toolPolicy = input.toolPolicy || "deny-unapproved";
    const systemPrompt = input.systemPromptOverride || (
        agentConfig.systemPrompt
            ? `${buildAgentContext(cwd)}\n\n${agentConfig.systemPrompt}`
            : buildAgentContext(cwd)
    );

    const canUseTool = async (
        toolName: string,
        toolInput: Record<string, unknown>,
    ) => {
        if (toolName === "AskUserQuestion") {
            return {
                behavior: "deny" as const,
                message: "AskUserQuestion is not available in headless agent queries",
            };
        }
        if (allowedTools.has(toolName) || toolPolicy === "allow-unapproved") {
            return { behavior: "allow" as const, updatedInput: toolInput };
        }
        return {
            behavior: "deny" as const,
            message: input.unapprovedToolMessage || "Tool not pre-approved for this channel",
        };
    };

    const options = {
        model: agentConfig.model,
        systemPrompt,
        cwd,
        mcpServers,
        pathToClaudeCodeExecutable: claudeCliPath,
        settingSources: ["project"] as Array<"user" | "project">,
        canUseTool,
        includePartialMessages: false,
        maxTurns: input.maxTurns ?? 4,
        env: {
            ...process.env,
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? "8000",
        },
        stderr: (data: string) => {
            input.onStderr?.(data);
        },
    };

    let responseText = "";
    const stream = query({
        prompt: input.prompt,
        options,
    });

    for await (const message of stream) {
        const text = collectAssistantText(message);
        if (text) {
            responseText = text;
        }
    }

    return {
        text: responseText.trim(),
        agentConfig,
    };
}
