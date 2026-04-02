# Nomendex — User Playbook

Nomendex is a native macOS desktop app for managing **notes**, **tasks**, **AI conversations**, and **agent workflows** — all in one unified workspace. Your workspace lives in a folder you choose on disk, so the files remain portable and inspectable.

---

## Quick Start

1. **Launch the app** — on first run you'll be prompted to choose a workspace folder
2. **Explore the sidebar** — switch between workspace views such as Inbox, Notes, Todos, Projects, Memory, Agents, Chat, Sync, Settings, and Help
3. **Use tabs** — keep multiple notes, tasks, and views open at once
4. **Press `⌘K`** — open the command palette for quick actions

---

## Workspaces

A workspace is a folder on your Mac that contains your notes, tasks, project data, uploads, and local app state. You can create and switch between multiple workspaces for different projects or contexts (e.g. *Work* vs *Personal*).

- **Add workspace** — choose any folder on your Mac
- **Switch** — use the workspace switcher in the sidebar footer
- **Manage** — rename or remove workspaces from the settings
- **Command palette shortcuts** — use **Switch Workspace**, **Open Claude Code**, or **Open Claude Code Dangerously**

**What's inside a workspace:**
```
my-workspace/
├── todos/                 ← Task files
├── uploads/               ← Images & attachments
├── agents/                ← Saved agent configurations
├── notes/                 ← Optional notes folder
├── .nomendex/
│   ├── workspace.json     ← UI state & workspace preferences
│   ├── secrets.json       ← Local API keys / sync secrets
│   └── agent-memory/      ← BPagent long-term memory data
└── ...                    ← Notes may also live directly in the workspace root
```

> **Note:** Nomendex supports two note-storage styles: a dedicated `notes/` folder, or the workspace root itself (useful for Obsidian-style vaults).

---

## 📝 Notes

A full-featured Markdown note editor with support for rich content.

### Key Features

| Feature | Description |
|---------|-------------|
| **Markdown editing** | Full ProseMirror-based editor with live preview |
| **Tables** | Create and edit markdown tables with keyboard navigation |
| **Wiki links** | Link notes together with `[[double brackets]]` |
| **Smart wiki-link opening** | Links without folder paths can still resolve notes in subfolders (for example daily notes) |
| **Backlinks** | See which notes link to the current note (sidebar panel) |
| **Phantom links** | Discover links to notes that don't exist yet — create them with one click |
| **File browser** | Navigate your notes tree with a tree-style browser |
| **Auto-save** | Changes are saved automatically as you type |
| **External change detection** | If another app modifies a note, Nomendex detects it and offers to reload |
| **Project tagging** | Assign notes to a project via YAML frontmatter |

### Note Sidebar

When editing a note, the right sidebar shows:
- **On This Page** — table of contents generated from headings
- **Backlinks** — notes that link to the current note
- **Phantom Links** — links pointing to not-yet-created notes

---

## ✅ Tasks (Todos)

A task management system with Kanban boards, projects, scheduling, and inline markdown checklists.

### Creating Tasks

Create tasks with a title, description, and optional metadata:
- **Project** — assign the task to an existing project
- **Priority** — 🔴 High, 🟡 Medium, 🔵 Low, or None
- **Due date & time** — set a deadline
- **Scheduled start/end** — place the work on your calendar or time buckets
- **Attachments** — add images to tasks
- **Tags** — flexible categorization
- **Checklist items** — use markdown rows like `- [ ] Follow up`

### Kanban Board

Tasks are displayed on a Kanban board. Two modes are available:

**Default Mode** — columns based on task status:
- To Do → In Progress → Done → Later

**Custom Mode** — create your own columns per project:
- Example: *Backlog → This Week → Today → Done*
- Each column can optionally auto-set a task status when items are dragged to it
- Setup via project dropdown → "Board Settings"
- Each project board can switch between **scheduled-date sorting** and **manual order**

