# Multi-Agent Configuration

This feature allows users to create and manage multiple AI agent configurations, each with custom system prompts, model selection, and MCP server integrations.

## Overview

Agents are reusable configurations that define how Claude behaves in chat sessions. Each agent can have:
- **Custom system prompt** - Instructions that guide Claude's behavior
- **Model selection** - Model catalog from Anthropic API (with local fallback list)
- **MCP servers** - Enable specific MCP integrations (e.g., Linear)

## Storage

Agent configurations are stored in `{workspace}/agents/`:

```
{workspace}/agents/
├── agent-1234567890-abc123.json    # User-created agents
├── agent-9876543210-xyz789.json
└── _preferences.json                # Stores last used agent ID
```

Built-in agents ("General Assistant" and "BPagent") are not stored on disk - they are defined in code.

### Agent Config Schema

```typescript
type AgentConfig = {
    id: string;                    // UUID or "default"
    name: string;                  // Display name
    description?: string;          // Optional description
    systemPrompt: string;          // Custom system prompt (empty = SDK default)
    model: AgentModel;             // Model to use
    mcpServers: string[];          // Array of MCP server IDs
    allowedTools?: string[];       // Tools that are always allowed (persisted permissions)
    isDefault?: boolean;           // True only for built-in default
    createdAt: string;             // ISO timestamp
    updatedAt: string;             // ISO timestamp
}

type AgentModel =
    | "claude-sonnet-4-6"
    | "claude-sonnet-4-5"
    | "claude-opus-4-6"
    | "claude-opus-4-1"
    | "claude-haiku-4-5"
    | "claude-3-5-haiku-20241022";
```

Note: legacy dated model IDs are normalized to canonical IDs in the picker to avoid duplicate entries.

### Preferences

```typescript
type AgentPreferences = {
    lastUsedAgentId: string;                               // Defaults to "default"
    builtInAgentAllowedTools?: Record<string, string[]>;  // Allowed tools for built-in agents
    builtInAgentModels?: Record<string, string>;          // Model overrides for built-in agents
}
```

Note: Built-in agents' allowed tools are stored in preferences since built-in agents are not persisted to disk.

## MCP Server Registry

The app maintains a hardcoded registry of available MCP servers. Users can enable/disable these per agent, but cannot add custom servers (for now).

Current registry:
- **Linear** - Project management via `https://mcp.linear.app/mcp`

Registry is defined in `src/features/agents/index.ts`:

```typescript
export const MCP_REGISTRY: McpServerDefinition[] = [
    {
        id: "linear",
        name: "Linear",
        description: "Linear project management - issues, projects, teams",
        config: {
            command: "npx",
            args: ["-y", "mcp-remote", "https://mcp.linear.app/mcp"],
        },
    },
];
```

## Built-in Agents

Built-in agents ship with the app. They cannot be edited or deleted (duplicate-only in UI).

```typescript
{
    id: "default",
    name: "General Assistant",
    description: "A general-purpose coding assistant",
    systemPrompt: "",  // Uses Claude Code default prompt + runtime <agent-context>
    model: "claude-sonnet-4-5",
    mcpServers: [],
    allowedTools: [],
    isDefault: true,
}

{
    id: "bpagent",
    name: "BPagent",
    description: "Planning workflows: review, goals, projects, and note organization",
    systemPrompt: "",  // Runtime-composed by backend
    model: "claude-opus-4-6",  // Default model (can be changed from Agents page)
    mcpServers: [],
    allowedTools: [],
}
```

## Effective Prompt Source

The Agents UI shows an explicit source for each agent's effective prompt:

- `custom`: Uses the custom `systemPrompt` saved on the agent profile
- `default_with_context`: Uses Claude Code default prompt plus runtime `<agent-context>` (date + workspace folder)
- `bpagent_runtime`: Runtime-composed BPagent prompt:
  - `<agent-context>` using notes path
  - BPagent template from `built-in-bpagent.ts`
  - Optional memory recall block

## Permissions System

Each agent maintains its own list of allowed tools. When a user clicks "Always Allow" for a tool permission request, that tool is persisted to the agent's `allowedTools` array.

### How It Works

1. **Permission Request**: When Claude wants to use a tool, the `canUseTool` callback is invoked
2. **Auto-Allow Check**: If the tool is in the agent's `allowedTools`, it's automatically allowed without prompting
3. **User Prompt**: If not auto-allowed, the user sees a permission prompt (Allow / Deny / Always Allow)
4. **Persistence**: If "Always Allow" is clicked:
   - For custom agents: Tool is added to `allowedTools` in the agent's JSON file
   - For built-in agents: Tool is added to `builtInAgentAllowedTools[agentId]` in `_preferences.json`
