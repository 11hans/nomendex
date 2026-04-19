# Nomendex

Nomendex is a desktop application for working with notes, tasks, goals, and AI agents.

It is NOT an Electron app. It is a desktop application built with Bun and React, running inside a native macOS Swift container (`mac-app/`).

Detailed per-feature documentation lives in `docs/features/*.md`. This file is the high-level map.

## Build Commands

- `bun run dev` - Start development server with hot reload (port 1234 default)
- `bun run build` - Run full build validation (Tailwind CSS, ESLint, TypeScript checking)

**CRITICAL**: Always run `bun run build` after making changes to validate TypeScript and linting.

## Architecture Overview

### Feature Modules

All features live under `bun-sidecar/src/features/[feature]/`. Each has a dedicated doc in `docs/features/` (linked below).

**Core entities:**
- **Todos** — Tasks/events with Kanban, projects, subtasks, recurrence, priority, scheduled dates, AI draft rewriting. See `task-priority.md`, `task-recurrence.md`, `task-start-date-time-range.md`, `task-completion-timestamp.md`, `subtasks.md`, `todo-kind.md`, `todo-checklists.md`, `ai-draft-rewriting.md`, `custom-kanban.md`, `inbox.md`.
- **Notes** — Markdown notes with ProseMirror editor, wiki-links, backlinks, tags, tables, external-change detection, note renaming. See `backlinks.md`, `prosemirror-tables.md`, `note-external-change-detection.md`, `note-renaming.md`, `daily-note-improvements.md`.
- **Projects** — `ProjectConfig` entities with canonical project note, board preferences, `goalRef` to goals. See `projects-structure.md`, `custom-kanban.md`.
- **Goals** — Typed Goal Graph: first-class `GoalRecord` with typed linkage goal↔project↔todo, progress modes, mirror sync, browser+detail UI. See `typed-goal-graph.md`, `goals-workspace-v1.md`, `manual-goal-linking-ui.md`, `internal/goals-forest-vs-graph.md`.
- **Chat** — Claude chat sessions, SSE streaming, tools, permissions, message queue, extended thinking, `AskUserQuestion`. See `chat.md`, `message-queue.md`, `extended-thinking.md`, `attachments.md`.
- **Agents** — Agent configuration (model, prompt, MCP, allowed tools). Built-in agents: `default` (General Assistant) + `bpagent`. See `agents.md`, `bpagent.md`.
- **Agent Memory** — Long-term structured memory for BPagent (search/save, MCP tools, Memory Studio, post-session extraction). See `agent-memory.md`.
- **MCP Servers** — User-defined MCP registry (`stdio`/`sse`/`http` transports, env expansion).
- **Skills** — Skill discovery + versioned update management.
- **Uploads** — Images/attachments used by chat and todos.

**Cross-cutting:**
- **Git Sync** — Workspace git sync via `isomorphic-git` (setup, pull/push/commit, source-control panel, auto-sync, conflict flow). See `git-sync.md`.
- **Apple Calendar** — Two-way EventKit sync on macOS for todos with `scheduledStart`/`scheduledEnd`. See `apple-calendar-integration.md`.
- **Multi-Workspace** — Multiple isolated workspaces, switch triggers full reload. See `multi-workspace.md`.
- **Inbox** — Master-detail task triage (built on todos, not a separate entity). See `inbox.md`.

### Core Technologies
- **Runtime**: Bun (not Node.js) — use `bun` for all commands
- **Framework**: React 19 with SSR via `Bun.serve()`
- **Routing**: React Router (`react-router-dom`)
- **Styling**: Tailwind CSS + shadcn/ui + theme system
- **Type Safety**: TypeScript with Zod (infer types from schemas)
- **State Management**: React hooks with feature-specific API hooks
- **Git**: `isomorphic-git` (not the system git CLI)

## Workspace Data Storage

Each user can create one or more workspaces. A workspace is a filesystem folder containing user data.

**Global Config** (`bun-sidecar/src/storage/global-config.ts`):
- Stored at `~/Library/Application Support/com.firstloop.nomendex/config.json`
- Tracks workspace list and active workspace id

```typescript
interface GlobalConfig {
    workspaces: WorkspaceInfo[];   // id, path, name, createdAt, lastAccessedAt
    activeWorkspaceId: string | null;
}
```

