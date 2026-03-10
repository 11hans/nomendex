# Nomendex
Nomendex is a desktop application for working with notes, tasks, and AI agents.

It is NOT an Electron app. It is a desktop application built with Bun and React, running inside a native macOS Swift container.

## Build Commands

- `bun run dev` - Start development server with hot reload (port 1234 default)
- `bun run build` - Run full build validation (Tailwind CSS, ESLint, TypeScript checking)

**CRITICAL**: Always run `bun run build` after making changes to validate TypeScript and linting.

## Architecture Overview

### Features
The application currently includes these core feature modules:
- **Todos** (`bun-sidecar/src/features/todos/`) - Task management with Kanban, projects, archive
- **Notes** (`bun-sidecar/src/features/notes/`) - Markdown note-taking with file browser/editor
- **Chat** (`bun-sidecar/src/features/chat/`) - Claude chat sessions, streaming, tools, permissions
- **Agents** (`bun-sidecar/src/features/agents/`) - Agent configuration (model, prompt, MCP, allowed tools)
- **MCP Servers** (`bun-sidecar/src/features/mcp-servers/`) - User-defined MCP server registry and transport config
- **Projects** (`bun-sidecar/src/features/projects/`) - Project entities and board preferences/migration
- **Skills** (`bun-sidecar/src/features/skills/`) - Skill discovery and update management
- **Uploads** (`bun-sidecar/src/features/uploads/`) - File/image uploads used by chat and other features

### Core Technologies
- **Runtime**: Bun (not Node.js) - use `bun` for all commands
- **Framework**: React 19 with server-side rendering via `Bun.serve()`
- **Routing**: React Router (`react-router-dom`)
- **Styling**: Tailwind CSS + shadcn/ui components + theme system
- **Type Safety**: TypeScript with Zod for runtime validation
- **State Management**: React hooks with feature-specific API hooks

### Workspace Data Storage
Each user can create one or more workspaces. A workspace is a filesystem folder containing user data.

**Global Config** (`bun-sidecar/src/storage/global-config.ts`):
- Stored at `~/Library/Application Support/com.firstloop.nomendex/config.json`
- Tracks all workspaces and the active workspace

```typescript
interface GlobalConfig {
    workspaces: WorkspaceInfo[];  // id, path, name, createdAt, lastAccessedAt
    activeWorkspaceId: string | null;
}
```

**Workspace Paths** (`bun-sidecar/src/storage/root-path.ts`):
- `getRootPath()`, `getTodosPath()`, `getNotesPath()`, `getAgentsPath()`, `getSkillsPath()`, `getUploadsPath()`
- `hasActiveWorkspace()` - check before accessing paths
- Notes path is dynamic based on workspace setting:
  - `notesLocation: "root"` => notes live in workspace root
  - `notesLocation: "notes"` => notes live in `{workspace}/notes`

**Workspace Directory Structure**:

```text
/path/to/workspace/
├── todos/                  # Todo files
├── board-configs/          # Board config files
├── uploads/                # Images and attachments
├── agents/                 # Agent configurations
├── .claude/
│   └── skills/             # Custom skills
└── .nomendex/
    ├── workspace.json      # Workspace UI state
    ├── theme.json          # Theme preference
    ├── secrets.json        # API keys/tokens
    ├── mcp-servers.json    # User-defined MCP servers
    ├── projects.json       # Project data
    ├── backlinks.json      # Notes backlinks index
    ├── tags.json           # Notes tags index
    └── chat-sessions.jsonl # Chat session metadata
```

**Workspace State** (`bun-sidecar/src/types/Workspace.ts`):
- Stored in `{workspace}/.nomendex/workspace.json`
- Contains tab/pane layout and app preferences (for example: tabs, activeTabId, sidebar state, layoutMode, split config, autoSync, chatInputEnterToSend)

**Key Hooks**:
- `useWorkspace.tsx` - manages workspace UI state (tabs, theme, layout)
- `useWorkspaceSwitcher.ts` - switch/add/remove workspaces

**API Routes**:
- `/api/workspaces` - List all workspaces
- `/api/workspaces/active` - Get active workspace
- `/api/workspaces/switch` - Switch workspace (triggers service reinit)
- `/api/workspaces/add` - Add workspace
- `/api/workspaces/remove` - Remove workspace
- `/api/workspaces/rename` - Rename workspace
- `/api/workspace` - GET/POST workspace state
- `/api/workspace/paths` - Resolve active workspace paths

