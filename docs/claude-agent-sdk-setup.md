# Claude Agent SDK Setup & API Key Configuration

## Overview

Nomendex uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to power chat, agents, and AI-driven features. The SDK communicates with Anthropic's API using an `ANTHROPIC_API_KEY` stored in the workspace secrets.

## Architecture

### Startup Flow

1. **App initialization** → `initializeWorkspaceServices()` (workspace-init.ts)
2. **Load secrets** → `secrets.loadIntoProcessEnv()` reads `{workspace}/.nomendex/secrets.json`
3. **Hydrate env** → All secret values (including `ANTHROPIC_API_KEY`) are set on `process.env`
4. **SDK ready** → Chat routes can access `ANTHROPIC_API_KEY` when calling `query()`

### Chat Request Flow

```
Frontend (chat message) 
  ↓ POST /api/chat
  ↓
Backend (chat-routes.ts)
  ├─ Load agent config (model, systemPrompt, mcpServers)
  ├─ Build MCP server config
  ├─ Call query() from Claude Agent SDK
  │  └─ SDK uses ANTHROPIC_API_KEY from process.env
  │  └─ Communicates with Anthropic API
  ├─ Stream SSE events back to frontend
  └─ Save session history to ~/.claude/projects/{workspace}/
```

## API Key Setup

### Quick Start

1. Navigate to **Settings → API Keys → Custom API Keys**
2. Click **Add Key**
3. **Key Name**: `ANTHROPIC_API_KEY`
4. **Value**: Your API key from your Claude subscription (starts with `sk-ant-`)
5. Save

### Where It's Stored

**Workspace-specific**: `{workspace}/.nomendex/secrets.json`
- File is gitignored (safe to commit workspace folder)
- Encrypted at rest on macOS Keychain (optional future enhancement)
- Loaded into `process.env` on startup

Example:
```json
{
  "_comment": "Add your API keys here. This file is gitignored.",
  "ANTHROPIC_API_KEY": "sk-ant-xxxxx...",
  "CUSTOM_API_KEY": "value"
}
```

## System API Keys vs Custom API Keys

### System API Keys (Predefined)

Hardcoded list in `secrets-routes.ts`:

| Key | Purpose | Setup |
|-----|---------|-------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Agent SDK auth | `claude setup-token` |
| `GITHUB_PAT` | Git sync operations | GitHub Settings → Tokens |

### Custom API Keys

User-defined keys for:
- Additional Claude API keys (e.g., for different models/tiers)
- MCP server integrations (referenced as `${KEY_NAME}` in MCP config)
- Third-party services (OpenAI, OpenRouter, etc.)

## Implementation Details

### Backend Routes

**File**: `bun-sidecar/src/server-routes/secrets-routes.ts`

```typescript
GET /api/secrets/list
  // Returns: predefined + custom secrets with masking
  // Response: { secrets: SecretInfo[] }

POST /api/secrets/set
  // Body: { key: string, value: string }
  // Validates key format: [A-Z][A-Z0-9_]*
  // Updates process.env immediately

POST /api/secrets/delete
  // Body: { key: string }
  // Removes from secrets.json and process.env
```

### Frontend UI

**File**: `bun-sidecar/src/pages/SettingsPage.tsx`

- Tabs: Settings, Shortcuts, API Keys
- API Keys tab sections:
  - System API Keys (predefined, with help text)
  - Custom API Keys (user-defined, add/edit/delete)
- Secret masking: Shows first 12 chars + dots
- Eye icon toggle to show/hide values

### Secrets Manager

**File**: `bun-sidecar/src/lib/secrets.ts`

```typescript
secrets.load()           // Read from secrets.json
secrets.get(key)         // Get with fallback to process.env
secrets.mustGet(key)     // Throw if missing
secrets.loadIntoProcessEnv()  // Hydrate process.env
```

## Using Secrets in MCP Servers

Custom API keys are interpolated in MCP server configs using `${KEY_NAME}` syntax.

Example MCP server config (`{workspace}/.nomendex/mcp-servers.json`):

```json
{
  "id": "my-service",
  "name": "My Service",
  "transport": {
    "type": "http",
    "url": "https://api.example.com",
    "headers": {
      "Authorization": "Bearer ${CUSTOM_API_KEY}"
    }
  }
}
```

On chat request:
1. `buildMcpServersFromConfig()` loads the MCP server definition
2. `expandEnvVars()` replaces `${CUSTOM_API_KEY}` with the actual value from secrets
3. MCP server config is passed to Claude Agent SDK

## Error Handling

### Missing ANTHROPIC_API_KEY

Error response in `/api/chat`:
```json
{
  "error": "Failed to process chat message",
  "env": {
    "hasOAuthToken": false,
    "hasApiKey": false  // ← ANTHROPIC_API_KEY not set
  }
}
```

### Failed Secret Load

- Non-fatal: If secrets.json doesn't exist, an empty secrets map is used
- Warning logged: "Failed to load secrets"
- Graceful fallback: Existing process.env values are preserved

## Security Considerations

- ✅ Secrets not logged (masked in UI)
- ✅ Secrets file gitignored
- ✅ Per-workspace isolation (different workspaces = different secrets)
- ✅ Immediate process.env updates (no server restart needed)
- ⚠️ Not encrypted on disk (OS-level permissions apply)
- ⚠️ Visible in memory while running

Future enhancements:
- Encrypt secrets.json with workspace key
- Store in macOS Keychain
- Support for environment-specific secrets

## Key Files Reference

| File | Purpose |
|------|---------|
| `server-routes/chat-routes.ts` | Main chat API, uses SDK query() |
| `server-routes/secrets-routes.ts` | Backend API for secret management |
| `lib/secrets.ts` | SecretsManager class |
| `services/workspace-init.ts` | Loads secrets on startup |
| `pages/SettingsPage.tsx` | UI for API key management |

## Testing

To verify ANTHROPIC_API_KEY is loaded:

1. Open browser DevTools → Network
2. Send a chat message
3. Check POST /api/chat response headers:
   ```json
   {
     "env": {
       "hasOAuthToken": true,
       "hasApiKey": true  // ← Should be true
     }
   }
   ```

Alternatively, check server logs:
```
[API] SDK options: { model: 'claude-3-5-sonnet-20241022', ... }
[API] Calling query()...
```

If query() fails, check the error response for API key issues.