**Workspace Paths** (`bun-sidecar/src/storage/root-path.ts`):
- `getRootPath()`, `getTodosPath()`, `getNotesPath()`, `getAgentsPath()`, `getSkillsPath()`, `getUploadsPath()`, `getGoalsPath()`, `getDailyNotesPath()`
- `hasActiveWorkspace()` — check before accessing paths
- Notes path is dynamic based on workspace setting:
  - `notesLocation: "root"` → notes live in workspace root
  - `notesLocation: "notes"` → notes live in `{workspace}/notes`

**Workspace Directory Structure**:

```text
/path/to/workspace/
├── todos/                         # Todo files (markdown + YAML frontmatter, FileDatabase)
├── board-configs/                 # Legacy board configs (projects now embed board)
├── uploads/                       # Images and attachments
├── agents/                        # Custom agent configs
│   └── _preferences.json          # Built-in agent prefs (lastUsedAgentId, model/tool overrides)
├── notes/                         # (if notesLocation: "notes")
│   ├── daily-notes/               # Daily notes subfolder (auto-created)
│   ├── Goals/
│   │   ├── 0-2.md                 # Generated dashboards (vision, yearly, monthly)
│   │   ├── 3. Weekly Review.md    # Agent-managed working note
│   │   └── goals/                 # Per-goal mirror notes (bidirectional sync)
│   └── Projects/                  # Project mirror notes (bidirectional sync)
├── .claude/
│   └── skills/                    # Custom skills
└── .nomendex/
    ├── workspace.json             # UI state (tabs, layout, sidebar, autoSync, memoryExtraction, chatInputEnterToSend, gitAuthMode, ...)
    ├── theme.json                 # Theme preference
    ├── secrets.json               # API keys/tokens (e.g. OPENROUTER_API_KEY, GITHUB_PAT, ANTHROPIC_API_KEY)
    ├── mcp-servers.json           # User-defined MCP servers
    ├── projects.json              # ProjectConfig entities (goalRef, board)
    ├── goals/                     # Typed GoalRecord store (FileDatabase, one .md per goal)
    ├── backlinks.json             # Notes backlinks index
    ├── tags.json                  # Notes tags index
    ├── chat-sessions.jsonl        # Chat session metadata
    └── agent-memory.jsonl         # BPagent long-term memory (FileDatabase)
```

Claude SDK message history is stored outside the workspace, under `~/.claude/projects/<workspace-path-dashed>/<sessionId>.jsonl` (path with `/` replaced by `-`).

**Key Hooks**:
- `useWorkspace.tsx` — manages UI state (tabs, theme, layout)
- `useWorkspaceSwitcher.ts` — switch/add/remove workspaces

**Workspace Routes** (`server-routes/workspaces-routes.ts`):
- `/api/workspaces` — list
- `/api/workspaces/active` — get active
- `/api/workspaces/switch` — switch (returns `requiresReload: true`; frontend calls `window.location.reload()`)
- `/api/workspaces/add`, `/remove`, `/rename`
- `/api/workspaces/open-terminal` — open Ghostty + `claude` (`?dangerous=true` appends `--dangerously-skip-permissions`)
- `/api/workspace` — GET/POST workspace state
- `/api/workspace/paths` — resolve active workspace paths
- `/api/filesystem/*` — web folder picker (list, quick-access, validate, create-folder)

Switching workspaces does a full page reload — services init at module load, so reinit in-place is avoided.

## Sidebar Navigation

Explicit core view order in `WorkspaceSidebar`:
1. Inbox
2. Goals
3. Projects
4. Todos
5. Notes

Then secondary views (`Media`, `Tags`, `Memory`), `Agents`, `Chat`, and the Quick Sync button near the Sync nav item.

## Feature Structure

Preferred pattern (guideline, not contract — newer modules may omit parts):

```text
bun-sidecar/src/features/[feature]/
├── index.ts           # Types, schemas, re-exports
├── fx.ts              # Server-side implementations (CRUD, etc.)
├── *-types.ts         # Zod schemas + inferred types (canonical source of truth)
├── plugin.ts          # Workspace plugin entrypoint (for view-registered modules)
├── view.tsx           # Main view component
├── browser-view.tsx   # Browser/list view
└── commands.tsx       # Command palette integration
```

### API Pattern

**Server-side routes** (`bun-sidecar/src/server-routes/`):
```typescript
import { getTodos } from "@/features/todos/fx";

export const todosRoutes = {
    "/api/todos/list": {
        async POST(req: Request) {
            return Response.json(await getTodos(await req.json()));
        },
    },
};
```

