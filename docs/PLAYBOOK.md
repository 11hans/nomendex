# Nomendex — User Playbook

Nomendex is a native macOS desktop app for managing **notes**, **tasks**, and **AI conversations** — all in one unified workspace. Your data lives locally on disk in a folder you choose, giving you full ownership and portability.

---

## Quick Start

1. **Launch the app** — on first run you'll be prompted to choose a workspace folder
2. **Explore the sidebar** — switch between Notes, Todos, and Chat
3. **Use tabs** — open multiple items side by side, just like a browser
4. **Press `⌘K`** — open the command palette for quick actions

---

## Workspaces

A workspace is a folder on your Mac that contains all your data — notes, tasks, agents, and uploads. You can create and switch between multiple workspaces for different projects or contexts (e.g. *Work* vs *Personal*).

- **Add workspace** — choose any folder on your Mac
- **Switch** — use the workspace switcher in the sidebar footer
- **Manage** — rename or remove workspaces from the settings

**What's inside a workspace:**
```
my-workspace/
├── notes/        ← Markdown notes
├── todos/        ← Task files
├── uploads/      ← Images & attachments
├── agents/       ← AI agent configurations
└── workspace.json ← UI state & preferences
```

---

## 📝 Notes

A full-featured Markdown note editor with support for rich content.

### Key Features

| Feature | Description |
|---------|-------------|
| **Markdown editing** | Full ProseMirror-based editor with live preview |
| **Tables** | Create and edit markdown tables with keyboard navigation |
| **Wiki links** | Link notes together with `[[double brackets]]` |
| **Backlinks** | See which notes link to the current note (sidebar panel) |
| **Phantom links** | Discover links to notes that don't exist yet — create them with one click |
| **File browser** | Navigate your notes folder with a tree-style browser |
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

A task management system with Kanban boards, projects, priorities, and scheduling.

### Creating Tasks

Create tasks with a title, description, and optional metadata:
- **Project** — organize tasks by project
- **Priority** — 🔴 High, 🟡 Medium, 🔵 Low, or None
- **Due date & time** — set a deadline
- **Start date & time** — set when work begins
- **Attachments** — add images to tasks
- **Tags** — flexible categorization

### Kanban Board

Tasks are displayed on a Kanban board. Two modes are available:

**Default Mode** — columns based on task status:
- To Do → In Progress → Done → Later

**Custom Mode** — create your own columns per project:
- Example: *Backlog → This Week → Today → Done*
- Each column can optionally auto-set a task status when items are dragged to it
- Setup via project dropdown → "Board Settings"

### Task Display

Task cards show:
- Title with colored left border (priority indicator)
- Due date and time range (e.g. `Feb 16 14:00–15:00`)
- Project name, tags
- ✅ prefix when completed

### Filtering

- Filter by **tag** using the toolbar pills
- Filter by **priority** using the priority filter
- Tasks show/hide based on active filters

### Completion Tracking

When a task is marked as done, the exact completion time is automatically recorded. This enables future productivity analytics and filtering by completion date.

---

## 🗓️ Apple Calendar Integration

Tasks with dates are automatically synced to **Apple Calendar** via the native EventKit framework.

| Behavior | Details |
|----------|---------|
| Calendar name | **Nomendex Tasks** (auto-created) |
| All-day events | When task has date only (no time) |
| Timed events | When task has date + time |
| Time range | `startDate` → event start, `dueDate` → event end |
| High priority | 🔴 Alarm 15 minutes before |
| Medium priority | 🟡 Alarm 30 minutes before |
| Done tasks | Prefixed with ✅ in calendar |
| Sync triggers | Task save, drag-and-drop, delete |

> **Note:** macOS will ask for calendar permission on first sync. You can manage this in **System Settings → Privacy & Security → Calendars**.

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

---

## 🤖 AI Agents

Agents are reusable configurations that customize Claude's behavior in chat sessions.

### What You Can Configure

- **Name & description** — identify the agent's purpose
- **System prompt** — custom instructions that guide Claude's behavior
- **Model** — choose between Sonnet, Opus, or Haiku
- **MCP servers** — enable external tool integrations (e.g. Linear)
- **Allowed tools** — pre-approve specific tools

### Built-in Agent

The **General Assistant** ships by default and cannot be deleted. It uses Claude Sonnet with no custom system prompt.

### Managing Agents

- Create, edit, duplicate, or delete agents from the **Agents settings page**
- Switch agents mid-conversation using the **agent selector** in the chat footer
- Each session remembers which agent was used

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

- **Assign to tasks** — set the `project` field when creating or editing a task
- **Assign to notes** — add `project: MyProject` in the note's YAML frontmatter
- **Project detail view** — see all tasks and notes belonging to a project in one place
- **Custom Kanban boards** — each project can have its own column configuration

### Creating vs. Using Projects

Projects can be used in two ways:
1. **Lightweight** — just type a project name on a task. No setup needed.
2. **Full setup** — create a project entity to unlock custom Kanban columns and board settings.

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

Access settings from the sidebar:

- **Theme** — customize the app's appearance
- **Agents** — create and manage AI agent configurations
- **MCP Clients** — view connected MCP server integrations

---

## Data & Privacy

- **100% local** — all data is stored on your Mac in the workspace folder you choose
- **No cloud sync** — your notes and tasks never leave your machine
- **Portable** — move or back up your workspace folder using any tool (Git, Dropbox, Time Machine, etc.)
- **Open format** — notes are plain Markdown, tasks use Markdown with YAML frontmatter