### Task Display

Task cards show:
- Title with colored left border (priority indicator)
- Checkbox + strike-through when completed
- Project name, tags
- Description preview or checklist preview with progress
- Scheduled date/time label and overdue state when relevant

### Filtering

- Search by **title** or **description**
- Filter by **tag** using the toolbar pills
- Filter by **priority** using the priority filter
- Tasks update live based on the active search/filter state

### Completion Tracking

When a task is marked as done, the exact completion time is automatically recorded. This enables future productivity analytics and filtering by completion date.

---

## 📥 Inbox

Inbox is a **task triage workspace** rather than a flat capture list.

- **Left panel groups** — `All Tasks`, `Inbox`, and your projects
- **Right panel detail view** — search, status filters, item counts, and `+ new`
- **Status filters** — switch between `all`, `active`, `completed`, and `archived`
- **Quick capture** — tasks created from Inbox default to the `"Inbox"` project
- **Drag and drop** — move a task onto another group to reassign its project
- **Context-aware create dialog** — when you create from a specific group, the project is preselected and locked

---

## 🗓️ Apple Calendar

Tasks can sync to **Apple Calendar** through the native EventKit integration.

| Integration | Details |
|-------------|---------|
| Apple Calendar | Scheduled tasks sync into **Nomendex Tasks**; project tasks can use project-specific calendars like **Nomendex - ProjectName** |
| All-day vs timed | Date-only tasks become all-day events; tasks with times become timed events |
| Done tasks | Prefixed with ✅ in Calendar |
| Sync triggers | Task save, drag-and-drop, delete, and manual **Force Sync All to Calendar** from the command palette |
| Force sync behavior | Rebuilds Nomendex calendars from task data and preserves existing calendar colors |

> **Note:** macOS will ask for Calendar permission on first sync. You can manage this in **System Settings → Privacy & Security → Calendars**.

---

## 💬 AI Chat

Have conversations with Claude directly inside the app. Chat sessions are persistent and can be resumed at any time.

### Key Features

| Feature | Description |
|---------|-------------|
| **Streaming responses** | See Claude's response in real-time |
| **Session history** | Browse, search, and resume past conversations |
| **Image attachments** | Paste, drag-drop, or click to attach images for Claude to analyze |
| **Tool execution** | Claude can use tools with your permission |
| **Interactive agent questions** | Agents can show clickable option prompts instead of asking you to type short clarifications |
| **Message queue** | Queue follow-up messages while Claude is still responding |
| **Cancel** | Stop a response at any time |

### Message Queue

While Claude is responding, you can keep typing and queue additional messages:
- Queued messages appear above the input
- **Drag to reorder** — change the order of queued messages
- **Edit** — modify queued messages before they're sent
- **Remove** — delete individual messages from the queue
- Queue processes automatically when each response completes
- If an error occurs, the queue pauses and can be resumed

### Tool Permissions

When Claude wants to use a tool:
1. You'll see a permission prompt with the tool name and input
2. Choose **Allow** (one-time), **Deny**, or **Always Allow** (persisted per agent)
3. Pre-allowed tools execute automatically without prompting

> **Note:** `AskUserQuestion` is intentionally always interactive, so those prompts are never auto-allowed.

---

## 🤖 AI Agents

Agents are reusable configurations that customize Claude's behavior in chat sessions.

### What You Can Configure

- **Name & description** — identify the agent's purpose
- **System prompt** — custom instructions that guide Claude's behavior
- **Model** — choose the Claude model used by that agent
- **MCP servers** — enable external tool integrations (e.g. Linear)
- **Allowed tools** — pre-approve specific tools

### Built-in Agents

- **General Assistant** — the default general-purpose assistant
- **BPagent** — a planning-focused agent for goals, projects, reviews, and note organization

BPagent uses a runtime-composed prompt and can reuse long-term memory between sessions.

### Managing Agents