**Client-side API hooks** (`bun-sidecar/src/hooks/`):
```typescript
export const todosAPI = {
    getTodos: (args) => fetchAPI<Todo[]>("list", args),
};
export function useTodosAPI() { return todosAPI; }
```

Use the hook in React components; import `todosAPI` directly outside React.

## Routing

React Router routes in `bun-sidecar/src/App.tsx`:
- `/` — WorkspacePage (tabs, main workspace)
- `/settings`, `/help`
- `/agents`, `/new-agent`
- `/mcp-servers`, `/mcp-servers/new`, `/mcp-servers/:serverId/edit`
- `/sync`, `/sync/resolve`
- `/test-editor`

Most entity views (Goals, Projects, Todos, Notes, Inbox, Memory, Chat) are plugin-registered workspace tabs, not standalone routes.

## Goals — Typed Goal Graph

**Source of truth = structured data. Markdown = readable mirror.**

- `GoalRecord` store in `.nomendex/goals/` (FileDatabase, one `.md` per goal).
- Linkage:
  - `ProjectConfig.goalRef?: string` (singular).
  - `Todo.goalRefs?: string[]` (explicit) + `resolvedGoalRefs?: string[]` (computed snapshot, frozen when todo closes).
- Progress modes (discriminated union): `rollup` (avg of children, leaf-only rule), `metric` (`current/target`), `manual` (0–100), `milestone` (done children/total).
- API: `/api/goals/{list,get,create,update,delete,graph,graph/forest,sync/*,migration/*}`.
- UI: Goals browser (forest summary, attention heuristics) + Goal detail (inline editing, mode-aware progress editor).
- Mirror notes (goals + projects) use managed sections with `managedHash` conflict detection.
- BPagent skills (`/daily`, `/weekly`, `/monthly`, `/goal-tracking`) read from the API, not from markdown.

Details: `docs/features/typed-goal-graph.md`, `docs/features/goals-workspace-v1.md`.

## Claude Agent SDK Integration

Main integration files:
- `bun-sidecar/src/server-routes/chat-routes.ts`
- `bun-sidecar/src/mcp-servers/ui-renderer.ts`
- `bun-sidecar/src/mcp-servers/agent-memory.ts`

### Chat Request Flow
1. Frontend `POST /api/chat` with `{ message, images?, sessionId?, agentId?, maxThinkingTokens? }`.
2. Backend resolves agent (`model`, `systemPrompt`, `mcpServers`).
3. Backend builds MCP config (user-defined + built-in), injects internal `noetect-ui` MCP server, and (for BPagent) the `agent-memory` MCP server (read-only when extraction is enabled).
4. For BPagent: system prompt is runtime-composed: `<agent-context>` + BP template + optional memory recall block from `buildMemoryPromptBlock()`.
5. Backend calls SDK `query()`, streams SSE events to frontend.
6. Frontend consumes SSE and renders blocks incrementally, ordered by `(messageId, turn, streamIndex)`.
7. On session end, BPagent triggers async post-session memory extraction (see Agent Memory).

### Permission Model
- `canUseTool` callback gates tools.
- Pre-allowed tools (agent `allowedTools`) are auto-allowed — **except `AskUserQuestion`**, which is always interactive.
- Otherwise backend emits `permission_request` SSE event; frontend posts to `/api/chat/permission-response`.
- `Always Allow` persists to custom agent's `allowedTools` or to built-in `_preferences.json`.
- `AskUserQuestion`: UI renders option chips / multi-select + custom "Other"; response sends back via `updatedInput.answers`. Never persisted.
- Pending permissions expire after 5 minutes.

### Message Queue
Users can queue messages while a query is streaming. Queue is local to the chat tab (not persisted), supports drag-to-reorder, edit, remove; pauses on error/cancel with Resume. See `message-queue.md`.

### Extended Thinking
Per-message `maxThinkingTokens` budget — switchable without changing agent config. `undefined` = SDK default. See `extended-thinking.md`.

### Session Storage
- **Session metadata**: `{workspace}/.nomendex/chat-sessions.jsonl`
- **Claude history JSONL**: `~/.claude/projects/<workspace-path-dashed>/<sessionId>.jsonl`
- Endpoints: `/api/chat/sessions/{save,list,history/:id,update,delete,search}`.

### Cancellation
Active queries tracked by `queryTrackingId` in an `AbortController` map. Cancel via `POST /api/chat/cancel`.

## Agents & BPagent