## Feature Structure

Preferred pattern (not strict for every module):

```text
bun-sidecar/src/features/[feature]/
├── index.ts           # Feature definition, types, exports
├── fx.ts              # Server-side function implementations
├── view.tsx           # Main view component (if applicable)
├── browser-view.tsx   # Browser/list view (if applicable)
└── commands.tsx       # Command palette commands (if applicable)
```

Notes:
- Newer modules (for example `agents`, `mcp-servers`, `skills`) may not include all of `view.tsx` / `browser-view.tsx` / `commands.tsx`.
- Treat this as a design guideline, not a hard contract.

### API Pattern

#### Server-side routes (`bun-sidecar/src/server-routes/`)
```typescript
// todos-routes.ts
import { getTodos, createTodo } from "@/features/todos/fx";

export const todosRoutes = {
    "/api/todos/list": {
        async POST(req: Request) {
            const args = await req.json();
            return Response.json(await getTodos(args));
        },
    },
};
```

#### Client-side API hooks (`bun-sidecar/src/hooks/`)
```typescript
// useTodosAPI.ts
export const todosAPI = {
    getTodos: (args) => fetchAPI<Todo[]>("list", args),
    createTodo: (args) => fetchAPI<Todo>("create", args),
};

// Hook wrapper for React components
export function useTodosAPI() {
    return todosAPI;
}
```

#### Using in components
```typescript
// In React components (use hook)
const api = useTodosAPI();
const todos = await api.getTodos({});

// Outside React (use standalone API)
import { todosAPI } from "@/hooks/useTodosAPI";
const todos = await todosAPI.getTodos({});
```

## Routing

Uses React Router with routes defined in `bun-sidecar/src/App.tsx`:
- `/` - WorkspacePage (main workspace with tabs)
- `/settings` - SettingsPage
- `/help` - HelpPage
- `/agents` - AgentsPage
- `/new-agent` - NewAgentPage
- `/mcp-servers` - McpServersPage
- `/mcp-servers/new` - McpServerFormPage
- `/mcp-servers/:serverId/edit` - McpServerFormPage
- `/sync` - SyncPage
- `/sync/resolve` - ConflictResolvePage
- `/test-editor` - TestEditorPage

## Claude Agent SDK Integration

Main integration files:
- `bun-sidecar/src/server-routes/chat-routes.ts`
- `bun-sidecar/src/mcp-servers/ui-renderer.ts`

### Chat Request Flow
1. Frontend sends `POST /api/chat` with `{ message, images?, sessionId?, agentId? }`.
2. Backend resolves the active agent config (`model`, `systemPrompt`, `mcpServers`).
3. Backend builds MCP server config (user-defined + built-in), then injects internal `noetect-ui` MCP server.
4. Backend calls Claude Agent SDK `query()` and streams events as SSE back to frontend.
5. Frontend consumes SSE and renders assistant/user/tool/thinking blocks incrementally.

### Permission Model
- `canUseTool` callback gates tool execution.
- If tool is pre-allowed for the agent, it is auto-allowed.
- Otherwise backend emits `permission_request` SSE event and waits for `/api/chat/permission-response`.
- `Always Allow` persists tool name to agent `allowedTools` (or default agent preferences).

### Session Storage
- **Session metadata**: `{workspace}/.nomendex/chat-sessions.jsonl`
- **Claude history JSONL**: `~/.claude/projects/<workspace-path-dashed>/<sessionId>.jsonl`
  - Workspace path is transformed by replacing `/` with `-` (e.g. `/Users/me/workspace` -> `-Users-me-workspace`).

### Cancellation
- Active queries are tracked with `AbortController`.
- Frontend can cancel via `POST /api/chat/cancel` with `queryTrackingId`.

## Agents & MCP Servers

### Agents
Agent config includes:
- `model`
- `systemPrompt`
- `mcpServers` (array of MCP server IDs)
- `allowedTools` (persisted tool permissions)

Storage:
- Custom agents: `{workspace}/agents/<agent-id>.json`
- Default-agent tool permissions: `{workspace}/agents/_preferences.json`

### MCP Servers
- User-defined MCP servers are stored in `{workspace}/.nomendex/mcp-servers.json`.
- Supported transports:
  - `stdio` (`command`, `args`, `env`)
  - `sse` (`url`, optional headers)
  - `http` (`url`, optional headers)