5. **Session Cache**: Allowed tools are also cached in memory for the current session to avoid re-reading from disk

### Storage

- **Custom agents**: `{workspace}/agents/{agent-id}.json` → `allowedTools` array
- **Built-in agents**: `{workspace}/agents/_preferences.json` → `builtInAgentAllowedTools` and `builtInAgentModels`

### Example Permission Flow

```
User sends message → Agent "Work Assistant" is active
↓
Claude wants to use "mcp__linear__list_issues"
↓
Check: Is "mcp__linear__list_issues" in agent's allowedTools?
↓
NO → Show permission prompt to user
↓
User clicks "Always Allow"
↓
Tool added to agent's allowedTools and persisted to disk
↓
Next time: Tool auto-allowed without prompt
```

## Session-Agent Relationship

Sessions remember which agent was used:

1. **New session**: Uses `lastUsedAgentId` from preferences
2. **Existing session**: Uses the `agentId` stored in session metadata
3. **Switching agents mid-session**: Updates session's agent for subsequent messages

Session metadata includes:
```typescript
type SessionMetadata = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    agentId?: string;  // Which agent config was used
}
```

## API Endpoints

### Agents CRUD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/list` | GET | List all agents (default first) |
| `/api/agents/get` | POST | Get single agent by ID |
| `/api/agents/create` | POST | Create new agent |
| `/api/agents/update` | POST | Update existing agent |
| `/api/agents/delete` | POST | Delete agent (not built-in) |
| `/api/agents/duplicate` | POST | Clone an agent |
| `/api/agents/models` | GET | List available model IDs (Anthropic API + fallback) |

### Preferences

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/preferences` | GET | Get preferences |
| `/api/agents/preferences` | POST | Update preferences |

### MCP Registry

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mcp-registry` | GET | List available MCP servers |

## UI Components

### Agents Page (`/agents`)

Full settings page for managing agents:
- List all agents with prompt source preview and actions
- Built-in agents: duplicate only
- User agents: edit, delete, duplicate
- BPagent: inline model switcher (saved as built-in model override)
- Create new agents via dialog
- Configure name, description, model, system prompt, MCP servers

### Agent Selector (Chat Footer)

Dropdown in chat input area:
- Shows current agent name
- Switch agents (applies to current session)
- Quick link to agents settings page

## Chat Integration

When sending a message, the chat route:

1. Determines agent ID:
   - Use `agentId` from request if provided
   - Else use session's stored `agentId` (for existing sessions)
   - Else use `lastUsedAgentId` from preferences

2. Loads agent config and applies:
   - `model` - Which Claude model to use
   - `systemPrompt` behavior:
     - Custom agents with prompt: `<agent-context> + custom prompt`
     - General Assistant: Claude Code default prompt + `<agent-context>`
     - BPagent: runtime-composed BPagent prompt (context + BP template + optional memory block)
   - `mcpServers` - Builds MCP config from registry

Model catalog behavior:
- If `ANTHROPIC_API_KEY` is available, `/api/agents/models` fetches `/v1/models` from Anthropic and merges with fallback curated IDs.
- If key is missing or request fails, UI uses the local fallback model list from `features/agents/index.ts`.

3. Updates `lastUsedAgentId` preference

4. Returns `agentId` in SSE response for frontend to track

## File Structure

```
src/
├── features/agents/
│   ├── index.ts              # Types, schemas, constants
│   ├── fx.ts                 # CRUD operations
│   └── agent-selector.tsx    # Dropdown component
├── server-routes/
│   └── agents-routes.ts      # API endpoints
├── hooks/
│   └── useAgentsAPI.ts       # Frontend API hook
├── pages/
│   └── AgentsPage.tsx        # Settings page
└── storage/
    └── root-path.ts          # Includes agentsPath
```

## Adding New MCP Servers

To add a new MCP server to the registry:

1. Edit `src/features/agents/index.ts`
2. Add entry to `MCP_REGISTRY`:

```typescript
{
    id: "my-server",
    name: "My Server",
    description: "Description of what this server does",
    config: {
        command: "npx",
        args: ["-y", "my-mcp-package"],
        env: {  // Optional
            "API_KEY": "..."
        }
    },
}
```

3. Users can now enable this server in their agent configs