- Create, edit, duplicate, or delete agents from the **Agents page**
- Switch agents mid-conversation using the **agent selector** in the chat footer
- Each session remembers which agent was used

---

## 🧠 Memory

The **Memory** view is a user-facing browser for BPagent's long-term memory.

- **Search and filter** saved memories
- **Open and edit** a memory as markdown
- **Create manual memory entries** for goals, decisions, or preferences
- **Delete or sync** memories when using a compatible BPagent workspace

Memory can be scoped to a single agent or shared across the workspace, which makes it useful for durable context that should survive beyond one chat session.

---

## 🔄 Git Sync

Nomendex can sync the active workspace with a Git remote.

- **Sync page** — checks Git installation, repository setup, remote config, and auth readiness
- **Source control mode** — stage/unstage/discard files and commit selected changes directly in the app
- **Inline diffs** — preview `HEAD` vs working tree changes before staging or committing
- **Auth modes** — use local Git credentials or a GitHub PAT stored in **Settings → API Keys**
- **Auto-sync** — supports interval-based sync and sync-on-change
- **Quick Sync** — the sidebar shows a one-click sync button when the workspace is ready
- **Merge conflict flow** — sync pauses until conflicts are resolved from the Sync UI

---

## 📎 Attachments

Attach images to both **chat messages** and **tasks**.

### How to Attach

- **Paste** — `⌘V` to paste from clipboard
- **Drag & drop** — drag images into the input area
- **Button** — click the paperclip icon (📎)

### Image Viewer

Click any attached image to open it fullscreen with zoom controls and download option.

### Supported Formats

JPEG, PNG, GIF, WebP — up to 10 MB per file.

---

## 📂 Projects

Projects are the main way to organize related tasks and notes together.

### How Projects Work

- **Create projects** — use the **Projects** view to create named project entities
- **Assign to tasks** — choose an existing project when creating or editing a task
- **Assign to notes** — add `project: MyProject` in the note's YAML frontmatter
- **Project detail view** — see all tasks and notes belonging to a project in one place
- **Custom Kanban boards** — each project can have its own column configuration
- **Per-project sort mode** — switch between scheduled-date ordering and manual order

### Managing Projects

- Create, rename, archive, or delete projects from the **Projects** view
- Each project gets a canonical project note, which helps keep project context in one place
- Renaming a project updates linked tasks and project notes

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Open command palette |
| `⌘Enter` | Submit chat message / confirm dialog |
| `Tab` | Navigate to next focusable element |
| `⇧Tab` | Navigate to previous focusable element |
| `⌃Tab` | Switch to next tab |
| `⌃⇧Tab` | Switch to previous tab |

> **Tip:** Chat send behavior can be switched to `Enter` in **Settings → Preferences**.

### In Tables

| Shortcut | Action |
|----------|--------|
| `Tab` | Move to next cell |
| `⇧Tab` | Move to previous cell |
| `Enter` | Create new row (from last column) |
| `⌘⇧→` | Add column after |
| `⌘⇧←` | Add column before |
| `⌘⇧⌫` | Delete row |

---

## ⚙️ Settings

Access settings from the gear icon at the bottom of the sidebar:

- **Keyboard Shortcuts** — view and customize app shortcuts
- **Preferences** — chat-input behavior and other user preferences
- **Theme** — customize the app's appearance
- **API Keys** — store Claude, GitHub, and other secrets locally
- **Storage** — workspace and local storage information
- **About** — app metadata and version information

---

## Data & Privacy

- **Local-first** — notes, tasks, uploads, agent configs, and workspace state are stored on your Mac
- **Optional external integrations** — AI chats, MCP servers, Git sync, and Calendar can send selected data outside the app when you use them
- **Portable** — move or back up your workspace folder using any tool (Git, Dropbox, Time Machine, etc.)
- **Open format** — notes are plain Markdown, tasks use Markdown with YAML frontmatter, and workspace metadata is JSON