- Environment interpolation supports `${SECRET_NAME}` and `${VAR_NAME:-default}`.

OAuth note:
- OAuth2 MCP auth in-client is currently limited by Claude Agent SDK capabilities.
- Prefer API keys/tokens via `{workspace}/.nomendex/secrets.json` and env expansion.

## Skills Lifecycle

- On workspace startup, app ensures `.claude/skills` exists.
- Built-in default skills are initialized via startup flow.
- Missing default skills are auto-installed.
- Versioned updates are detected from skill frontmatter and exposed as pending updates.
- Update endpoints:
  - `/api/skills/pending-updates`
  - `/api/skills/apply-update`
  - `/api/skills/apply-all-updates`

## Design System

### Theme System
```typescript
import { useTheme } from "@/hooks/useTheme";
const { currentTheme } = useTheme();
```

### Component Library
- Use shadcn/ui components from `@/components/ui/*`
- Focus on composability and reusability
- Keep animations subtle (scale-[1.02], not scale-110)

### Keyboard Shortcuts
```tsx
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
<Button><KeyboardIndicator keys={['cmd', 'n']} /> New</Button>
```

### Application Design Principles
- Reuse previously defined components over creating net new code, especially dialogs and recurring UI patterns.
- Keep visual complexity down; reveal advanced actions on hover where appropriate.
- Always use `useTheme` for styling.
- Prefer command-driven workflows for power-user actions.

## Critical Implementation Rules

### Type Safety
- **NEVER use `any` type** - build should fail on type safety regressions
- Use Zod schemas and infer types from them
- Validate critical inputs/outputs at runtime

### Centralized Types
- **NEVER duplicate type/interface definitions** - import from canonical feature type files
- Prefer `*-types.ts` as source of truth for schemas and inferred types
- Types derived from Zod schemas reduce schema drift

### File Operations
- Prefer Bun-native APIs when practical (`Bun.file`, `Bun.write`, `Bun.serve`).
- Node `fs` / `fs/promises` is acceptable where it is clearer or required (for example `mkdir`, `chmod`, `appendFile`, `stat`, `readdir`, `unlink`).
- Use `Bun.$` for shell commands instead of adding extra process libraries.

### UI Development
- Do not add new props/fields without an explicit product reason.
- Keep UI minimal and discoverable.
- Use theme system over hardcoded colors/styles.

### Build Validation
- Run `bun run build` after changes that can affect runtime behavior or type correctness.
- Build runs: Tailwind CSS build + ESLint + TypeScript checks.

## macOS Styling

### Tab Key Navigation in WKWebView
WKWebView (used by the native macOS app) does not forward some keyboard events cleanly. Current pattern:

1. **Global keyboard bridge** (`useNativeKeyboardBridge` in `bun-sidecar/src/hooks/useNativeKeyboardBridge.ts`):
   - Registers global functions (`__nativeFocusNext`, `__nativeFocusPrevious`, etc.) called by Swift
   - Handles tab focus movement and ProseMirror-specific behavior
   - Initialized at app root

2. **Cmd+Enter handling** (`useNativeSubmit`):
   - Use for dialog/form submit shortcuts when needed

### Focus Indicators
When building interactive buttons/triggers (especially in dialogs/popovers), ensure proper keyboard focus styles:

```tsx
<button className="... focus:outline-none focus:ring-2 focus:ring-offset-1">
```

### Dialog Focus Management
For dialogs with action buttons:
1. Dialog close X uses `tabIndex={-1}` in `dialog.tsx`.
2. Use `autoFocus` on primary initial action where appropriate.
3. Show Cmd+Enter microtext for submit actions when relevant.
4. Use `useNativeSubmit` for Cmd+Enter submit behavior.

### Multi-Tab Form Submission
For multiple open chat tabs:
- `ProseMirrorPromptContext` exposes `formRef`
- `ProseMirrorPromptTextarea` submits to context form ref (not global `document.querySelector("form")`)

This ensures Cmd+Enter submits in the correct tab.

## Project-Specific Rules

- Use `bun` for package management and script execution
- For Python scripts: use `uv run script.py`
- Do not create new documentation files unless explicitly requested
- Keep scope tight; avoid unsolicited feature additions