### Agent Config
```typescript
type AgentConfig = {
    id: string;
    name: string;
    description?: string;
    systemPrompt: string;          // empty → use built-in default
    model: AgentModel;
    mcpServers: string[];
    allowedTools?: string[];
    isDefault?: boolean;
    createdAt: string;
    updatedAt: string;
};
```

Built-in agents: `default` (General Assistant), `bpagent`. Not editable (duplicate only); model + allowedTools overrides stored in `{workspace}/agents/_preferences.json`.

Effective prompt sources (shown in Agents UI):
- `custom` — custom `systemPrompt`
- `default_with_context` — Claude Code default + runtime `<agent-context>`
- `bpagent_runtime` — `<agent-context>` + BP template + optional memory block

Model catalog: `/api/agents/models` merges Anthropic `/v1/models` (if `ANTHROPIC_API_KEY` present) with a local fallback list.

### BPagent
Specialized planning agent with skills (`/daily`, `/weekly`, `/monthly`, `/goal-tracking`, `/project`, `/review`, `/adopt`), subagents (`weekly-reviewer`, `goal-aligner`, `inbox-processor`, `note-organizer`), and typed goal integration. Expects Obsidian-compatible vault structure. Details: `docs/features/bpagent.md`.

### MCP Servers
- User-defined in `{workspace}/.nomendex/mcp-servers.json`.
- Transports: `stdio` (`command`, `args`, `env`), `sse` (`url`, headers), `http` (`url`, headers).
- Env interpolation: `${SECRET_NAME}` and `${VAR_NAME:-default}` against `secrets.json` + process env.
- OAuth2 MCP auth is currently limited — prefer API keys via `secrets.json`.

## Agent Memory

Long-term structured memory for BPagent, stored in `{workspace}/.nomendex/agent-memory.jsonl`.

- Kinds: `preference`, `goal`, `project`, `decision`, `context`, `reference`.
- Scopes: `agent` (private) vs `workspace` (shared across agents/subagents).
- Dedup by fingerprint (`title + text + kind + scope`).
- Importance-based TTL cleanup (runs on init + every 24h, `.unref()`-ed):
  - `importance ≥ 0.7` → permanent
  - `0.4–0.69` → 180 days since `updatedAt`
  - `< 0.4` → 60 days
  - Explicit `expiresAt` always honored.
- Post-session extraction: fire-and-forget, provider configurable in `workspace.json → memoryExtraction.provider` (`disabled` | `openrouter` | `claude`). Read-only MCP mode when extraction is enabled.
- MCP tools: `memory_search`, `memory_save` (disabled in read-only mode), `memory_list_recent`, `memory_delete` (all auto-allowed as `mcp__agent-memory__*`).
- REST API: `/api/agent-memory/{search,save,delete,list-recent}` + `/api/agent-memory/manage/{list,get-markdown,create-markdown,save-markdown,delete,sync-vault}`.
- Memory Studio UI (`features/memory/browser-view.tsx`) — transparent human-editable layer.
- `sync-vault` returns HTTP `409 WRONG_WORKSPACE` if active workspace doesn't match `THE_VAULT_WORKSPACE_PATH`.

Access is restricted to memory-enabled agents (currently allowlist: `bpagent`). Invalid agent IDs → `403`.

Details: `docs/features/agent-memory.md`.

## Git Sync

Workspace-level git sync via `isomorphic-git`.

- Auth modes (`gitAuthMode`): `local` (SSH/credential-helper) or `pat` (`GITHUB_PAT` secret).
- Two layers: `GHSyncContext` (orchestration, setup status, auto-sync) + `/api/git/*` routes (file-level operations for Sync page).
- Auto-sync: scheduled interval + on-change (debounced 5s); pauses on merge conflict.
- Quick Sync button in sidebar (states: idle/syncing/conflict).
- Sync page has Setup mode (wizard) and Source Control mode (staged/unstaged files, inline diffs, commit box with Cmd+Enter, recent commits, merge conflict UI, settings).
- Conflict resolution: per-file ours/theirs/agent/manual, `/sync/resolve?path=...` for explicit edit; `abort-merge` / `continue-merge` endpoints.
- Commit route supports both already-staged commit and selective staging via `files`.

Routes: `/api/git/{installed,init,status,status-detailed,setup-remote,commit,pull,push,fetch-status,stage,unstage,stage-all,unstage-all,discard,file-diff,conflicts,resolve-conflict,abort-merge,continue-merge,conflict-content}`.

Details: `docs/features/git-sync.md`.

## Apple Calendar Integration (macOS)

Two-way sync between todos with scheduled dates and a dedicated "Nomendex Tasks" calendar in Apple Calendar via EventKit.

- Outgoing: `calendar-bridge.ts` → `window.webkit.messageHandlers.calendarSync` → `CalendarManager.swift` → `EKEventStore.save()/remove()`.
- Incoming: `EKEventStoreChangedNotification` → `evaluateJavaScript(window.__onCalendarChange)` → `calendar-change-bridge.ts` → `todosAPI.updateTodo`.
- Built from `scheduledStart`/`scheduledEnd`; `dueDate` is kept as deadline metadata (overdue logic stays in Nomendex).
- Priority-based alarms: `high` = 15 min, `medium` = 30 min, `low`/`none` = none.

Details: `docs/features/apple-calendar-integration.md`.

## Skills Lifecycle

- On workspace startup, app ensures `.claude/skills` exists.
- Built-in default skills auto-installed if missing.
- Versioned updates detected from skill frontmatter; exposed as pending updates.
- Endpoints: `/api/skills/pending-updates`, `/api/skills/apply-update`, `/api/skills/apply-all-updates`.

## Design System

### Theme System
```typescript
import { useTheme } from "@/hooks/useTheme";
const { currentTheme } = useTheme();
```

### Component Library
- Use shadcn/ui components from `@/components/ui/*`
- Keep animations subtle (`scale-[1.02]`, not `scale-110`)

### Keyboard Shortcuts
```tsx
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
<Button><KeyboardIndicator keys={['cmd', 'n']} /> New</Button>
```

### Application Design Principles
- Reuse existing components over creating new ones, especially dialogs and recurring UI patterns.
- Keep visual complexity down; reveal advanced actions on hover.
- Always use `useTheme` for styling.
- Prefer command-driven workflows for power-user actions.

## Critical Implementation Rules

### Type Safety
- **NEVER use `any`** — build should fail on type regressions.
- Use Zod schemas and infer types from them.
- Validate critical inputs/outputs at runtime.

### Centralized Types
- **NEVER duplicate type definitions** — import from canonical `*-types.ts`.
- Zod-derived types reduce schema drift.

### File Operations
- Prefer Bun-native APIs when practical (`Bun.file`, `Bun.write`, `Bun.serve`).
- Node `fs` / `fs/promises` is acceptable where clearer or required (`mkdir`, `chmod`, `appendFile`, `stat`, `readdir`, `unlink`).
- Use `Bun.$` for shell commands instead of extra process libraries.

### UI Development
- Do not add new props/fields without an explicit product reason.
- Keep UI minimal and discoverable.
- Use theme system over hardcoded colors.

### Build Validation
- Run `bun run build` after changes that can affect runtime behavior or type correctness.
- Build runs: Tailwind CSS + ESLint + TypeScript checks.

## macOS Styling & Keyboard Bridge

WKWebView intercepts keyboard events before JS. Bridge pattern:

1. **Swift-side**: `NSEvent.addLocalMonitorForEvents` in `mac-app/macos-host/Sources/AppDelegate.swift` captures `Cmd+Enter`, `Tab`, etc. and dispatches them via `evaluateJavaScript`.
2. **React-side**: `useNativeKeyboardBridge` registers `window.__nativeFocusNext`, `__nativeFocusPrevious`, etc.; `useNativeSubmit` handles Cmd+Enter form submit.
3. `ProseMirrorPromptContext` exposes `formRef` so multi-tab chat submits to the correct form (not global `document.querySelector("form")`).

Details: `docs/features/mac-app-keyboard-shortcuts.md`.

### Focus Indicators
For interactive buttons/triggers (especially in dialogs/popovers):

```tsx
<button className="... focus:outline-none focus:ring-2 focus:ring-offset-1">
```

### Dialog Focus Management
- Dialog close X uses `tabIndex={-1}` in `dialog.tsx`.
- Use `autoFocus` on primary initial action where appropriate.
- Show Cmd+Enter microtext for submit actions.
- Use `useNativeSubmit` for Cmd+Enter submit behavior.

## Project-Specific Rules

- Use `bun` for package management and script execution.
- For Python scripts: use `uv run script.py`.
- Do not create new documentation files unless explicitly requested.
- Keep scope tight; avoid unsolicited feature additions.
- When a feature has a dedicated doc in `docs/features/`, read it before making nontrivial changes — it documents invariants (e.g. subtasks max depth 1, events can't complete, `resolvedGoalRefs` freeze on close).
