import { createServiceLogger } from "@/lib/logger";
import { getSkillsPath, hasActiveWorkspace } from "@/storage/root-path";
import { SkillMetadata, SkillMetadataSchema, SkillUpdateCheckResult, SkillUpdateInfo } from "./skills-types";
import { mkdir, chmod, readdir, stat } from "node:fs/promises";
import path from "path";
import yaml from "js-yaml";

const logger = createServiceLogger("DEFAULT-SKILLS");

/**
 * Embedded default skills - these are written to workspace on first init
 */
interface DefaultSkill {
  name: string;
  files: Record<string, string>; // filename -> content
}

const DEFAULT_SKILLS: DefaultSkill[] = [
  {
    name: "todos",
    files: {
      "SKILL.md": `---
name: todos
description: "Manages project todos via REST API. BEFORE using this skill, you must THINK: 'Does the user mention a project? Does the user imply a specific column like Today?'. Use when the user asks to create, view, update, or delete todos."
version: 11
source: nomendex
---

# Todos Management

## ⚠️ REQUIRED WORKFLOW (Always Do This)

> **NEVER skip Step 1!** You MUST load project context before creating/updating todos.

| Step | Action | Why |
|------|--------|-----|
| **1. LOAD PROJECT** | \`/api/projects/get-by-name\` | Get columns, verify project name |
| **2. THEN ACT** | \`/api/todos/create\` or \`update\` | Now you know the structure |

## 🎯 Core Concept: Custom Columns

Every project can have **custom Kanban columns** with user-defined names. You CANNOT assume column names!

**Examples of column names users might create:**
- Time-based: "Today", "This Week", "Next Sprint", "Someday"
- Workflow: "Backlog", "In Review", "Testing", "Deployed"  
- Priority: "Urgent", "High", "Low"

**Key rules:**
1. Column names are freeform text, NOT predefined
2. Always map user's words to actual column IDs from board config
3. Match project names **case-insensitively** (if user says "my project" but "My Project" exists, use the existing one)

### Status vs Custom Column

| Concept | Purpose | Values |
|---------|---------|--------|
| **status** | Lifecycle state (for filtering) | \`todo\`, \`in_progress\`, \`done\`, \`later\` |
| **customColumnId** | Visual position on board | UUID like \`col-a1b2c3d4\` |

## Overview

Manages todos via the Nomendex REST API. The API handles all validation, ID generation, timestamps, and ordering automatically.

Todos are displayed in a kanban board UI with columns for each status. Users can drag and drop todos between columns to change their status, or use the API to update status programmatically.

## Todo Status

Each todo has a status field that controls which kanban column it appears in. The available statuses are:

| Status | Description |
|--------|-------------|
| \`todo\` | Not started - the default status for new todos |
| \`in_progress\` | Currently being worked on |
| \`done\` | Completed |
| \`later\` | Deferred or backlogged for future consideration |

When creating a todo, status defaults to \`todo\` if not specified. When updating a todo's status, the system automatically assigns a new order position at the end of the target column.

## Port Discovery

The server writes its port to a discoverable location. Extract it with:

\`\`\`bash
PORT=$(cat ~/Library/Application\\ Support/com.firstloop.nomendex/serverport.json | grep -o '"port":[0-9]*' | cut -d: -f2)
\`\`\`

## API Endpoints

All endpoints use POST with JSON body at \`http://localhost:$PORT\`:

| Endpoint | Description |
|----------|-------------|
| \`/api/todos/create\` | Create a new todo |
| \`/api/todos/list\` | List todos (with optional project filter) |
| \`/api/todos/get\` | Get a single todo by ID |
| \`/api/todos/update\` | Update a todo |
| \`/api/todos/delete\` | Delete a todo |
| \`/api/todos/projects\` | List all projects |
| \`/api/todos/tags\` | List all tags |
| \`/api/todos/archive\` | Archive a todo |
| \`/api/todos/unarchive\` | Unarchive a todo |
| \`/api/todos/archived\` | List archived todos |

## Create Todo

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "My todo", "project": "work"}'

# With status
curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "My todo", "status": "in_progress", "project": "work"}'
\`\`\`

## Creating in Custom Columns

**IMPORTANT**: \`customColumnId\` is NOT supported in the \`create\` endpoint. You MUST follow this workflow:

1. **Get Project**: Load project to check case-sensitive name and get board config.
2. **Create Todo**: Create the task in the project (it will start in default column).
3. **Update Todo**: Immediately move it to the target custom column.

\`\`\`bash
# 1. Check project name (CASE SENSITIVE!) and get column ID
# If project is "Demodata", then "demodata" will fail.
PROJECT=$(curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" \\
  -d '{"name": "Demodata"}')

# 2. Create todo
TODO=$(curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -d '{"title": "My Task", "project": "Demodata"}')
TODO_ID=$(echo $TODO | jq -r '.id')

# 3. Move to custom column (e.g. from step 1 found "col-8f9a" for "Today")
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -d '{"todoId": "$TODO_ID", "updates": {"customColumnId": "col-8f9a"}}'
\`\`\`

## List Todos

\`\`\`bash
# All active todos
curl -s -X POST "http://localhost:$PORT/api/todos/list" \\
  -H "Content-Type: application/json" \\
  -d '{}'

# Todos for a specific project
curl -s -X POST "http://localhost:$PORT/api/todos/list" \\
  -H "Content-Type: application/json" \\
  -d '{"project": "work"}'
\`\`\`

## Read Workflow: Today / Scheduled / Calendar Queries

Use this workflow for read-only requests such as:
- "show today"
- "what is scheduled today"
- "calendar for today"
- "what should I work on today"

### Read-Only Rules
- Treat these requests as **read-only** unless the user explicitly asks you to create, update, archive, or reorder a todo.
- If the user is brainstorming, reviewing bugs, or planning work, do NOT silently create todos. Ask whether they want the items captured first.
- Never read internal cache artifacts such as \`.claude/projects/.../tool-results\`. Use live API calls and workspace files only.

### Todo Safety Rules
- **Reschedule freshness**: Before any reschedule or update of an existing todo, call \`POST /api/todos/get\` with the todo ID immediately before \`update\`. Do not rely on stale \`/api/todos/list\` data. If \`status\`, \`scheduledStart\`, or \`scheduledEnd\` changed since the todo was shown to the user, stop, show the refreshed state, and ask again.
- **Multi-day context**: If \`scheduledStart\` and \`scheduledEnd\` are more than 1 local calendar day apart, classify the todo as \`Multi-day context\`. Show it separately, do not include it in \`Today's Workset\`, \`<!-- workset: ... -->\`, completion-rate math, or batch reschedule.
- **Streak authority**: If the latest relevant daily note explicitly states a streak (for example \`DEN 1\`), copy that wording verbatim. Do not recalculate streaks from todo text, checkboxes, or your own arithmetic. If no explicit streak is written, say \`streak neuveden\`.
- **Duplicate-title rendering**: If 2+ relevant todos share the same title, render each one with visible plain-text ID and scheduled range, for example \`[[todo:abc-123|Pohotovost]] · id: abc-123 · 2026-03-31 → 2026-03-31\`.

### Today Workset Order
When answering a "today" or "schedule" query without an explicit external calendar integration, build the workset in this order:

1. **Overdue** - todos with \`dueDate\` before today (deadline bucket)
2. **Due Today** - todos with \`dueDate\` today (deadline bucket)
3. **Scheduled / Started** - single-day todos whose \`scheduledStart\` (and non-multi-day \`scheduledEnd\` ranges) cover today or earlier, plus non-multi-day \`in_progress\` items not already shown
4. **Multi-day Context** - todos whose \`scheduledStart\`/\`scheduledEnd\` span more than 1 local calendar day; show separately as context only
5. **Today / Now Columns** - open todos in real Today-style custom columns after loading the project board config
6. **Focused Project** - if the user names a project, show that project's remaining open todos prominently
7. **Other Candidates** - remaining open todos worth considering

Present these as labeled buckets. Do NOT mix deadline buckets (\`dueDate\`) with schedule/today buckets (\`scheduledStart\`/\`scheduledEnd\`). \`Multi-day Context\` is informational and not part of the actionable daily workset.

### Calendar / Schedule Interpretation
- Treat "calendar" or "schedule" queries as looking for todos with \`scheduledStart\`/\`scheduledEnd\` (schedule/calendar context) while \`dueDate\` remains the deadline field used for overdue counts.
- Only talk about an external calendar if the user explicitly points to one.

### Today Column Detection
- Never guess a custom column ID like \`col-today\`.
- For each relevant project, call \`/api/projects/get-by-name\` and inspect the real board config.
- Match actual Today-style titles such as "Today", "Now", "Dnes", "Dnes aktivni", or the user's named column.
- Only then filter todos by the corresponding \`customColumnId\`.

## Mandatory Execution Protocol

Follow this checklist exactly for mutating requests:

1.  **Context Analysis**:
    *   **Project Extraction**: Identify project name (e.g. "Nomendex dev").
    *   **Column Extraction**: Identify urgency/column (e.g. "today").
    *   **Title Cleaning**: Remove project and column words from the user's sentence to get the core task title.
        *   *Bad*: "Today I need to fix a UI bug in Nomedex dev"
        *   *Good*: "Fix a UI bug"

2.  **Verification (BLOCKING STEP)**:
    *   **STOP!** You cannot create the task yet.
    *   \`POST /api/todos/projects\` -> Check exact case-sensitive project name.
    *   \`POST /api/projects/get-by-name\` -> Load board config to find column IDs.

3.  **Execution**:
    *   Create using the **Cleaned Title**.
    *   Updates MUST happen immediately after to move to custom columns.

## Anti-Patterns (DO NOT DO)

*   ❌ **DO NOT use raw input as title**: Clean it first! "Add task X to project Y" -> Title: "X".
*   ❌ **DO NOT guess IDs**: Never use \`col-today\`. Look it up!
*   ❌ **DO NOT create with customColumnId**: API ignores it. Create then Update.
*   ❌ **DO NOT treat planning as capture**: If the user is only describing bugs, ideas, or options during planning, ask whether they want them saved as todos.
*   ❌ **DO NOT use cached tool output**: Never inspect \`.claude/projects/.../tool-results\` instead of calling the live API.
*   ❌ **DO NOT invent goal/project links**: In daily/evening context, NEVER say "This task probably relates to goal X" unless there is an explicit typed link (project.goalRef → goal ID, or todo.resolvedGoalRefs contains the goal ID). State only what is in the data.
*   ❌ **DO NOT reschedule from stale list data**: Re-fetch the concrete todo via \`/api/todos/get\` immediately before any reschedule/update.
*   ❌ **DO NOT batch-reschedule multi-day todos**: Show them as \`Multi-day context\` only.
*   ❌ **DO NOT hide duplicate titles**: When titles repeat, show visible plain-text ID + \`scheduledStart\`-\`scheduledEnd\`.
*   ❌ **DO NOT invent streak arithmetic**: Use the latest relevant daily note verbatim, or say \`streak neuveden\`.

## Golden Example (Few-Shot)

**User**: "Today I need to fix a UI bug in Nomedex dev: tag deletion icon UI"

**Agent Thought Process**:
1.  *Analyze*:
    *   Project: "Nomedex dev" (needs verification)
    *   Column: "Dneska" -> Today
    *   **Clean Title**: "Fix a UI bug: tag deletion icon UI" (Removed project/time context)
2.  *Verify*: Must check project list for "Nomedex dev".

**Agent Actions**:
\`\`\`bash
# 1. List projects to find REAL name
curl -s -X POST "http://localhost:$PORT/api/todos/projects" -d '{}'
# Result: ["Nomendex dev"] (Note capital N!)

# 2. Get board for "Nomendex dev" to find "Today" column
curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" -d '{"name": "Nomendex dev"}'
# Result: columns: [{ "title": "Today", "id": "col-8f9a..." }]

# 3. Create Task with CLEAN TITLE and CORRECT PROJECT
# Title is NOT "Today I need...", it is just the task itself.
TODO=$(curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -d '{"title": "Fix a UI bug: tag deletion icon UI", "project": "Nomendex dev"}')
ID=$(echo $TODO | jq -r '.id')

# 4. Move to Target Column
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -d '{"todoId": "$ID", "updates": {"customColumnId": "col-8f9a..."}}'
\`\`\`

## Important Constraints

**Project Creation is Disabled**: You cannot create new projects programmatically. 
Before assigning a todo to a project, verify the project exists using /api/todos/projects or /api/projects/list.
If the project doesn't exist, tell the user: "Please open the 'Projects' view from the sidebar and click 'New Project' to create it."

## How Claude Should Use This Skill

Always start by getting the server port, then use the appropriate endpoint.
Use this skill for both read and write todo workflows. Do not improvise a separate ad-hoc shell workflow outside the skill.

## Custom Kanban Columns

Projects can have custom Kanban columns beyond the default statuses. To work with custom columns:

1. Use the **projects** skill to load the project and its board configuration
2. Get the column ID from the board config (e.g. map "Someday" -> "col-8f9a")
3. Update the todo with \`customColumnId\`

> **IMPORTANT**: Column IDs are dynamic generated UUIDs. NEVER guess an ID like "col-today". ALWAYS map the user's requested column name to the actual ID found in the project configuration.

Example: Moving a todo to a "Code Review" column:
\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -H "Content-Type: application/json" \\
  -d '{"todoId": "todo-123", "updates": {"customColumnId": "col-review"}}'
\`\`\`

See the **projects** skill for full documentation on loading board configurations and working with custom columns.
`,
    },
  },
  {
    name: "manage-skills",
    files: {
      "SKILL.md": `---
name: manage-skills
description: Manages Claude Code skills - creates, updates, and maintains skills following established design principles. Use when the user asks to create a skill, update a skill, refactor a skill, or wants to teach Claude a new capability.
version: 5
source: nomendex
---

# Skill Management

## Skill Design Principles

### 1. SKILL.md is Self-Contained
- Contains ALL information needed to use the skill
- Should be as minimal as possible while conveying complete information
- No need for separate README, USAGE, INSTALL, or CHANGELOG files

### 2. Single Script Design
- Optimize for ONE script per skill (not multiple scripts)
- Use command-line parameters for different operations
- Pattern: \`./script.sh <command> [arguments]\`

### 3. Minimal File Structure
\`\`\`
skill-name/
├── SKILL.md          # Required - complete documentation
└── script.sh         # Optional - single CLI if needed
\`\`\`

## SKILL.md Structure

Required frontmatter:
\`\`\`yaml
---
name: skill-name
description: What it does and when to use it. Use when [triggers].
version: 1
---
\`\`\`

## Creating a New Skill

1. Create directory in \`.claude/skills/skill-name/\`
2. Create SKILL.md with frontmatter and documentation
3. Optionally add a shell script for automation
4. Make scripts executable with \`chmod +x\`

## Rendering Custom UI

For rendering interactive HTML interfaces in chat, use the **create-interface** skill which provides comprehensive documentation on the \`mcp__noetect-ui__render_ui\` tool.
`,
    },
  },
  {
    name: "projects",
    files: {
      "SKILL.md": `---
name: projects
description: "Working with projects and custom Kanban boards. BEFORE using this skill, you must THINK: 'Does the user assume the project already exists? Am I creating a duplicate because of case sensitivity?'. Use when the user mentions a project name."
version: 5
source: nomendex
---

# Projects Skill

## Overview

Projects are stored in \`.nomendex/projects.json\` - the source of truth for all project data including custom Kanban board configurations. Each project can have custom columns with optional status mapping.

## Mandatory Verification Protocol

1.  **List First**: Always call \`/api/projects/list\` before creating a new project.
2.  **Case Check**: Compare user input ("nomendex") with existing list ("Nomendex").
3.  **Reuse**: If a match (even case-insensitive) exists, USE IT. Do not create a duplicate.

## Anti-Patterns (DO NOT DO)

*   ❌ **DO NOT create blindly**: "Create project X" -> List first!
*   ❌ **DO NOT duplicate**: "nomendex" and "Nomendex" should not coexist.


## Port Discovery

\`\`\`bash
PORT=$(cat ~/Library/Application\\\\ Support/com.firstloop.nomendex/serverport.json | grep -o '"port":[0-9]*' | cut -d: -f2)
\`\`\`

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| \`/api/projects/list\` | List all projects |
| \`/api/projects/get\` | Get project by ID |
| \`/api/projects/get-by-name\` | Get project by name |
| \`/api/projects/create\` | Create new project |
| \`/api/projects/update\` | Update project (name, color, board) |
| \`/api/projects/board/get\` | Get board config for project |
| \`/api/projects/board/save\` | Save board config for project |

## Loading a Project

\`\`\`bash
# By name (recommended)
curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"name": "PROJECT_NAME"}'

# By ID
curl -s -X POST "http://localhost:$PORT/api/projects/get" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"projectId": "project-id"}'
\`\`\`

## Getting Board Configuration

The board config contains custom columns with their IDs and status mappings:

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/projects/board/get" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"projectId": "PROJECT_ID"}'
\`\`\`

Response example:
\`\`\`json
{
  "columns": [
    {"id": "col-today", "title": "Today", "order": 1, "status": "todo"},
    {"id": "col-review", "title": "Code Review", "order": 2},
    {"id": "col-done", "title": "Done", "order": 3, "status": "done"}
  ],
  "showDone": true
}
\`\`\`

## Moving a Task to a Column

After loading the project, find the correct column by name and use its ID:

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"todoId": "TODO_ID", "updates": {"customColumnId": "COLUMN_ID"}}'
\`\`\`

## Saving Board Configuration

Create or update custom columns:

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/projects/board/save" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "projectId": "PROJECT_ID",
    "board": {
      "columns": [
        {"id": "col-1", "title": "Today", "order": 1, "status": "todo"},
        {"id": "col-2", "title": "In Progress", "order": 2, "status": "in_progress"},
        {"id": "col-3", "title": "Review", "order": 3},
        {"id": "col-4", "title": "Done", "order": 4, "status": "done"}
      ],
      "showDone": true
    }
  }'
\`\`\`

## Workflow Example

User: "Move the Fix bug task to Code Review in the Nomendex project"

1. Get project by name → extract projectId
2. Get board config → find "Code Review" column → get its ID
3. Update todo with customColumnId

\`\`\`bash
# Step 1: Get project
PROJECT=$(curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"name": "Nomendex"}')

# Step 2: Get board config (extract projectId from response)
BOARD=$(curl -s -X POST "http://localhost:$PORT/api/projects/board/get" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"projectId": "nomendex"}')

# Step 3: Update todo (find column ID from board response)
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"todoId": "fix-bug-123", "updates": {"customColumnId": "col-review"}}'
\`\`\`

## Column Status Mapping

Columns can have an optional \`status\` field. When a todo is moved to a column with a status, the todo's status is automatically updated:

| Status | Description |
|--------|-------------|
| \`todo\` | Not started |
| \`in_progress\` | Currently working on |
| \`done\` | Completed |
| \`later\` | Deferred |

Columns without a status field don't affect the todo's status when items are moved there.
`,
    },
  },
  {
    name: "create-interface",
    files: {
      "SKILL.md": `---
name: create-interface
description: Renders interactive HTML interfaces in chat using the render_ui tool. Use when the user asks to display UI, create a widget, show a form, render a chart, build an interface, or display interactive content.
version: 2
source: nomendex
---

# Create Interface

Render custom HTML interfaces directly in chat using the \`mcp__noetect-ui__render_ui\` tool. Perfect for forms, charts, tables, dashboards, and interactive widgets.

## Tool Usage

\`\`\`
Tool: mcp__noetect-ui__render_ui
Input:
  html: "<div class='card'><h2>Hello</h2></div>"   # Required - HTML content (body only, no <html> wrapper)
  title: "My Widget"                                # Optional - header above the UI
  height: 300                                       # Optional - fixed height in pixels (default: auto-resize)
\`\`\`

## Theme Integration

The UI automatically inherits the app's current theme. Use CSS variables for consistent styling across light/dark modes.

### Surface Colors (backgrounds)
| Variable | Usage |
|----------|-------|
| \`var(--surface-primary)\` | Main background |
| \`var(--surface-secondary)\` | Cards, elevated surfaces |
| \`var(--surface-tertiary)\` | Nested containers |
| \`var(--surface-accent)\` | Highlighted areas |
| \`var(--surface-muted)\` | Subtle backgrounds, code blocks |

### Content Colors (text)
| Variable | Usage |
|----------|-------|
| \`var(--content-primary)\` | Main text |
| \`var(--content-secondary)\` | Secondary text, labels |
| \`var(--content-tertiary)\` | Muted text, placeholders |
| \`var(--content-accent)\` | Highlighted text |

### Border Colors
| Variable | Usage |
|----------|-------|
| \`var(--border-default)\` | Standard borders |
| \`var(--border-accent)\` | Emphasized borders |

### Semantic Colors
| Variable | Usage |
|----------|-------|
| \`var(--semantic-primary)\` | Primary actions, links |
| \`var(--semantic-primary-foreground)\` | Text on primary background |
| \`var(--semantic-destructive)\` | Destructive actions, errors |
| \`var(--semantic-destructive-foreground)\` | Text on destructive background |
| \`var(--semantic-success)\` | Success states |
| \`var(--semantic-success-foreground)\` | Text on success background |

### Design Tokens
| Variable | Usage |
|----------|-------|
| \`var(--border-radius)\` | Standard corner radius |
| \`var(--shadow-sm)\` | Subtle shadow |
| \`var(--shadow-md)\` | Medium shadow |
| \`var(--shadow-lg)\` | Large shadow |

## Built-in Utility Classes

### Text Classes
- \`.text-primary\` - Main text color
- \`.text-secondary\` - Secondary text color
- \`.text-muted\` - Muted/tertiary text color
- \`.text-accent\` - Accent text color
- \`.text-success\` - Success color
- \`.text-destructive\` - Error/destructive color

### Background Classes
- \`.bg-primary\` - Primary surface background
- \`.bg-secondary\` - Secondary surface background
- \`.bg-muted\` - Muted surface background

### Container Classes
- \`.card\` - Styled container with secondary background, border, border-radius, and 16px padding

## Pre-styled Elements

These elements have default theme-aware styles applied automatically:

- **body** - System font, 14px, primary text color, 12px padding
- **a** - Primary semantic color
- **button** - Secondary background, border, border-radius, hover state
- **button.primary** - Primary semantic background with foreground text
- **button.destructive** - Destructive semantic background with foreground text
- **input, select, textarea** - Primary background, border, focus ring
- **table, th, td** - Full width, border-bottom on rows
- **code** - Monospace font, muted background, 2px/4px padding
- **pre** - Monospace font, muted background, 12px padding, overflow scroll

## Auto-Resize Behavior

By default, the UI auto-resizes to fit its content. The iframe:
1. Measures content height on load
2. Observes DOM mutations and resizes dynamically
3. Responds to window resize events

Set a fixed \`height\` parameter to disable auto-resize.

## Examples

### Simple Card
\`\`\`html
<div class="card">
  <h3 style="margin: 0 0 8px 0;">Status</h3>
  <p class="text-secondary" style="margin: 0;">All systems operational</p>
</div>
\`\`\`

### Form with Inputs
\`\`\`html
<div class="card">
  <h3 style="margin: 0 0 12px 0;">Contact</h3>
  <input type="text" placeholder="Name" style="width: 100%; margin-bottom: 8px;">
  <input type="email" placeholder="Email" style="width: 100%; margin-bottom: 8px;">
  <textarea placeholder="Message" style="width: 100%; height: 80px; margin-bottom: 12px;"></textarea>
  <button class="primary">Send</button>
</div>
\`\`\`

### Data Table
\`\`\`html
<table>
  <thead>
    <tr><th>Name</th><th>Status</th><th>Actions</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Item 1</td>
      <td class="text-success">Active</td>
      <td><button>Edit</button></td>
    </tr>
    <tr>
      <td>Item 2</td>
      <td class="text-muted">Inactive</td>
      <td><button>Edit</button></td>
    </tr>
  </tbody>
</table>
\`\`\`

### Stats Dashboard
\`\`\`html
<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">128</div>
    <div class="text-secondary">Users</div>
  </div>
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">1.2k</div>
    <div class="text-secondary">Events</div>
  </div>
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">99.9%</div>
    <div class="text-secondary">Uptime</div>
  </div>
</div>
\`\`\`

### Interactive with JavaScript
\`\`\`html
<div class="card">
  <div id="count" style="font-size: 32px; text-align: center; margin-bottom: 12px;">0</div>
  <div style="display: flex; gap: 8px; justify-content: center;">
    <button onclick="update(-1)">−</button>
    <button class="primary" onclick="update(1)">+</button>
  </div>
</div>
<script>
  let count = 0;
  function update(delta) {
    count += delta;
    document.getElementById('count').textContent = count;
  }
</script>
\`\`\`

## Security Notes

- UI renders in a **sandboxed iframe** with \`allow-scripts allow-forms\`
- **No access** to parent window, localStorage, cookies, or parent DOM
- Scripts execute within the iframe only
- Forms work but submissions stay within the iframe
- Safe for displaying user-generated or dynamic content
`,
    },
  },
  {
    name: "daily-notes",
    files: {
      "SKILL.md": `---
name: daily-notes
description: Manages daily notes using vault-config folder mapping and the vault's existing naming convention. Use when the user asks to view recent notes, create daily notes, read today's notes, summarize the week, or references dates.
version: 4
source: nomendex
---

# Daily Notes Management

## Overview

This skill manages daily notes in the mapped daily-notes folder within the workspace's notes directory.
It must detect the real folder, nesting, and filename pattern from \`vault-config.json\` and existing notes before reading or creating anything.

## Detection Rules

1. Read \`vault-config.json\` first and use \`folderMapping.dailyNotes\` if present
2. Inspect existing daily-note filenames to detect the active pattern
3. Reuse existing folder nesting (flat vs year/month) exactly
4. If no daily-note convention exists yet, ask before creating the first note

## Getting the Notes Directory

\`\`\`bash
NOTES_DIR=$(curl -s http://localhost:$PORT/api/workspace/paths | jq -r '.data.notes')
\`\`\`

Daily notes are stored at the detected folder under \`$NOTES_DIR\`.

## CLI Usage

\`\`\`bash
NOTES_DIR=/path/to/workspace/notes .claude/skills/daily-notes/daily-note.sh <command> [arguments]
\`\`\`

### Commands

| Command | Description |
|---------|-------------|
| \`get-today\` | Get or create today's daily note |
| \`get-note [date]\` | Get a specific date's note using the vault's existing format |
| \`get-last-x [Ndays]\` | Get notes from the last N days |

## How Claude Should Use This Skill

**Important**: Always set \`NOTES_DIR\` to the workspace's notes path before running the script. The script detects the daily-notes folder and naming convention from \`vault-config.json\` and existing notes.

If the script falls back to a default because the vault has no established convention yet, treat that as a prompt to confirm with the user before creating the first note.

### When User Asks About Recent Work
\`\`\`
User: "What have I been working on this week?"
-> Run: NOTES_DIR=/path/to/notes ./daily-note.sh get-last-x 7days
-> Parse content and provide summary
\`\`\`

### When User Wants to Add to Today's Note
\`\`\`
User: "Add this to my daily note: Completed feature X"
-> Run: NOTES_DIR=/path/to/notes ./daily-note.sh get-today
-> Use Edit tool to append content to the returned file path
\`\`\`

## Best Practices

1. **Always set NOTES_DIR** - Don't rely on the default path
2. **Detect before creating** - Never assume \`daily-notes/\` or a fixed date pattern
3. **Handle missing notes gracefully** - Not every day has a note
4. **Preserve existing content** - Use Edit tool, not Write when modifying
`,
      "daily-note.sh": `#!/bin/bash

# Daily Notes CLI
# Detects the real daily-notes folder and filename pattern from vault-config.json and existing notes.

NOTES_DIR="\${NOTES_DIR:-$HOME/.mcpclient/notes}"

read_configured_daily_dir() {
    local config_file="$NOTES_DIR/vault-config.json"
    if [[ -f "$config_file" ]] && command -v jq >/dev/null 2>&1; then
        local mapped_dir
        mapped_dir=$(jq -r '.folderMapping.dailyNotes // empty' "$config_file" 2>/dev/null)
        if [[ -n "$mapped_dir" ]]; then
            echo "$NOTES_DIR/$mapped_dir"
            return 0
        fi
    fi
    return 1
}

detect_daily_dir() {
    local configured_dir
    configured_dir=$(read_configured_daily_dir)
    if [[ -n "$configured_dir" ]]; then
        echo "$configured_dir"
        return
    fi

    if [[ -d "$NOTES_DIR/daily-notes" ]]; then
        echo "$NOTES_DIR/daily-notes"
        return
    fi

    if [[ -d "$NOTES_DIR/Daily Notes" ]]; then
        echo "$NOTES_DIR/Daily Notes"
        return
    fi

    local best_dir=""
    local best_count=0
    while IFS= read -r dir; do
        local count
        count=$(find "$dir" -type f -name "*.md" 2>/dev/null | sed 's#.*/##' | grep -E '(^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}\\.md$|^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.md$)' | wc -l | tr -d ' ')
        if [[ "$count" =~ ^[0-9]+$ ]] && (( count > best_count )); then
            best_count=$count
            best_dir="$dir"
        fi
    done < <(find "$NOTES_DIR" -mindepth 1 -maxdepth 2 -type d ! -path "*/.git*" ! -path "*/.obsidian*" ! -path "*/.claude*" 2>/dev/null)

    if [[ -n "$best_dir" ]]; then
        echo "$best_dir"
    else
        echo "$NOTES_DIR/daily-notes"
    fi
}

detect_date_format() {
    local samples
    samples=$(find "$DAILY_DIR" -type f -name "*.md" 2>/dev/null | sed 's#.*/##' | grep -E '(^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}\\.md$|^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.md$)' | head -20)
    if echo "$samples" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.md$'; then
        echo "iso"
    else
        echo "mdy"
    fi
}

detect_nesting_mode() {
    local sample_path
    sample_path=$(find "$DAILY_DIR" -mindepth 3 -maxdepth 3 -type f -name "*.md" 2>/dev/null | head -n 1)
    local relative_path="\${sample_path#$DAILY_DIR/}"
    if [[ "$relative_path" =~ ^[0-9]{4}/[0-9]{2}/.+\\.md$ ]]; then
        echo "year_month"
    else
        echo "flat"
    fi
}

DAILY_DIR=$(detect_daily_dir)
DATE_FORMAT=$(detect_date_format)
NESTING_MODE=$(detect_nesting_mode)

format_date() {
    local date_str="$1"
    local fmt
    if [[ "$DATE_FORMAT" == "iso" ]]; then
        fmt="+%Y-%m-%d"
    else
        fmt="+%-m-%-d-%Y"
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        date -j -f "%Y-%m-%d" "$date_str" "$fmt" 2>/dev/null
    else
        date -d "$date_str" "$fmt" 2>/dev/null
    fi
}

get_date_n_days_ago() {
    local days_ago="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        date -v-"\${days_ago}"d "+%Y-%m-%d"
    else
        date -d "\${days_ago} days ago" "+%Y-%m-%d"
    fi
}

get_today() {
    if [[ "$DATE_FORMAT" == "iso" ]]; then
        date "+%Y-%m-%d"
    else
        date "+%-m-%-d-%Y"
    fi
}

normalize_input_date() {
    local date_input="$1"
    if [[ "$date_input" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        format_date "$date_input"
    elif [[ "$date_input" =~ ^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}$ ]] && [[ "$DATE_FORMAT" == "iso" ]]; then
        local month day year
        IFS='-' read -r month day year <<< "$date_input"
        printf "%04d-%02d-%02d\n" "$year" "$month" "$day"
    else
        echo "$date_input"
    fi
}

build_note_path() {
    local note_date="$1"
    local date_iso="$2"
    local existing_path
    existing_path=$(find "$DAILY_DIR" -type f -name "$note_date.md" 2>/dev/null | head -n 1)
    if [[ -n "$existing_path" ]]; then
        echo "$existing_path"
        return
    fi

    if [[ "$NESTING_MODE" == "year_month" ]]; then
        local year month
        if [[ "$OSTYPE" == "darwin"* ]]; then
            year=$(date -j -f "%Y-%m-%d" "$date_iso" "+%Y")
            month=$(date -j -f "%Y-%m-%d" "$date_iso" "+%m")
        else
            year=$(date -d "$date_iso" "+%Y")
            month=$(date -d "$date_iso" "+%m")
        fi
        echo "$DAILY_DIR/$year/$month/$note_date.md"
    else
        echo "$DAILY_DIR/$note_date.md"
    fi
}

display_note() {
    local note_file="$1"
    local note_date="$2"
    local show_header="\${3:-true}"

    if [[ -f "$note_file" && -s "$note_file" ]]; then
        if [[ "$show_header" == "true" ]]; then
            echo ""
            echo "=== Notes from $note_date ==="
            echo ""
        fi
        cat "$note_file"
        if [[ "$show_header" == "true" ]]; then
            echo ""
            echo "---"
        fi
        return 0
    else
        return 1
    fi
}

cmd_get_today() {
    local TODAY=$(get_today)
    local TODAY_ISO=$(date "+%Y-%m-%d")
    local NOTE_PATH
    NOTE_PATH=$(build_note_path "$TODAY" "$TODAY_ISO")
    mkdir -p "$(dirname "$NOTE_PATH")"

    if [[ ! -f "$NOTE_PATH" ]]; then
        touch "$NOTE_PATH"
        echo "Created: $NOTE_PATH" >&2
    fi

    if [[ -s "$NOTE_PATH" ]]; then
        cat "$NOTE_PATH"
    fi
}

cmd_get_note() {
    local date_input="$1"
    if [[ -z "$date_input" ]]; then
        echo "Error: Date required" >&2
        exit 1
    fi
    local normalized_date
    normalized_date=$(normalize_input_date "$date_input")
    local NOTE_FILE
    NOTE_FILE=$(build_note_path "$normalized_date" "$(date "+%Y-%m-%d")")
    if display_note "$NOTE_FILE" "$date_input" "false"; then
        exit 0
    else
        echo "Error: No note found for date: $date_input" >&2
        exit 1
    fi
}

cmd_get_last_x() {
    local days_input="$1"
    if [[ -z "$days_input" ]]; then
        echo "Error: Duration required (e.g., 7days)" >&2
        exit 1
    fi
    local days="\${days_input//[^0-9]/}"
    echo "Fetching daily notes from the last $days days..."
    echo "==========================================="
    local FOUND_NOTES=0
    for ((i=0; i<days; i++)); do
        local DATE_ISO=$(get_date_n_days_ago "$i")
        local DATE_FORMATTED=$(format_date "$DATE_ISO")
        if [[ -n "$DATE_FORMATTED" ]]; then
            local NOTE_FILE
            NOTE_FILE=$(build_note_path "$DATE_FORMATTED" "$DATE_ISO")
            if display_note "$NOTE_FILE" "$DATE_FORMATTED"; then
                FOUND_NOTES=$((FOUND_NOTES + 1))
            fi
        fi
    done
    echo ""
    echo "Found $FOUND_NOTES note(s) from the last $days days."
}

COMMAND="\${1:-}"
case "$COMMAND" in
    get-today) cmd_get_today ;;
    get-note) cmd_get_note "$2" ;;
    get-last-x) cmd_get_last_x "$2" ;;
    *)
        echo "Daily Notes CLI"
        echo "Usage: $0 <command> [arguments]"
        echo "Commands: get-today, get-note [date], get-last-x [Ndays]"
        exit 1
        ;;
esac
`,
    },
  },
  {
    name: "adopt",
    files: {
      "SKILL.md": `---
name: adopt
description: Scaffold the BPagent system onto an existing Obsidian vault. Scans your vault structure, maps folders interactively, and generates configuration.
version: 3
source: nomendex
---

# Adopt Skill

Bring Your Own Vault (BYOV) — set up the BPagent system on an existing Obsidian vault.

## Usage

\`\`\`
/adopt    # Run from the root of your existing Obsidian vault
\`\`\`

## When to Use

- You have an existing Obsidian vault and want to add the BPagent system
- You want to keep your current folder structure

## Phase 1: Scan Vault Structure

Analyze the existing vault to understand its organization.

### Steps

1. **List top-level directories** using \`ls\`, excluding system dirs (\`.obsidian\`, \`.git\`, \`.trash\`, \`.nomendex\`)

2. **For each directory**, gather signals:
   - Count \`.md\` files (using Glob)
   - Check for date-named files (\`M-D-YYYY*.md\` or \`YYYY-MM-DD*.md\`) — indicates daily notes
   - Grep for goal/review/template keywords in filenames and content

3. **Detect organization method** based on signals:
   - **PARA**: Folders named Projects, Areas, Resources, Archives
   - **Zettelkasten**: Numeric-prefixed notes, heavy wiki-linking, flat structure
   - **LYT (Linking Your Thinking)**: Folders named Atlas, Calendar, Cards, Extras, Sources
   - **Flat**: Few folders, most files at root
   - **Custom**: None of the above patterns match

4. **Present findings** to the user:
   \`\`\`
   Vault scan complete!

   Found 342 notes across 8 folders:
     daily-notes/     → 180 notes (date-named — likely daily notes)
     Projects/        → 45 notes (likely projects)
     Goals/           → 12 notes (contains goal keywords)
     Templates/       → 8 notes (contains template keywords)
     Archives/        → 67 notes
     inbox/           → 15 notes

   Detected method: PARA-like structure
   \`\`\`

## Phase 2: Map Folders to Roles

Use AskUserQuestion to confirm or correct the detected mappings.

### Roles to Map

| Role | Purpose | Detection Signal |
|------|---------|-----------------|
| Daily Notes | Daily journal entries | Date-named files (\`M-D-YYYY\`) |
| Goals | Typed goals + mirror notes + weekly review | Goal/review keywords, existing Goals folder |
| Projects | Active projects | Subdirs with project keywords |
| Templates | Reusable note structures | Files with template keywords or in Templates/ |
| Archives | Completed/inactive content | Folder named Archive(s) |
| Inbox | Uncategorized captures | Folder named Inbox, or files tagged #inbox |

### Interactive Mapping

For each role, ask the user to confirm or correct:

**Question format (use AskUserQuestion):**
- "Which folder holds your **daily notes**?"
- Options: detected candidate(s), "I don't have one (create it)", "Skip — I don't use this"
- For optional roles (Inbox), include "Skip" as a default

**Edge cases:**
- **No candidate for a role**: Offer to create the folder
- **Multiple candidates**: Present all and let the user choose

## Phase 3: Personalize Preferences

Ask 4 questions:

**Question 1: Your name**
- "What should I call you?"
- Used for personalized prompts and greetings

**Question 2: Preferred review day**
- "What day do you prefer for your weekly review?"
- Options: Sunday (Recommended), Saturday, Monday, Friday

**Question 3: Primary goal areas**
- "Which areas are most important to you right now? (Pick 2-4)"
- Options: Career & Professional, Health & Wellness, Relationships, Personal Growth
- Also offer: Financial, Creativity & Fun, Learning, Other
- multiSelect: true

**Question 4: Work style**
- "How do you prefer BPagent to interact?"
- Options: Direct and concise (Recommended), Coaching and challenging, Detailed and thorough, Minimal — just do the task

## Phase 4: Write \`vault-config.json\`

Write \`vault-config.json\` in the vault root. This is the **only configuration file** BPagent reads.
It contains all personalization and folder mappings:

\`\`\`json
{
  "name": "User's name",
  "reviewDay": "Sunday",
  "goalAreas": ["Career & Professional", "Health & Wellness"],
  "workStyle": "Direct and concise",
  "setupDate": "2026-03-14",
  "version": "3.2",
  "adoptedVault": true,
  "folderMapping": {
    "dailyNotes": "daily-notes",
    "goals": "Goals",
    "projects": "Projects",
    "templates": "Templates",
    "archives": "Archives",
    "inbox": "inbox"
  }
}
\`\`\`

Replace values with the user's actual answers from Phase 2 and 3.

**IMPORTANT:** Do NOT create \`AGENTS.md\`, \`.claude/settings.json\`, \`.claude/rules/\`, or \`.claude/hooks/\`. BPagent does not use these files — it reads only \`vault-config.json\`.

## Phase 5: Scaffold Missing Pieces

Check what's missing and offer to create it. **Always ask before creating.**

### 5a. Typed Goals Bootstrap

If the goals folder is empty or newly created:
- Ask: "Your goals folder is empty. Want me to bootstrap the typed goals system (API-first) and weekly review note?"
- If yes:
  1. Create \`<Goals>/goals/\` for per-goal mirror notes (bidirectional sync target)
  2. Create \`<Goals>/3. Weekly Review.md\` if missing (working note template)
  3. **Do not** manually create \`Goals/0. 3-Year Vision.md\`, \`Goals/1. Yearly Goals.md\`, or \`Goals/2. Monthly Goals.md\` as source files (these are generated dashboards in Typed Goal Graph)
  4. Offer to create initial goals through API:
     - Use \`POST /api/goals/create\` for first vision/yearly/monthly goals
     - Then run \`POST /api/goals/sync/dashboards {}\` and \`POST /api/goals/sync/all {}\`
- If no: skip

### 5b. Templates

If the templates folder is empty or newly created:
- "Want me to add standard templates? (Daily, Weekly Review, Project)"
- If yes: create templates, adapting internal links to the user's folder names
- If no: skip

## Phase 6: Verify & Next Steps

### 6a. Validation

Run quick checks:
- \`vault-config.json\` is valid JSON (read it back)
- All mapped folders exist

### 6b. Summary

Present a summary:
\`\`\`
Adoption complete!

Vault: /path/to/vault
Method: Custom (preserved your existing structure)
Mapped folders:
  Daily Notes → daily-notes/
  Goals       → Goals/
  Projects    → Projects/
  Templates   → Templates/
  Archives    → Archives/
  Inbox       → inbox/

Created:
  ✓ vault-config.json (preferences & folder mapping)
  ✓ Typed goals bootstrap (\`Goals/goals/\` + optional \`Goals/3. Weekly Review.md\`)
  ✓ Standard templates (3 files)

Your vault structure is preserved. Configuration and optional bootstrap files were added; typed goal data lives in \`.nomendex/goals/\` and dashboards are generated via sync.
\`\`\`

### 6c. Next Steps

Suggest what to do next:
- "Try \`/daily\` to create today's note"
- "Try \`/review\` for a guided weekly review"
- "Try \`/goal-tracking\` to create your first typed goals, then run \`/monthly\` or \`/weekly\`"

## Error Handling

- **Already adopted**: If \`vault-config.json\` exists with \`adoptedVault: true\`, ask: "This vault was already adopted. Re-run adoption? (This will regenerate vault-config.json.)"
- **Empty vault**: If no \`.md\` files found, that's fine — the skill will create the folder structure from scratch

## Integration

Works with:
- \`/daily\` — uses mapped daily notes folder from vault-config.json
- \`/weekly\` — uses mapped goals folder from vault-config.json
- \`/review\` — respects adopted vault structure
- \`/monthly\` — uses mapped goals folder from vault-config.json
- \`/goal-tracking\` — manages typed goals via API and syncs dashboards
`,
    },
  },
  {
    name: "check-links",
    files: {
      "SKILL.md": `---
name: check-links
description: Find broken wiki-links in the vault. Read-only analysis — scans for [[links]] and verifies target files exist. No writes, no dependencies.
version: 2
source: nomendex
---

# Check Links Skill

Finds broken \`[[wiki-links]]\` across your vault by extracting link targets and verifying that each target file exists. Read-only — never modifies files.

## Usage

\`\`\`
/check-links
\`\`\`

Or ask:
- "Check for broken links in my vault"
- "Find dead wiki-links"
- "Are there any broken links?"

## How to Execute

### Step 1: Extract all wiki-links

Use **Grep** to find all \`[[...]]\` patterns in markdown files:

\`\`\`
Grep:
  pattern: "\\\\[\\\\[([^\\\\]|]+)"
  glob: "*.md"
  output_mode: content
  -n: true
\`\`\`

This captures the link target (before any \`|\` alias). Exclude \`.claude/\` and \`.obsidian/\` directories from results.

### Step 2: Build unique target list

From the grep results, extract the unique link targets. For each match like \`[[My Note]]\` or \`[[My Note|display text]]\`, the target is \`My Note\`.

Strip:
- Heading anchors: \`[[Note#heading]]\` → target is \`Note\`
- Block references: \`[[Note^block-id]]\` → target is \`Note\`
- Aliases: \`[[Note|alias]]\` → target is \`Note\`

### Step 3: Verify each target exists

For each unique target, use **Glob** to check if a matching file exists:

\`\`\`
Glob:
  pattern: "**/<target>.md"
\`\`\`

A link is **broken** if no file matches. A link is **valid** if at least one file matches.

### Step 4: Report results

Group broken links by source file:

\`\`\`markdown
## Broken Links Report

### daily-notes/3-14-2026.md
- [[Projet Alpha]] — no matching file found
- [[Old Goal]] — no matching file found

### Projects/Project Beta.md
- [[Meeting Notes Jan]] — no matching file found

---

**Summary:** 3 broken links across 2 files (out of 45 total links checked)
\`\`\`

### Step 5: Suggest fixes

For each broken link, try to find a close match:

1. Use **Glob** with a partial pattern: \`**/*<partial-target>*.md\`
2. If a similar filename exists, suggest it:
   \`\`\`
   - [[Projet Alpha]] — Did you mean [[Project Alpha]]?
   \`\`\`
3. If no close match, just report "no matching file found"

## Edge Cases

- **Embedded images** (\`![[image.png]]\`) — skip these, they reference attachments
- **External links** (\`[text](https://...)\`) — skip these, they are not wiki-links
- **Template placeholders** (\`[[{{date}}]]\`) — skip anything with \`{{\` in the target
- **Empty links** (\`[[]]\`) — report as malformed, not broken

## No Broken Links

If all links are valid:

\`\`\`
✅ All wiki-links verified — no broken links found across X files (Y links checked)
\`\`\`

## Tips

- Run \`/check-links\` periodically to catch link rot
- After renaming files, run this to find links that need updating
- Combine with \`/search\` to find notes that reference deleted content
`,
    },
  },
  {
    name: "daily",
    files: {
      "SKILL.md": `---
name: daily
description: Create daily notes and manage morning, midday, and evening routines. Structure daily planning, task review, and end-of-day reflection. Use for daily productivity routines or when asked to create today's note.
version: 8
source: nomendex
---

# Daily Workflow Skill

Creates daily notes and provides structured workflows for morning planning, midday check-ins, and evening shutdowns.

## Usage

Invoke with \`/daily\` or ask BPagent to create today's note or help with daily routines.

### Create Today's Note
\`\`\`
/daily
\`\`\`

Or simply ask:
- "Create today's daily note"
- "Start my morning routine"
- "Help me with evening shutdown"

## Daily Note Creation

### Detection Rules
1. **Read \`vault-config.json\` first** if present and use the mapped daily notes folder
2. **Inspect existing daily-note files** to detect the real folder, nesting, and filename format
3. **Inspect the daily template** only after checking real notes
4. **Reuse the detected convention exactly** - never create a parallel folder or alternate date format
5. **If no convention exists yet**, say so explicitly and ask before choosing one

### What Happens
1. **Detects today's real daily-note path**
   - If today's note exists: opens the existing note
   - If today's note is missing: proposes creation using the detected convention

2. **Template Processing**
   - Replaces \`{{date}}\` with today's date
   - Replaces \`{{date:format}}\` with formatted dates
   - Handles date arithmetic (e.g., \`{{date-1}}\` for yesterday)

3. **Automatic Organization**
   - Uses the mapped or detected daily-notes folder
   - Reuses the vault's existing filename pattern
   - Preserves template structure without creating a second convention

### Template Variables
Your daily template can use:
- \`{{date}}\` - Today's date in default format
- \`{{date:dddd}}\` - Day name (e.g., Monday)
- \`{{date:MMMM DD, YYYY}}\` - Formatted date
- \`{{date-1:YYYY-MM-DD}}\` - Yesterday's date
- \`{{date+1:YYYY-MM-DD}}\` - Tomorrow's date
- \`{{time}}\` - Current time

## Morning Routine (5-10 minutes)

Morning planning is **read-only by default**. Summarize and propose a plan first. Only create or update notes and todos after explicit confirmation or a clear instruction to do so.

### Todo Safety Rules
- **Reschedule freshness**: Before any reschedule or update of an existing todo, call \`POST /api/todos/get\` with the todo ID immediately before \`update\`. Do not rely on stale \`/api/todos/list\` data. If \`status\`, \`scheduledStart\`, or \`scheduledEnd\` changed since the todo was shown to the user, stop, show the refreshed state, and ask again.
- **Multi-day context**: If \`scheduledStart\` and \`scheduledEnd\` are more than 1 local calendar day apart, classify the todo as \`Multi-day context\`. Show it separately, do not include it in \`Today's Workset\`, \`<!-- workset: ... -->\`, completion-rate math, or batch reschedule.
- **Streak authority**: If the latest relevant daily note explicitly states a streak (for example \`DEN 1\`), copy that wording verbatim. Do not recalculate streaks from todo text, checkboxes, or your own arithmetic. If no explicit streak is written, say \`streak neuveden\`.
- **Duplicate-title rendering**: If 2+ relevant todos share the same title, render each one with visible plain-text ID and scheduled range, for example \`[[todo:abc-123|Pohotovost]] · id: abc-123 · 2026-03-31 → 2026-03-31\`.

### Today Workset Algorithm
Build today's workset via \`/todos\` using these buckets:

1. **Overdue** - todos with \`dueDate\` before today (deadline bucket)
2. **Due Today** - todos with \`dueDate\` today (deadline bucket)
3. **Scheduled / In Progress** - single-day todos whose \`scheduledStart\` includes today or earlier (use non-multi-day \`scheduledEnd\` ranges when available), plus non-multi-day \`in_progress\` items not already shown
4. **Multi-day Context** - todos whose \`scheduledStart\`/\`scheduledEnd\` are more than 1 local calendar day apart; show separately as context only
5. **Focused Project** - if the user says "today I want to focus mainly on Nomendex" (or another project), load that project's open todos before unrelated candidates
6. **Other Candidates** - Today/Now custom-column todos after loading real board config, then remaining open todos

Rules:
- Treat "calendar" or "schedule" as schedule/calendar queries targeting todos with \`scheduledStart\`/\`scheduledEnd\`.
- Never guess a Today column ID like \`col-today\`; load the project board config first.
- If weekly or monthly goal files are template stubs, say so explicitly and do not invent live context from them.
- Use project-note **Next Actions** only as a fallback when live todos do not provide enough operational detail.
- \`Multi-day Context\` is informational only and never belongs in the actionable workset snapshot.

### Automated Steps
1. Detect today's real daily-note path and open it only if it already exists or the user explicitly asked to create/open it
2. Pull incomplete tasks from yesterday's real daily note if one exists
3. Build today's actionable single-day todo workset using the bucket order above
4. Surface \`Multi-day Context\` separately and keep it out of the actionable workset snapshot
5. If the user names a focus project, surface that project's open todos before unrelated work
6. **Save workset snapshot** — after the workset is finalized, write only the actionable single-day todo list with \`[[todo:id|Title]]\` wiki-links into today's daily note under \`## Today's Workset\`, plus a hidden HTML comment listing the todo IDs: \`<!-- workset: todo-id1, todo-id2, todo-id3 -->\`. Never include \`Multi-day Context\` items in this snapshot. This snapshot is the evening flow's baseline for completion rate. Place it right after the \`## Today's Workset\` heading (or at the top of the note if the section doesn't exist). If the daily note hasn't been created yet, include both when creating it.
7. Read typed goal progress from Goals API first; use weekly/monthly notes only as strategic narrative context
8. Ask focus questions and propose a plan before editing anything

### Context Surfacing
Before interactive prompts, automatically surface:
- **Overdue** todos
- **Due Today** todos
- **Started / In Progress** todos
- **Multi-day Context** todos
- **Focused Project** open todos if the user named a project
- **Other Candidates** from Today/Now columns or remaining open work
- **Strategic Context** from weekly/monthly goals only when those files contain real content
- **Goal Progress** from \`POST /api/goals/list { "status": "active" }\` + \`POST /api/goals/graph { "goalId": "..." }\` for each active goal

Display as a brief context block at the top of the morning routine using \`[[todo:id|Title]]\` wiki-links (never checkboxes):
\`\`\`markdown
### Today's Context
- **Overdue:**
  - [[todo:abc-123|Fix bug from yesterday]] · [ProjectA] · high · due 3/25
- **Due Today:**
  - [[todo:def-456|Send meter reading]] · [Ops] · medium · due 3/26
- **Started / In Progress:**
  - [[todo:ghi-789|Draft reply to Tomas]] · [Work] · in_progress
- **Multi-day Context:**
  - [[todo:aaa-111|Pohotovost]] · id: aaa-111 · 2026-03-31 → 2026-04-02 · [Ops] · in_progress
- **Focused Project - Nomendex:**
  - [[todo:jkl-012|Observe BPagent and note UI bugs]] · medium
  - [[todo:mno-345|Fix kanban sorting placement]] · high
- **Other Candidates:**
  - [[todo:pqr-678|Pohotovost]] · id: pqr-678 · 2026-03-31 → 2026-03-31 · [Ops] · low
  - [[todo:qrs-679|30min run]] · [Health] · low
- **Goal Progress** (from Goals API):
  - Career & Professional: ████▢▢▢▢▢▢ 40% (rollup)
  - Health & Wellness: 12/72 tréninků (17%)
  - Personal Growth: ██▢▢▢▢▢▢▢▢ 15% (manual)
- **Strategic Context:**
  - Monthly focus: Nomendex audit + Q2 planning
  - Weekly review: template stub, no live ONE Big Thing yet
\`\`\`

### Interactive Prompts
- "What's your ONE thing for today?"
- "What might get in the way?"
- "How do you want to feel at end of day?"

### New Todo Proposals
When the morning routine reveals a need for new todos, propose them to the user for confirmation before creating via API. Never write new checkboxes in the daily note.
\`\`\`
Proposed new todos:
1. "Draft API spec" · project: MyApp · priority: high · scheduledStart: today
2. "Review chapter 3" · project: Personal · priority: medium · scheduledStart: today
Create all? (or specify which ones)
\`\`\`

### Morning Checklist
- Daily note path detected
- Today workset reviewed (overdue, due today, started, multi-day context, focused project, other candidates)
- Read-only single-day workset with \`[[todo:id|Title]]\` wiki-links written to daily note
- Workset snapshot saved (\`<!-- workset: ... -->\`)
- Yesterday's incomplete tasks reviewed
- ONE priority identified
- Time blocks set
- Potential obstacles identified

## Midday Check-in (2-3 minutes)

### Quick Review
1. Check morning task completion
2. Compare actual vs planned time use
3. Assess energy level
4. Identify afternoon priorities

### Adjustments
- Reschedule incomplete morning tasks
- Add urgent items that emerged
- Reorder by current energy level
- Note any blockers

### Midday Questions
- "How's your energy right now?"
- "What's the most important thing for this afternoon?"
- "What can you let go of today?"

## Evening Shutdown (5 minutes)

### Completion Scoring Protocol

#### Step 1: Determine today's planned workset
Read the morning workset snapshot from today's daily note:
\`<!-- workset: todo-id1, todo-id2, todo-id3 -->\`
If the snapshot exists, those IDs are the baseline ("planned today"). Before computing completion, reclassify any snapshot todo whose \`scheduledStart\`/\`scheduledEnd\` are more than 1 local calendar day apart into \`Multi-day Context\` and remove it from the planned set.
If no snapshot exists (morning flow was skipped), fall back to an API-based heuristic: single-day todos with \`dueDate\` today, \`scheduledStart\` covering today, or in a Today/Now custom column. Note in the output that the morning workset was not recorded and the completion rate may be less precise. Show multi-day scheduled todos separately as \`Multi-day Context\`.

#### Step 2: Fetch completion data
- Fetch active todos via \`/api/todos/list\`.
- Fetch archived todos via \`/api/todos/archived\`.
- Define **completed_today** as: \`status === "done"\` AND \`completedAt\` falls within today's local date (midnight to midnight). Include both active and archived todos — a todo completed today and then archived still counts.
- **CRITICAL**: Use \`completedAt\`, NOT \`updatedAt\`. A todo edited today but completed yesterday is NOT completed today.

#### Step 3: Classify ongoing vs planned
- **Planned today**: todos whose IDs appear in the morning workset snapshot, after removing anything reclassified into \`Multi-day Context\`.
- **Ongoing**: \`in_progress\` todos whose IDs are NOT in the morning workset. These are multi-day work items carried forward.
- **Multi-day Context**: todos whose \`scheduledStart\`/\`scheduledEnd\` are more than 1 local calendar day apart, regardless of whether they were previously shown in the morning snapshot.
- Ongoing todos and \`Multi-day Context\` do NOT enter the completion rate denominator or numerator. Show them in separate sections.

#### Step 4: Calculate completion rate
\`completion_rate = completed_today ∩ planned_today / |planned_today|\`
Only todos from the planned single-day workset count. Bonus completions (todos not in the morning workset but completed today) are shown separately as "Extra wins". \`Multi-day Context\` and \`Ongoing\` items never count toward the denominator or numerator.

#### Step 5: Double-check and batch actions
Present a single batch summary comparing morning workset with current API state:

\`\`\`
✓ Completed (3/7):
- [[todo:abc-123|Fix bug]] — done at 14:30
- [[todo:def-456|Send reading]] — done at 16:00
- [[todo:ghi-789|Draft reply]] — done at 17:20

⬜ Not completed (single-day planned only, 3/6):
- [[todo:jkl-012|Pohotovost]] · id: jkl-012 · 2026-03-31 → 2026-03-31 — still todo
- [[todo:pqr-678|Morava]] · id: pqr-678 · 2026-03-31 → 2026-03-31 — still todo
- [[todo:stu-901|Review PR]] — still todo

↔ Multi-day Context (not in today's rate or reschedule):
- [[todo:mno-345|Pohotovost]] · id: mno-345 · 2026-03-31 → 2026-04-03 — still in_progress

Should any of the incomplete ones be marked as done?
\`\`\`

After user responds:
- Mark confirmed todos as done via API (sets \`completedAt\`)
- For remaining incomplete single-day planned todos, propose batch reschedule:
\`\`\`
Reschedule these 3 to tomorrow (scheduledStart → YYYY-MM-DD)?
- [[todo:jkl-012|Pohotovost]] · id: jkl-012 · 2026-03-31 → 2026-03-31
- [[todo:pqr-678|Morava]] · id: pqr-678 · 2026-03-31 → 2026-03-31
- [[todo:stu-901|Review PR]]
Confirm? (or specify which ones to skip/drop)
\`\`\`
- Before each reschedule call, re-fetch that todo via \`POST /api/todos/get { todoId }\`.
- If refreshed \`status\`, \`scheduledStart\`, or \`scheduledEnd\` changed since the todo was shown, stop for that todo, show the refreshed state, and ask again.
- Execute reschedule via API only after the fresh re-check and confirmation.

#### Step 6: Legacy reconcile (optional, historical notes only)
If today's daily note contains legacy \`[x]\` checkboxes (from before API-only migration):
- Daily note \`[x]\` items with NO matching API todo → mention as ad-hoc completions: "Want to capture these as API todos?"
- Do NOT create new checkboxes. This step is read-only.

### Capture
1. Add notes and learnings to daily note (plain text, no checkboxes)
2. Log energy levels (1-10)
3. Record gratitude items

### Goal & Project Attention Summary
Automatically generate an end-of-day summary showing which goals and projects received attention:
\`\`\`markdown
### Today's Cascade Impact
- **Planned completion:** 5/7 (71.4%)
  - [Nomendex] 2/3 todos
  - [Health] 1/1 todo
  - [Work] 2/3 todos
- **Extra wins:** 1 (unplanned todo completed)
- **Ongoing (not in today's rate):** 2 in_progress
  - [[todo:abc-123|Redesign homepage]] · [Work] · day 3
  - [[todo:def-456|API refactor]] · [Nomendex] · day 5
- **Multi-day Context (not in today's rate or reschedule):** 1
  - [[todo:ghi-789|Pohotovost]] · id: ghi-789 · 2026-03-31 → 2026-04-03 · [Nomendex]
- **Rescheduled to tomorrow:** 2
  - [[todo:jkl-012|Observe UI bugs]] · [Nomendex]
  - [[todo:pqr-678|30min run]] · [Health]
- **Goals touched** (from \`resolvedGoalRefs\` on completed todos):
  - Career & Professional: 2 tasks (████▢▢▢▢▢▢ 22% overall)
  - Health & Wellness: 1 task (13/72 metric)
- **Projects advanced:** [[ProjectA]] (3 tasks), [[ProjectB]] (1 task)
- **Insight:** Focused day on Nomendex — consider closing the API refactor this week
\`\`\`

### Reflect & Prepare (parallel)
These run in parallel — reflection does not wait for reconcile to complete:

**Reflect:**
- What went well today?
- What could be better?
- What did I learn?
- What am I grateful for?

**Prepare:**
1. Identify tomorrow's priority (preview from rescheduled todos)
2. Incomplete tasks already rescheduled via API in double-check step
3. Commit changes to git (\`/push\`)

### Shutdown Checklist
- Todos double-checked with user (batch confirm done/reschedule)
- Completion rate calculated (from \`completedAt\`, not \`updatedAt\`)
- Incomplete single-day todos rescheduled to tomorrow via API after fresh \`/api/todos/get\` checks
- Reflection completed
- Tomorrow's priority identified
- Changes committed

## Daily Note Structure

Standard daily note template. The \`## Today's Workset\` section is populated by the morning routine with read-only \`[[todo:id|Title]]\` wiki-links from the API. Never write \`[ ]\` or \`[x]\` checkboxes in new daily notes.

\`\`\`markdown
# {{date}}

## Focus
> What's the ONE thing that would make today successful?

## Time Blocks
- Morning (9-12):
- Afternoon (12-5):
- Evening (5+):

## Today's Workset
<!-- workset: todo-id1, todo-id2, todo-id3 -->

**Overdue:**
- [[todo:id|Title]] · [Project] · priority · due date

**Due Today:**
- [[todo:id|Title]] · [Project] · priority

**Scheduled / In Progress:**
- [[todo:id|Title]] · [Project] · status

**Other:**
- [[todo:id|Title]] · [Project] · priority

## Notes
[Capture thoughts, meeting notes, ideas]

## Reflection
- **Wins:**
- **Challenges:**
- **Learned:**
- **Grateful for:**
- **Energy:** /10
- **Tomorrow's priority:**
\`\`\`

## Time Block Strategies

### Energy-Based
- High energy tasks in morning
- Administrative work after lunch
- Creative work when naturally alert

### Context-Based
- Batch similar tasks together
- Minimize context switching
- Protect deep work blocks

## Configuration

Detect these from the real vault instead of assuming them:
- Daily notes folder from \`vault-config.json\` or existing notes
- Template location from the mapped templates folder
- Filename pattern from existing daily notes
- Folder nesting from existing notes (flat or year/month)

### Common Filename Patterns
- \`M-D-YYYY\`
- \`YYYY-MM-DD\`
- Nested patterns such as \`daily-notes/2026/03/2026-03-16.md\`
- Reuse the user's existing convention exactly

## Task-Based Progress Tracking

The daily skill uses session tasks to show progress during multi-step routines.

### Morning Routine Tasks

Create tasks at skill start:

\`\`\`
TaskCreate:
  subject: "Inspect today's daily note"
  description: "Detect the real daily-note path and open it if it already exists"
  activeForm: "Inspecting today's daily note..."

TaskCreate:
  subject: "Fetch today's todos"
  description: "Build overdue, due-today, started, focused-project, and other-candidate buckets via /todos"
  activeForm: "Building today's todo workset..."

TaskCreate:
  subject: "Pull incomplete tasks"
  description: "Carry forward uncompleted tasks from yesterday"
  activeForm: "Pulling incomplete tasks from yesterday..."

TaskCreate:
  subject: "Save workset snapshot"
  description: "Write <!-- workset: id1, id2, ... --> into today's daily note as the evening baseline"
  activeForm: "Saving workset snapshot..."

TaskCreate:
  subject: "Surface relevant goals"
  description: "Fetch typed goal progress via Goals API, then read weekly/monthly notes only for strategic narrative context when they contain real content"
  activeForm: "Checking strategic goal context..."

TaskCreate:
  subject: "Set time blocks"
  description: "Establish time blocks based on energy and priorities"
  activeForm: "Setting time blocks..."
\`\`\`

### Dependencies

Morning routine tasks run sequentially:
\`\`\`
TaskUpdate: "Pull incomplete tasks", addBlockedBy: [inspect-daily-note-id]
TaskUpdate: "Save workset snapshot", addBlockedBy: [fetch-todos-id]
TaskUpdate: "Surface relevant goals", addBlockedBy: [pull-incomplete-tasks-id]
TaskUpdate: "Set time blocks", addBlockedBy: [surface-relevant-goals-id]
\`\`\`

### Evening Shutdown Tasks

\`\`\`
TaskCreate:
  subject: "Double-check todos"
  description: "Compare morning workset snapshot with current API state, present batch summary of completed vs incomplete"
  activeForm: "Comparing workset with current todo states..."

TaskCreate:
  subject: "Batch confirm & reschedule"
  description: "Ask user to confirm done items and reschedule incomplete todos to tomorrow via API"
  activeForm: "Processing batch confirmations..."

TaskCreate:
  subject: "Calculate completion rate"
  description: "Read morning workset snapshot, fetch active + archived todos, compute completion from completedAt, classify ongoing separately"
  activeForm: "Calculating completion rate..."

TaskCreate:
  subject: "Generate reflection prompts"
  description: "Prompt for wins, challenges, learnings, gratitude"
  activeForm: "Generating reflection prompts..."

TaskCreate:
  subject: "Prepare tomorrow's preview"
  description: "Identify tomorrow's priority from rescheduled and upcoming todos"
  activeForm: "Preparing tomorrow's preview..."
\`\`\`

### Evening Dependencies

\`\`\`
"Batch confirm & reschedule" depends on "Double-check todos" (needs the comparison data)
"Calculate completion rate" depends on "Batch confirm & reschedule" (needs final todo states after user confirms)
"Prepare tomorrow's preview" depends on "Calculate completion rate" (needs to know what's left)
"Generate reflection prompts" runs independently (can start any time)
\`\`\`

Mark each task \`in_progress\` when starting, \`completed\` when done using TaskUpdate.

Task tools provide visibility into what's happening during longer operations. Tasks are session-scoped and don't persist between BPagent sessions—your actual work items are managed exclusively through the Nomendex todos API.

## Integration

Works with:
- \`/todos\` - Fetch today's todos, update completion status
- \`/push\` - Commit end-of-day changes
- \`/weekly\` - Weekly planning uses daily notes
- \`/monthly\` - Monthly goals inform daily focus
- \`/project\` - Use project-note next-actions only as fallback when live todos are insufficient
- \`/onboard\` - Load context before planning
- Goal tracking skill - Align daily tasks to goals
- Productivity Coach - Accountability for daily routines
`,
    },
  },
  {
    name: "goal-tracking",
    files: {
      "SKILL.md": `---
name: goal-tracking
description: Track progress across the typed goal hierarchy (vision/yearly/quarterly/monthly), surface stalled goals, and connect projects/todos via goalRef and resolvedGoalRefs. Use for goal reviews and progress tracking.
version: 6
source: nomendex
---

# Goal Tracking Skill

Track and manage the cascading goal system from long-term vision to daily tasks.

## Goal Hierarchy (Typed Store)

\`\`\`
GoalRecord store (.nomendex/goals/)    ← source of truth
  vision → yearly → quarterly → monthly (parentGoalId chain)
      ↓ goalRef
  ProjectConfig (.nomendex/projects.json)
      ↓ resolvedGoalRefs
  Todos (.nomendex/todos/)

Mirror notes (Goals/goals/*.md) = readable/editable views
Dashboards (Goals/0-2.md) = generated summaries
\`\`\`

## Goal-to-Todo Bridge (Typed)

Linkage is through typed fields only:
1. \`project.goalRef\` → single goal ID
2. \`todo.goalRefs\` → explicit goal override (optional)
3. \`todo.resolvedGoalRefs\` → computed snapshot (goalRefs or inherited from project.goalRef)

Do NOT infer goal-todo mappings from title similarity or text content.

## Progress Calculation (per progressMode)

| Mode | Formula | Example |
|------|---------|---------|
| \`rollup\` | Average of child goal progress (leaf-only: goals with children count ONLY children) | Career yearly = avg(Q1, Q2, Q3, Q4) |
| \`metric\` | \`progressCurrent / progressTarget * 100\` | 12/72 tréninků = 17% |
| \`manual\` | \`progressValue\` (0-100, set by user/agent) | Rekonstrukce = 15% |
| \`milestone\` | Completed child goals / total child goals | 2/4 quarterly milestones = 50% |

Use \`/api/goals/graph\` to get computed progress — never calculate manually from markdown.

## Common Operations (API-first)

### View Goal Progress
1. \`POST /api/goals/list { "status": "active" }\` — get all active goals
2. \`POST /api/goals/graph { "goalId": "..." }\` — get full graph per goal (children, projects, todos, computed progress)
3. Display progress per progressMode format

### Update Goal Status
1. \`POST /api/goals/update { "goalId": "...", "updates": { "status": "completed" } }\`
2. For metric: \`"updates": { "progressCurrent": 15 }\`
3. For manual: \`"updates": { "progressValue": 25 }\`
4. After updates: \`POST /api/goals/sync/dashboards\` to regenerate views

### Create New Goal
\`POST /api/goals/create { "title": "...", "area": "...", "horizon": "monthly", "progressMode": "rollup", "parentGoalId": "..." }\`

### Surface Stalled Goals
1. Fetch all active goals
2. Check \`updatedAt\` — flag goals with no updates in 14+ days
3. Check linked todos — goals whose linked projects have no open todos = missing actions

## Progress Report Format

\`\`\`markdown
## Goal Progress Report (from /api/goals/graph)

### Cascade Overview
| Area | Vision | Yearly | Quarterly | Monthly |
|------|--------|--------|-----------|---------|
| Career | ██▢▢▢ 20% | Nomendex: 20% (rollup) | Q2 Launch: 0/4 (milestone) | April: 0% |
| Health | █▢▢▢▢ 5% | Movement: 12/72 (metric) | — | March: 2/6 (metric) |

### By Goal (yearly, with children)
| Goal | Progress | Mode | Projects | Open Todos |
|------|----------|------|----------|------------|
| Nomendex v produkci | 20% | rollup | Nomendex (goalRef) | 12 open |
| Pohybový návyk | 17% | metric (12/72) | Health (goalRef) | 3 open |

### Orphan Goals (no linked project)
- "Online kurz" — no project with goalRef pointing here

### Goals Needing Attention
- **Pohybový návyk:** 12/72 = behind pace (should be ~18 by now)
- **Freelance zakázka:** 0% progress, no linked todos

### Recommended Focus
1. [Stalled goal needs attention]
2. [Nearly complete goal - finish it]
3. [Orphan goal needs a project]
\`\`\`

## Integration Points

- \`/api/goals/*\`: All goal CRUD and progress queries
- \`/api/goals/graph\`: Full cascade for any goal
- \`/api/goals/sync/dashboards\`: Regenerate aggregated markdown views
- \`/weekly\` review: Goal progress assessment with typed data
- \`/daily\` planning: Surface goal progress context
- \`/monthly\` review: Quarterly milestone check, next month goal creation
`,
    },
  },
  {
    name: "monthly",
    files: {
      "SKILL.md": `---
name: monthly
description: Monthly review and planning. Roll up weekly reviews, check quarterly milestones, set next month's focus. Use at end of month or start of new month.
version: 5
source: nomendex
---

# Monthly Review Skill

Facilitates monthly review and planning by rolling up weekly reviews, checking quarterly milestones, and setting next month's focus.

## Usage

\`\`\`
/monthly              # Run monthly review for current month
\`\`\`

Or ask:
- "Help me with my monthly review"
- "Plan next month"
- "How did this month go?"

## What This Skill Does

1. **Fetches monthly goal data** via \`/api/goals/list\` and \`/api/goals/graph/forest\`
2. **Rolls up weekly reviews** from the past month
3. **Checks quarterly milestones** via typed goal hierarchy
4. **Plans next month's** focus areas and priorities

## Data Sources

### Primary: Typed API (source of truth)
- Monthly goals: \`POST /api/goals/list { "horizon": "monthly", "status": "active" }\`
- Full goal forest with progress: \`POST /api/goals/graph/forest {}\`
- Quarterly goals: \`POST /api/goals/list { "horizon": "quarterly", "status": "active" }\`
- Yearly goals: \`POST /api/goals/list { "horizon": "yearly", "status": "active" }\`
- Projects: \`POST /api/projects/list {}\`

### Secondary: Markdown narrative
- Weekly reviews (\`Goals/3. Weekly Review.md\` or weekly review notes)
- Daily notes from past 30 days

**Important:** \`Goals/2. Monthly Goals.md\` is a generated-only dashboard — never read it as an editable source and never write to it directly. Use the API to manage goals, then call \`POST /api/goals/sync/dashboards {}\` to regenerate dashboards.

## Todo Safety Rules
- **Reschedule freshness**: Before any reschedule or update of an existing todo, call \`POST /api/todos/get\` with the todo ID immediately before \`update\`. Do not rely on stale \`/api/todos/list\` data. If \`status\`, \`scheduledStart\`, or \`scheduledEnd\` changed since the todo was shown to the user, stop, show the refreshed state, and ask again.
- **Multi-day context**: If \`scheduledStart\` and \`scheduledEnd\` are more than 1 local calendar day apart, classify the todo as \`Multi-day context\`. Show it separately, do not include it in \`Today's Workset\`, \`<!-- workset: ... -->\`, completion-rate math, or batch reschedule.
- **Streak authority**: If the latest relevant daily note explicitly states a streak (for example \`DEN 1\`), copy that wording verbatim. Do not recalculate streaks from todo text, checkboxes, or your own arithmetic. If no explicit streak is written, say \`streak neuveden\`.
- **Duplicate-title rendering**: If 2+ relevant todos share the same title, render each one with visible plain-text ID and scheduled range, for example \`[[todo:abc-123|Pohotovost]] · id: abc-123 · 2026-03-31 → 2026-03-31\`.

## Review Process

### Phase 1: Collect Monthly Data (10 minutes)

1. Read all weekly reviews from the past month (\`Goals/3. Weekly Review.md\` or weekly review notes)
2. Read daily notes from past 30 days (scan for patterns)
3. Fetch todos data for past month via \`/todos\` skill
4. Fetch current monthly goals via \`POST /api/goals/list { "horizon": "monthly", "status": "active" }\`
5. Fetch project status via \`POST /api/projects/list {}\`

**Extract:**
- Wins from each week
- Challenges and recurring blockers
- Todo completion rates by project
- Monthly todo patterns (total completed, overdue, blocked)
- Goal progress from API (\`computedProgress\` per goal)
- Project milestones completed
- Habits tracked (completion rates)
- Explicit streak labels from the latest relevant daily note, copied verbatim

### Phase 2: Reflect on Month (10 minutes)

1. Fetch quarterly milestones via \`POST /api/goals/list { "horizon": "quarterly", "status": "active" }\`
2. Fetch yearly goals via \`POST /api/goals/list { "horizon": "yearly", "status": "active" }\`
3. Use \`POST /api/goals/graph/forest {}\` for full progress overview
4. Calculate which quarter we're in and check milestone progress
5. Identify patterns across weeks (energy, productivity, focus areas)
6. Compare planned vs actual outcomes

**Generate:**
- Monthly accomplishment summary
- Quarterly milestone progress check (from API data)
- Pattern analysis (what worked, what didn't)
- Goal alignment assessment

### Phase 3: Plan Next Month (10 minutes)

1. Identify next month's quarterly milestones from goal forest
2. Surface projects that need attention (via \`/api/projects/list\`)
3. Set next month's primary focus (ONE thing)
4. Define 3-tier priorities (must/should/nice-to-have)
5. Plan habits to build or maintain

**Write:**
- Create new monthly goals via \`POST /api/goals/create { horizon: "monthly", ... }\` or update existing via \`POST /api/goals/update\`
- Set specific weekly milestones for the month ahead
- Call \`POST /api/goals/sync/dashboards {}\` to regenerate \`Goals/2. Monthly Goals.md\` and other dashboards

## Output Format

\`\`\`markdown
## Monthly Review: [Month Year]

### Month Summary
- Weeks reviewed: 4
- Daily notes analyzed: [N]
- Projects active: [N]

### Wins
1. [Major accomplishment]
2. [Progress milestone]
3. [Habit success]

### Challenges
1. [Recurring blocker]
2. [Missed target]

### Patterns
- **Energy:** [When were you most productive?]
- **Focus:** [What got the most attention?]
- **Gaps:** [What was consistently avoided?]

### Todo Metrics
| Project | Completed | Total | Rate | Trend |
|---------|-----------|-------|------|-------|
| Nomendex | 45 | 60 | 75% | ↗️ +10% |
| Health | 8 | 24 | 33% | ↘️ -5% |
| Work | 30 | 40 | 75% | → stable |

**Insights:**
- Total todos completed: 83
- Average completion rate: 61%
- Best performing: Nomendex (improving scoping)
- Needs attention: Health (overcommitting, break into smaller todos)

### Goal Progress (from \`/api/goals/graph\`)
| Goal | Progress | Mode | Delta |
|------|----------|------|-------|
| Nomendex v produkci | 20% | rollup | +5% |
| Pohybový návyk | 12/72 | metric | +8 |
| Denní review streak | DEN 1 | manual | from latest daily note |

### Quarterly Milestone Check (from \`/api/goals/list { "horizon": "quarterly" }\`)
| Milestone | Goal ID | Status | Progress |
|-----------|---------|--------|----------|
| Q2 Launch | goal-xxx | active | 0/4 milestone |
| Q1 Audit | goal-yyy | active | 2/3 milestone |

### Project Status
| Project | Progress | Status | Next Month Focus |
|---------|----------|--------|-----------------|
| [Project 1] | 60% | Active | [Key deliverable] |

### Next Month Plan

**ONE Focus:** [Primary objective]

**Must Complete:**
1. [Non-negotiable deliverable]
2. [Critical milestone]
3. [Key commitment]

**Should Complete:**
1. [Important but flexible]
2. [Supporting goal]

**Nice to Have:**
1. [Stretch goal]

**Weekly Milestones:**
- Week 1: [Focus]
- Week 2: [Focus]
- Week 3: [Focus]
- Week 4: [Focus + monthly review]

### Wellbeing Check
- Physical Health: /10
- Mental Health: /10
- Relationships: /10
- Work Satisfaction: /10
- Overall: /10

### Questions to Consider
- "What would make next month feel truly successful?"
- "What commitment should you drop or delegate?"
- "Which goal needs a different approach?"
\`\`\`

## Data Sources

**Primary (typed store via API):**
- \`/api/goals/list\` — all goals by horizon, status, area
- \`/api/goals/graph\` — per-goal progress with children, projects, todos
- \`/api/projects/list\` — projects with goalRef
- \`/api/todos/list\` — todos with resolvedGoalRefs

**Secondary (markdown for narrative context):**
- Weekly Review notes — for qualitative reflection rollup
- Daily notes — for pattern analysis
- Mirror notes are synced views, not primary data

## Task-Based Progress Tracking

### Monthly Review Tasks
\`\`\`
TaskCreate:
  subject: "Phase 1: Collect monthly data"
  description: "Read weekly reviews, daily notes, todos data, and project files from past month"
  activeForm: "Collecting monthly data..."

TaskCreate:
  subject: "Fetch monthly todos"
  description: "Load all todos from past month via /todos skill for completion analysis"
  activeForm: "Fetching monthly todo metrics..."

TaskCreate:
  subject: "Phase 2: Reflect on month"
  description: "Analyze patterns, check quarterly milestones, assess goal alignment, review todo trends"
  activeForm: "Reflecting on monthly patterns..."

TaskCreate:
  subject: "Phase 3: Plan next month"
  description: "Set focus, define priorities, establish weekly milestones, plan todo capacity"
  activeForm: "Planning next month..."

TaskCreate:
  subject: "Write monthly review note"
  description: "Generate and save the monthly review document"
  activeForm: "Writing monthly review..."
\`\`\`

### Dependencies
\`\`\`
TaskUpdate: "Phase 2: Reflect", addBlockedBy: [phase-1-id]
TaskUpdate: "Phase 3: Plan", addBlockedBy: [phase-2-id]
TaskUpdate: "Write monthly review", addBlockedBy: [phase-3-id]
\`\`\`

Mark each task \`in_progress\` when starting, \`completed\` when done.

## Integration

Works with:
- \`/todos\` - Fetch monthly todo metrics for trend analysis
- \`/weekly\` - Monthly review rolls up weekly reviews
- \`/goal-tracking\` - Quarterly milestone progress
- \`/project status\` - Project progress feeds monthly assessment
- \`/daily\` - Next month's plan informs daily priorities
- \`/push\` - Commit after completing review
`,
    },
  },
  {
    name: "obsidian-vault-ops",
    files: {
      "SKILL.md": `---
name: obsidian-vault-ops
description: Read and write Obsidian vault files, manage wiki-links, process markdown with YAML frontmatter. Use when working with vault file operations, creating notes, or managing links.
version: 4
source: nomendex
---

# Obsidian Vault Operations Skill

Core operations for reading, writing, and managing files in an Obsidian vault.

## Vault Structure

\`\`\`
vault-root/
├── vault-config.json   # Optional folder mapping + personalization
├── [daily notes folder]  # Detect real folder name, nesting, and filename pattern
├── Goals/              # Dashboards (0-2), Weekly Review, and per-goal mirrors (goals/)
├── Projects/           # Canonical project notes (*.md)
├── Templates/          # Reusable note structures
└── Archives/           # Completed/inactive content
\`\`\`

## File Operations

### Reading Notes
- Use Glob to find files: \`*.md\` plus the detected daily-notes folder
- Read \`vault-config.json\` first if present (folder mapping + preferences)
- Read project context from \`Projects/*.md\`
- Check for wiki-links to related notes

### Creating Notes
1. Check if note already exists
2. Use appropriate template if available
3. Add YAML frontmatter with date and tags
4. Insert wiki-links to related notes

### Editing Notes
- Preserve YAML frontmatter structure
- Maintain existing wiki-links
- Use consistent heading hierarchy
- Apply standard tag format

## Wiki-Link Format

\`\`\`markdown
[[Note Name]]                    # Simple link
[[Note Name|Display Text]]       # Link with alias
[[Note Name#Section]]            # Link to section
\`\`\`

## YAML Frontmatter

Standard frontmatter structure:
\`\`\`yaml
---
date: 2024-01-15
tags: [tag1, tag2]
status: active
---
\`\`\`

## Template Variables

When processing templates, replace:
- \`{{date}}\` - Today's date using the vault's existing convention
- \`{{date:format}}\` - Formatted date
- \`{{date-1}}\` - Yesterday
- \`{{date+1}}\` - Tomorrow
- \`{{time}}\` - Current time

**CRITICAL — Daily note navigation links**: When a template contains wiki links to adjacent daily notes (e.g. \`[[{{yesterday}}]]\` or \`[[{{tomorrow}}]]\`), always include the full subfolder path in the resolved link. For example, if daily notes live in \`daily-notes/\`, the resolved link must be \`[[daily-notes/3-21-2026]]\`, NOT \`[[3-21-2026]]\`. A bare filename without the folder prefix cannot be resolved to the correct file and will create a broken or duplicate note.

## Common Patterns

### Daily Note Creation
1. Read \`vault-config.json\` first if present
2. Detect the daily-notes folder, nesting, and filename pattern from existing notes
3. Check if today's detected note path exists
4. If not, read the appropriate daily template
5. Replace template variables without changing the vault's existing naming convention
6. Write to the detected daily-note path rather than a hardcoded folder

### Finding Related Notes
1. Extract key terms from current note
2. Search vault for matching content
3. Suggest wiki-links to related notes

### Tag Operations
- Priority: \`#priority/high\`, \`#priority/medium\`, \`#priority/low\`
- Status: \`#active\`, \`#waiting\`, \`#completed\`, \`#archived\`
- Context: \`#work\`, \`#personal\`, \`#health\`, \`#learning\`

## Best Practices

1. Always check \`vault-config.json\` first for vault-specific conventions and folder mapping
2. Preserve existing structure when editing
3. Use relative paths for internal links
4. Add frontmatter to new notes
5. Link to relevant goals when creating tasks
6. Never assume \`daily-notes/\`, \`Daily Notes/\`, \`M-D-YYYY\`, or \`YYYY-MM-DD\`; detect first
`,
    },
  },
  {
    name: "project",
    files: {
      "SKILL.md": `---
name: project
description: Create, track, and archive projects linked to goals using Nomendex Projects API and canonical project markdown notes. Use for project lifecycle management, status dashboards, and project note synchronization.
version: 5
source: nomendex
---

# Project Skill

Manage projects using a single source of truth:
- Project entity and board config in \`.nomendex/projects.json\` via \`/api/projects/*\`
- Canonical project note in \`Projects/<ProjectName>.md\` (auto-managed by backend via mirror sync)

Projects are the bridge between strategic goals and operational todos:
\`GoalRecord (goalRef) → ProjectConfig → Todos (resolvedGoalRefs)\`

For day planning, live open todos are the primary operational source.
Use the project note's **Next Actions** section only as fallback context when the todo list is missing or underspecified.

## Usage

\`\`\`
/project              # Interactive: create new project or view status
/project new          # Create a new project
/project status       # Dashboard of all active projects
/project archive <name>  # Archive a completed project
\`\`\`

## Commands

### \`/project\` or \`/project new\`

Creates a project entity and canonical project note.

**Steps:**
1. Fetch available goals via \`POST /api/goals/list { "horizon": "yearly", "status": "active" }\`
2. Ask user which goal this project supports (or "none" for standalone)
3. Ask for project name
4. Call \`/api/projects/list\` and reuse existing project if name matches (case-insensitive)
5. If not found, call \`/api/projects/create\` (send \`X-Nomendex-UI: true\`)
6. If linked to a goal, set the link via \`POST /api/projects/update { "projectId": "...", "updates": { "goalRef": "<goalId>" } }\`
7. Read created project via \`/api/projects/get-by-name\` and confirm \`projectNoteFile\`
8. Call \`POST /api/goals/sync/dashboards {}\` to regenerate goal dashboards with the new project link

**Note:** The goal link is stored as \`goalRef\` (typed goal ID) on the project entity, NOT as a \`Supports:\` wiki-link in markdown. The mirror sync system will automatically reflect the link in the project's canonical note.

**Canonical Project Note Template (\`Projects/<ProjectName>.md\`):**
\`\`\`markdown
# Project: <Name>

## Overview
[Brief description of what this project achieves]

## Status
- **Phase:** Planning | Active | Review | Complete
- **Progress:** 0%
- **Todo Completion:** 0/0 (0%)

## Milestones
- [ ] <Milestone 1>

## Active Todos
(Fetched from Nomendex via /todos skill)
- [ ] <Highest-priority open todo>
- [ ] <Due or in-progress todo>

## Blocked Todos
- [ ] <Blocked todo> (blocked by: <reason>)

## Next Actions
- [ ] <First concrete step>
- [ ] <Second step>

## Decisions
- [Decision 1] - [Date] - [Rationale]

## Log
[Running log of updates, blockers, learnings]
\`\`\`

### \`/project status\`

Builds a dashboard from Projects API, Goals API, and todos.

**Steps:**
1. Call \`POST /api/projects/list {}\` (include archived if user asks)
2. For each project with a \`goalRef\`, call \`POST /api/goals/graph { "goalId": "<goalRef>" }\` for goal progress
3. Fetch todos for each project via \`/todos\` skill
4. Calculate todo completion rate per project
5. Load project note via \`/api/notes/get\` for narrative context (Next Actions, Log) only
6. Display dashboard table

**Output Format:**
\`\`\`markdown
## Project Dashboard

| Project | Phase | Goal Progress | Todos | Goal | Next Action |
|---------|-------|---------------|-------|------|-------------|
| ProjectA | Active | 60% (rollup) | 12/20 (60%) | Goal Title | Review PR |
| ProjectB | Planning | 10% (manual) | 0/5 (0%) | Goal Title | Draft spec |

### Summary
- Active projects: N
- Total progress (weighted): X%
- Projects without goalRef: [list]
- Stalled projects (no update in 14+ days): [list]
- Projects with blocked todos: [list]
\`\`\`

### \`/project archive <name>\`

Archives project via project API lifecycle.

**Steps:**
1. Load project via \`/api/projects/get-by-name\`
2. Confirm with user before archiving
3. Call \`/api/projects/update\` with \`updates: { archived: true }\`
4. Backend auto-moves canonical note from \`Projects/\` to \`Archives/Projects/\`
5. Update goal references to mark completion if needed
6. Call \`POST /api/goals/sync/dashboards {}\` to regenerate dashboards
7. Report archived location and summary

## Project Naming Conventions

- Use clear human-readable project names (canonical note path is normalized automatically)
- Keep names concise but descriptive
- Avoid special characters

## Cascade Integration

Projects are the critical middle layer in the typed store:

\`\`\`
GoalRecord store (.nomendex/goals/)  <- "What I want to achieve" (source of truth)
    | goalRef
    v
ProjectConfig (.nomendex/projects.json)  <- "How I'll achieve it"
    | resolvedGoalRefs (inherited)
    v
Todos (.nomendex/todos/)             <- "What I'm doing today"

Mirror notes (Goals/goals/*.md, Projects/*.md) = readable/editable views
Dashboards (Goals/0-2.md) = generated summaries
\`\`\`

## Task-Based Progress Tracking

### New Project Tasks
\`\`\`
TaskCreate:
  subject: "Fetch yearly goals"
  description: "Load goals via /api/goals/list for project linking"
  activeForm: "Fetching yearly goals..."

TaskCreate:
  subject: "Create project entity"
  description: "Create project in projects.json via /api/projects/create"
  activeForm: "Creating project..."

TaskCreate:
  subject: "Sync canonical note"
  description: "Confirm projectNoteFile exists and contains lifecycle sections"
  activeForm: "Syncing project note..."
\`\`\`

### Status Dashboard Tasks
\`\`\`
TaskCreate:
  subject: "Load projects"
  description: "Fetch project entities and note paths from /api/projects/list"
  activeForm: "Loading projects..."

TaskCreate:
  subject: "Read canonical notes"
  description: "Load project note sections from Projects/*.md"
  activeForm: "Reading project notes..."

TaskCreate:
  subject: "Fetch project todos"
  description: "Load todos for each project via /todos skill"
  activeForm: "Fetching project todos..."

TaskCreate:
  subject: "Generate dashboard"
  description: "Compile status dashboard from API + project notes + todos"
  activeForm: "Generating project dashboard..."
\`\`\`

Mark each task \`in_progress\` when starting, \`completed\` when done.

## Integration

Works with:
- \`/todos\` - Fetch and display project todos, calculate completion rates
- \`/daily\` - Use live project todos first; surface project next-actions only as fallback
- \`/weekly\` - Project status in weekly review
- \`/goal-tracking\` - Project progress feeds goal calculations
- \`/onboard\` - Discover and load project context
- \`/push\` - Commit project changes
`,
    },
  },
  {
    name: "review",
    files: {
      "SKILL.md": `---
name: review
description: Smart review router. Detects context (morning, Sunday, end of month) and launches the appropriate review workflow. Use anytime for the right review at the right time.
version: 2
source: nomendex
---

# Review Skill

Smart router that detects context and launches the appropriate review workflow.

## Usage

\`\`\`
/review           # Auto-detect the right review based on time/context
/review daily     # Force daily review
/review weekly    # Force weekly review
/review monthly   # Force monthly review
\`\`\`

Or simply: "Help me review" — and the right workflow starts.

## Auto-Detection Logic

When invoked without arguments, detect context using these rules:

### 1. Check the Time of Day

\`\`\`bash
HOUR=$(date +%H)
\`\`\`

- **Before noon (< 12):** Morning routine — delegate to \`/daily\` morning workflow
- **After 5 PM (>= 17):** Evening shutdown — delegate to \`/daily\` evening workflow
- **Midday (12-17):** Midday check-in — delegate to \`/daily\` midday workflow

### 2. Check the Day of Week

\`\`\`bash
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
\`\`\`

- **Sunday (7) or Monday (1):** Weekly review — delegate to \`/weekly\`
  - Override time-of-day detection
  - Ask: "Ready for your weekly review?" before proceeding

### 3. Check the Day of Month

\`\`\`bash
DAY_OF_MONTH=$(date +%d)
DAYS_IN_MONTH=$(date -v+1m -v1d -v-1d +%d 2>/dev/null || date -d "$(date +%Y-%m-01) +1 month -1 day" +%d)
\`\`\`

- **Last 3 days of month (DAY_OF_MONTH >= DAYS_IN_MONTH - 2):** Monthly review — delegate to \`/monthly\`
  - Override both time-of-day and day-of-week detection
  - Ask: "End of month — ready for your monthly review?" before proceeding

- **First day of month (DAY_OF_MONTH == 1):** Also suggest monthly review
  - "It's the first of the month. Want to do your monthly review for last month?"

### 4. Check Staleness

Before routing, check for overdue reviews:

\`\`\`bash
# Read weekly review file for last date
WEEKLY_REVIEW="Goals/3. Weekly Review.md"
# If last weekly review > 7 days ago, suggest weekly regardless of day
\`\`\`

- **Weekly review overdue (>7 days):** Suggest weekly review
  - "Your last weekly review was N days ago. Want to catch up?"
  - If user says no, fall through to time-of-day detection

## Routing Behavior

After detecting context:

1. Tell the user what was detected: "It's Sunday evening — launching your weekly review."
2. Delegate to the appropriate skill's workflow
3. The delegated skill handles everything from there

### Delegation

This skill does NOT duplicate the logic of \`/daily\`, \`/weekly\`, or \`/monthly\`. It:
1. Detects context
2. Informs the user
3. Follows the instructions from the target skill's SKILL.md

### Explicit Override

If the user specifies a type (\`/review weekly\`), skip auto-detection entirely and go directly to that review type.

## Output on Detection

\`\`\`markdown
### Review Router

**Time:** 7:15 AM (Morning)
**Day:** Sunday
**Month day:** 15th

**Detected:** Weekly review (Sunday override)
**Last weekly review:** 3 days ago (not overdue)

Launching weekly review...
\`\`\`

## Edge Cases

- **Multiple triggers** (e.g., last Sunday of month): Monthly takes priority over weekly
- **No daily note exists**: Ask the user — "Today's daily note doesn't exist yet. Want me to create it before continuing with the review?" Do NOT auto-create.
- **User says "no" to suggestion**: Fall through to next detection level
- **Explicit argument overrides everything**: \`/review monthly\` runs monthly review even on a Tuesday morning

## Integration

Works with:
- \`/daily\` — Morning, midday, and evening routines
- \`/weekly\` — Full weekly review process
- \`/monthly\` — Monthly review and planning
- Session init hook — Staleness data already calculated
`,
    },
  },
  {
    name: "search",
    files: {
      "SKILL.md": `---
name: search
description: Search vault content by keyword using Grep. Zero dependencies — works in any vault without indexes or plugins. Groups results by directory for easy scanning.
version: 2
source: nomendex
---

# Search Skill

Fast keyword search across all vault markdown files using the Grep tool. No indexes, no plugins, no setup — just structured search with directory grouping.

## Usage

\`\`\`
/search <term>
\`\`\`

Examples:
- \`/search project planning\`
- \`/search weekly review\`
- \`/search TODO\`

## How to Execute

When the user invokes \`/search <term>\`:

### Step 1: Search for the term

Use the **Grep** tool to search all \`.md\` files for the term:

\`\`\`
Grep:
  pattern: <search term>
  glob: "*.md"
  output_mode: content
  -n: true
  -C: 1
\`\`\`

Exclude hidden directories (\`.claude/\`, \`.obsidian/\`) and templates:

\`\`\`
Grep:
  pattern: <search term>
  glob: "*.md"
  path: .
  output_mode: content
  -n: true
  -C: 1
\`\`\`

Filter out results from \`.claude/\`, \`.obsidian/\`, and \`Templates/\` directories.

### Step 2: Group results by directory

Organise matches into sections by their parent directory:

- **daily-notes/** — journal entries
- **Goals/** — goal and vision documents
- **Projects/** — project notes
- **Archives/** — archived content
- **Inbox/** — unprocessed items
- **(root)** — top-level notes

### Step 3: Present results

Format output as:

\`\`\`markdown
## Search: "<term>"

### daily-notes/
- **2024-01-15.md** (line 23): ...matching context...
- **2024-01-14.md** (line 8): ...matching context...

### Projects/
- **Project Alpha.md** (line 45): ...matching context...

### Goals/
- **2024 Goals.md** (line 12): ...matching context...

**Found X matches across Y files**
\`\`\`

### Step 4: Suggest related content

After showing results, check if any matched files contain \`[[wiki-links]]\` to other notes. If so, briefly mention:

\`\`\`
💡 Related notes mentioned in results: [[Note A]], [[Note B]]
\`\`\`

## No Results

If no matches are found:
1. Suggest alternative search terms (synonyms, related words)
2. Offer to search with case-insensitive matching if the original search was case-sensitive
3. Suggest checking \`Archives/\` if not already included

## Tips

- Search is case-sensitive by default. Add \`-i: true\` to the Grep call for case-insensitive search
- Use regex patterns for advanced searches: \`task.*complete\`, \`#tag-name\`
- Combine with \`/daily\` to quickly find when something was mentioned
`,
    },
  },
  {
    name: "weekly",
    files: {
      "SKILL.md": `---
name: weekly
description: Facilitate weekly review process with reflection, goal alignment, and planning. Create review notes, analyze past week, plan next week. Use on Sundays or whenever doing weekly planning.
version: 8
source: nomendex
---

# Weekly Review Skill

Facilitates your weekly review process by creating a review note and guiding reflection on the past week while planning the next.

## Usage

Invoke with \`/weekly\` or ask BPagent to help with your weekly review.

\`\`\`
/weekly
\`\`\`

## What This Skill Does

1. **Creates Weekly Review Note**
   - Uses weekly review template
   - Names it with current week's date
   - Places in Goals folder

2. **Guides Review Process**
   - Reviews last week's accomplishments
   - Analyzes todos completion and patterns via \`/todos\` skill
   - Identifies incomplete tasks
   - Plans upcoming week
   - Aligns with typed goals (monthly/quarterly/yearly) via Goals API

3. **Automates Housekeeping**
   - Archives old daily notes
   - Updates project statuses
   - Cleans up completed and stale todos

## Todo Safety Rules
- **Reschedule freshness**: Before any reschedule or update of an existing todo, call \`POST /api/todos/get\` with the todo ID immediately before \`update\`. Do not rely on stale \`/api/todos/list\` data. If \`status\`, \`scheduledStart\`, or \`scheduledEnd\` changed since the todo was shown to the user, stop, show the refreshed state, and ask again.
- **Multi-day context**: If \`scheduledStart\` and \`scheduledEnd\` are more than 1 local calendar day apart, classify the todo as \`Multi-day context\`. Show it separately, do not include it in \`Today's Workset\`, \`<!-- workset: ... -->\`, completion-rate math, or batch reschedule.
- **Streak authority**: If the latest relevant daily note explicitly states a streak (for example \`DEN 1\`), copy that wording verbatim. Do not recalculate streaks from todo text, checkboxes, or your own arithmetic. If no explicit streak is written, say \`streak neuveden\`.
- **Duplicate-title rendering**: If 2+ relevant todos share the same title, render each one with visible plain-text ID and scheduled range, for example \`[[todo:abc-123|Pohotovost]] · id: abc-123 · 2026-03-31 → 2026-03-31\`.

## Review Process Steps

### Step 1: Reflection (10 minutes)
- Review daily notes from past week
- Fetch all todos via \`/todos\` skill (project, status, \`scheduledStart\`/\`scheduledEnd\`, dueDate, priority)
- Calculate todo completion rate by project while keeping \`Multi-day Context\` separate from day-level completion math
- Identify wins and challenges
- Capture lessons learned
- Copy any explicit streak wording from the latest relevant daily note verbatim

### Step 2: Goal Alignment + Project Rollup (10 minutes)
- Fetch goal progress from \`/api/goals/list\` with \`{ "status": "active" }\` and \`/api/goals/graph\` for each
- Display progress per progressMode (rollup %, metric current/target, manual %, milestone count)
- Map project progress via \`goalRef\` (from \`/api/projects/get\`) to their linked goals
- Identify overdue and blocked todos
- Adjust weekly priorities based on goal progress gaps
- When creating todos for next week, set \`goalRefs\` if the todo serves a goal not covered by the project's \`goalRef\`
- Compile project progress table with goalRef link for the review note

### Step 3: Planning (10 minutes)
- Set ONE big thing for the week
- Review and triage uncompleted single-day todos (archive/delete/carry over) while showing multi-day scheduled todos as context only
- Plan todo distribution for next week by day
- Include project next-actions when planning week
- Schedule important tasks
- Block time for deep work

## Interactive Prompts

The skill guides you through:

1. **"What were your top 3 wins this week?"**
   - Celebrates progress
   - Builds momentum
   - Documents achievements

2. **"What were your main challenges?"**
   - Identifies obstacles
   - Plans solutions
   - Learns from difficulties

3. **"What's your ONE big thing next week?"**
   - Forces prioritization
   - Creates focus
   - Drives meaningful progress

## Weekly Review Checklist

- Review all daily notes
- Fetch and analyze todos via \`/todos\` skill
- Calculate todo completion rates by project
- Identify overdue and blocked todos
- Keep multi-day scheduled todos in a separate context section, not carry-forward or daily-rate math
- Process inbox items
- Update project statuses
- Check upcoming scheduled todos via \`scheduledStart\`/\`scheduledEnd\` (and external calendar only if explicitly available)
- Review monthly goals from API (plus weekly-note narrative context)
- Copy streak values from the latest relevant daily note verbatim; do not derive them from todo text or checkbox arithmetic
- Plan next week's priorities
- Propose new todos and todo distribution for next week (batch confirm with user, then create/update via API)
- Block time for important work
- Clean digital workspace
- Archive completed todos via API (batch confirm with user)
- Commit changes to Git

## Weekly Review Note Format

All todo references use \`[[todo:id|Title]]\` wiki-links. Never write \`[ ]\`/\`[x]\` checkboxes — todo state is managed exclusively through the API.

\`\`\`markdown
# Weekly Review: YYYY-MM-DD

## Last Week's Wins
1.
2.
3.

## Challenges & Lessons
- Challenge:
- Lesson:

## Todo Analysis
### Completion by Project
| Project | Completed | Total | Rate |
|---------|-----------|-------|------|
| [[ProjectA]] | 12 | 20 | 60% |
| [[ProjectB]] | 0 | 5 | 0% |

### Overdue Todos
- [[todo:abc-123|Pohotovost]] · id: abc-123 · 2026-03-10 → 2026-03-10 · [ProjectA] · high
- [[todo:def-456|Pohotovost]] · id: def-456 · 2026-03-12 → 2026-03-12 · [ProjectB] · medium

### Blocked Todos
- [[todo:ghi-789|Deploy to prod]] · [ProjectA] · blocked by: payment gateway

### Multi-day Context
- [[todo:mno-345|Morava]] · id: mno-345 · 2026-03-11 → 2026-03-14 · [ProjectB] · context only

### Today Column Patterns
- Average "Today" todos: 8/day
- Completion rate: 5/8 (62.5%)
- **Insight:** Overcommitting by ~3 todos/day

## Goal Progress (from \`/api/goals/graph\`)
### Yearly Goals
| Area | Goal | Progress | Mode |
|------|------|----------|------|
| Career & Professional | Nomendex v produkci | ████▢▢▢▢▢▢ 20% | rollup |
| Health & Wellness | Pohybový návyk | 12/72 tréninků (17%) | metric |
| Personal Growth | Denní review streak | DEN 1 (from latest daily note) | manual |

### This Week's Goal Contribution (from \`resolvedGoalRefs\` on completed todos)
- Career & Professional: 5 todos completed → +3% progress
- Health & Wellness: 2 todos completed → 14/72 metric

## Project Progress
| Project | Phase | Progress | Next Action |
|---------|-------|----------|-------------|
| [[ProjectA]] | Active | 60% | goalRef: goal-xyz | [Next step] |
| [[ProjectB]] | Planning | 10% | goalRef: — | [Next step] |

## Next Week Planning

### ONE Big Thing
>

### Key Tasks
Proposed new todos for next week (agent creates via API after user confirms batch):
1. "Task title" · project: X · priority: high · scheduledStart: Monday
2. "Task title" · project: Y · priority: medium · scheduledStart: Tuesday
3. "Task title" · project: X · priority: low · scheduledStart: Wednesday

### Todo Plan
Distribution of existing + new todos across the week (agent sets \`scheduledStart\` via API after confirmation):

**Monday:**
- [[todo:abc-123|Start audit]] · [ProjectA] · high
- [[todo:def-456|Morning routine]] · [ProjectB] · low

**Tuesday:**
- [[todo:ghi-789|Review UI bugs]] · [ProjectA] · medium
- [[todo:jkl-012|30min run]] · [ProjectB] · low

**Wednesday:**
- [[todo:mno-345|Deploy feature]] · [ProjectA] · high
- [[todo:pqr-678|Meal prep]] · [ProjectB] · low

(Continue for rest of week...)

### Project Next-Actions
- [[todo:id|Specific next step]] · [ProjectA]
- [[todo:id|Specific next step]] · [ProjectB]

### Time Blocks
- Monday:
- Tuesday:
- Wednesday:
- Thursday:
- Friday:

### Todo Housekeeping
Actions executed via API after user confirms batch:

**Archive:** (agent calls archive endpoint)
- [[todo:abc-123|Old completed todo]] · done 3/10
- [[todo:def-456|Another old todo]] · done 3/8

**Delete:** (agent calls delete endpoint)
- [[todo:ghi-789|Stale todo]] · created 2/15, no activity

**Re-prioritize:** (agent calls update endpoint)
- [[todo:jkl-012|Move X to high priority]] · current: low → proposed: high

## Notes
\`\`\`

## Automation Features

### Todo Analysis via \`/todos\` Skill
Fetch and analyze todos from Nomendex API:
- **Completion metrics**: Calculate completion rate by project
- **Overdue detection**: Identify todos past their due date
- **Blocker identification**: Surface todos marked as blocked
- **Pattern analysis**: Track "Today" column usage and completion while keeping multi-day context out of day-level completion-rate math
- **Goal mapping**: Connect completed todos to typed goals via \`resolvedGoalRefs\`
- **Disambiguation**: When titles repeat, show visible plain-text ID + \`scheduledStart\`-\`scheduledEnd\`

Example usage in weekly review:
\`\`\`
Use /todos skill to:
1. Fetch all todos from past week
2. Group by project and status
3. Calculate completion rates (exclude multi-day context from daily-rate math)
4. Identify overdue items
5. Analyze daily "Today" column patterns
6. Render duplicate titles with visible IDs and scheduled ranges
\`\`\`

### Auto-Archive
Suggest moving daily notes older than 30 days to Archives.

### Project Status Update
For each active project:
- Update completion percentage
- Note blockers
- Set next actions

### Habit Tracking
Calculate habit success rates from daily notes:
- Count habit checkboxes
- Show completion percentage
- Identify patterns
- For streak-style habits, copy the explicit label from the latest relevant daily note verbatim; do not derive streak arithmetic

## Best Practices

### Consistent Timing
- Same day each week (Sunday recommended)
- Same time if possible
- Block calendar time
- Treat as non-negotiable

### Preparation
- Clean inbox before review
- Have calendar ready
- Gather project updates
- Review any feedback

### Follow-through
- Share highlights with team/family
- Update external systems
- Communicate changes
- Celebrate wins

## Task-Based Progress Tracking

The weekly skill uses session tasks to show progress through the 3-phase review.

### Phase Tasks

Create tasks at skill start:

\`\`\`
TaskCreate:
  subject: "Phase 1: Collect"
  description: "Gather daily notes from past week, fetch todos data, extract wins and challenges"
  activeForm: "Collecting daily notes, todos, and extracting highlights..."

TaskCreate:
  subject: "Phase 2: Reflect"
  description: "Calculate goal progress, analyze todo completion patterns, identify alignment gaps"
  activeForm: "Calculating goal progress and analyzing todo patterns..."

TaskCreate:
  subject: "Phase 3: Plan"
  description: "Identify ONE Big Thing, triage todos, plan daily focus areas for next week"
  activeForm: "Planning next week's focus and todo distribution..."
\`\`\`

### Dependencies

Phases must run in order:
\`\`\`
TaskUpdate: "Phase 2: Reflect", addBlockedBy: [phase-1-collect-id]
TaskUpdate: "Phase 3: Plan", addBlockedBy: [phase-2-reflect-id]
\`\`\`

Reflect is blocked until Collect completes. Plan is blocked until Reflect completes. This provides visibility into the 30-minute review process.

Mark each task \`in_progress\` when starting, \`completed\` when done using TaskUpdate.

Task tools are session-scoped and don't persist between BPagent sessions—your actual work items are managed through the Nomendex todos API, and the weekly review note serves as a read-only snapshot.

## Agent Team Workflow (Optional)

For a faster, more thorough weekly review, use agent teams to parallelize the collection phase:

\`\`\`
Team Lead (coordinator)
├── collector agent — Read all daily notes, extract wins/challenges/tasks
├── goal-analyzer agent — Fetch goal progress via /api/goals/graph/forest, find alignment gaps
├── project-scanner agent — Fetch projects via /api/projects/list, read project notes for narrative context
└── todo-collector agent — Fetch todos via /todos skill, analyze completion, identify patterns
\`\`\`

### How to Use
When invoking \`/weekly\`, you can request the team-based approach:
\`\`\`
/weekly
"Use the team approach for a thorough review"
\`\`\`

The team lead:
1. Spawns four agents to work in parallel
2. Collector reads daily notes and extracts highlights
3. Goal-analyzer fetches goal forest via \`POST /api/goals/graph/forest {}\` and analyzes computed progress per goal
4. Project-scanner fetches project list via \`POST /api/projects/list {}\`, reads project notes for narrative context only
5. Todo-collector fetches todos via \`/todos\` skill and analyzes:
   - Completion rates by project
   - Overdue and blocked todos
   - "Today" column patterns
   - Mapping of completed todos to typed goals (via \`resolvedGoalRefs\`)
6. Team lead synthesizes findings into the weekly review note

This makes the review faster (parallel collection) and more thorough (dedicated analysis per area).

### Vault Health Check (Ad-hoc)

The weekly review can optionally include a vault health check using multiple agents:
- **note-organizer**: Scan for broken links, orphan notes
- **goal-aligner**: Check daily-to-goal alignment
- **inbox-processor**: Check for unprocessed items

Request with: "Include a vault health check in my weekly review"

## Integration

Works with:
- \`/daily\` - Reviews daily notes from the week
- \`/todos\` - Fetches todos data for completion analysis and planning
- \`/monthly\` - Weekly reviews feed monthly rollup
- \`/project\` - Project status in review
- \`/push\` - Commit after completing review
- \`/onboard\` - Load context for informed review
- Goal tracking skill - Progress calculations
`,
    },
  }
];

/**
 * In-memory storage for pending updates.
 * This is populated during initialization and consumed by the UI.
 */
let pendingUpdates: SkillUpdateInfo[] = [];

/**
 * Parse SKILL.md frontmatter to extract metadata including version
 */
function parseSkillFrontmatter(content: string): SkillMetadata | null {
  const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontMatterRegex);

  if (!match) {
    return null;
  }

  try {
    const frontMatterYaml = match[1];
    const parsed = yaml.load(frontMatterYaml);
    const result = SkillMetadataSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    logger.warn("Invalid skill frontmatter schema", { parsed, error: result.error });
    return null;
  } catch (error) {
    logger.error("Failed to parse skill frontmatter", { error });
    return null;
  }
}

/**
 * Get the version of an installed skill, or null if not installed
 */
async function getInstalledSkillVersion(skillName: string): Promise<number | null> {
  if (!hasActiveWorkspace()) {
    return null;
  }

  const skillPath = path.join(getSkillsPath(), skillName, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const metadata = parseSkillFrontmatter(content);
    return metadata?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the source field of an installed skill, or null if not installed / no source
 */
async function getInstalledSkillSource(skillName: string): Promise<string | null> {
  if (!hasActiveWorkspace()) {
    return null;
  }

  const skillPath = path.join(getSkillsPath(), skillName, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const metadata = parseSkillFrontmatter(content);
    return metadata?.source ?? null;
  } catch {
    return null;
  }
}

/**
 * Decide if an existing skill directory should be treated as recoverable Nomendex-owned state.
 * This prevents empty/broken directories from permanently blocking reinstallation, while still
 * protecting user-owned directories with colliding names.
 */
async function isRecoverableNomendexSkillDirectory(skillName: string, skillDirPath: string): Promise<boolean> {
  const skillMdPath = path.join(skillDirPath, "SKILL.md");
  const skillMdFile = Bun.file(skillMdPath);

  if (!(await skillMdFile.exists())) {
    let entries: string[] = [];
    try {
      entries = await readdir(skillDirPath);
    } catch {
      logger.info(`Skipping ${skillName}: could not inspect existing directory`);
      return false;
    }

    if (entries.length === 0) {
      logger.warn(`Recovering ${skillName}: found empty skill directory without SKILL.md`);
      return true;
    }

    logger.info(`Skipping ${skillName}: non-empty directory exists without SKILL.md`);
    return false;
  }

  try {
    const content = await skillMdFile.text();
    const metadata = parseSkillFrontmatter(content);

    if (metadata?.source === "nomendex") {
      return true;
    }

    if (!metadata && content.includes("source: nomendex")) {
      logger.warn(`Recovering ${skillName}: invalid frontmatter but source marker indicates Nomendex ownership`);
      return true;
    }
  } catch {
    logger.info(`Skipping ${skillName}: failed to read existing SKILL.md`);
    return false;
  }

  logger.info(`Skipping ${skillName}: existing SKILL.md is not Nomendex-owned`);
  return false;
}

/**
 * Get metadata for an embedded default skill
 */
function getDefaultSkillMetadata(skillName: string): SkillMetadata | null {
  const skill = DEFAULT_SKILLS.find((s) => s.name === skillName);
  if (!skill) return null;

  const skillMd = skill.files["SKILL.md"];
  if (!skillMd) return null;

  return parseSkillFrontmatter(skillMd);
}

/**
 * Write a default skill to the workspace
 */
async function writeDefaultSkill(skillName: string): Promise<boolean> {
  if (!hasActiveWorkspace()) {
    logger.warn("No active workspace, cannot write skill");
    return false;
  }

  const skill = DEFAULT_SKILLS.find((s) => s.name === skillName);
  if (!skill) {
    logger.error(`Default skill not found: ${skillName}`);
    return false;
  }

  const destPath = path.join(getSkillsPath(), skillName);

  try {
    // Create destination directory
    await mkdir(destPath, { recursive: true });

    // Write all files
    for (const [filename, content] of Object.entries(skill.files)) {
      const filePath = path.join(destPath, filename);
      await Bun.write(filePath, content);

      // Make shell scripts executable
      if (filename.endsWith(".sh")) {
        await chmod(filePath, 0o755);
      }

      logger.info(`Wrote ${filename} to ${destPath}`);
    }

    logger.info(`Successfully wrote skill: ${skillName}`);
    return true;
  } catch (error) {
    logger.error(`Failed to write skill: ${skillName}`, { error });
    return false;
  }
}

/**
 * Check for available skill updates.
 * Only considers skills where the installed copy has source: nomendex (or is missing).
 * User-created skills with colliding names are skipped entirely.
 */
async function checkForSkillUpdates(): Promise<SkillUpdateCheckResult> {
  const result: SkillUpdateCheckResult = {
    pendingUpdates: [],
    newSkills: [],
  };

  if (!hasActiveWorkspace()) {
    return result;
  }

  for (const skill of DEFAULT_SKILLS) {
    const defaultMetadata = getDefaultSkillMetadata(skill.name);
    if (!defaultMetadata) {
      logger.warn(`Could not read metadata for default skill: ${skill.name}`);
      continue;
    }

    const installedVersion = await getInstalledSkillVersion(skill.name);

    if (installedVersion === null) {
      // Skill directory might exist without a valid SKILL.md or version
      // If directory exists at all, check ownership before treating as "new"
      const skillDirPath = path.join(getSkillsPath(), skill.name);
      let dirExists = false;
      try {
        const s = await stat(skillDirPath);
        dirExists = s.isDirectory();
      } catch {
        // Directory doesn't exist — truly new
      }

      if (dirExists) {
        // Directory exists — only recover when clearly Nomendex-owned or empty/broken from partial install
        const isRecoverable = await isRecoverableNomendexSkillDirectory(skill.name, skillDirPath);
        if (!isRecoverable) {
          continue;
        }
      }
      result.newSkills.push(skill.name);
    } else {
      // Skill exists with a parseable version — check ownership before offering update
      const installedSource = await getInstalledSkillSource(skill.name);
      if (installedSource !== null && installedSource !== "nomendex") {
        // User-owned skill with colliding name — don't touch
        logger.info(`Skipping update for ${skill.name}: user-owned skill (source: ${installedSource})`);
        continue;
      }

      if (installedVersion < defaultMetadata.version) {
        result.pendingUpdates.push({
          skillName: skill.name,
          currentVersion: installedVersion,
          availableVersion: defaultMetadata.version,
        });
      }
    }
  }

  return result;
}

/**
 * Initialize default skills on workspace startup.
 * - Writes any missing default skills (if no user-owned collision exists)
 * - Auto-applies updates only for Nomendex-owned skills (source: nomendex)
 * - Surfaces updates for skills without source as pending (toast flow)
 */
export async function initializeDefaultSkills(): Promise<SkillUpdateCheckResult> {
  if (!hasActiveWorkspace()) {
    logger.info("No active workspace, skipping default skills initialization");
    return { pendingUpdates: [], newSkills: [] };
  }

  logger.info("Initializing default skills...");

  // Check for new skills and updates (already ownership-filtered)
  const updateCheck = await checkForSkillUpdates();

  // Write any new (missing) skills
  for (const skillName of updateCheck.newSkills) {
    logger.info(`Installing new default skill: ${skillName}`);
    await writeDefaultSkill(skillName);
  }

  // Process pending updates with ownership-aware logic
  const remainingPending: SkillUpdateInfo[] = [];
  for (const update of updateCheck.pendingUpdates) {
    const installedSource = await getInstalledSkillSource(update.skillName);
    if (installedSource === "nomendex") {
      // Already Nomendex-owned — safe to auto-update
      logger.info(`Auto-updating Nomendex skill: ${update.skillName} (v${update.currentVersion} → v${update.availableVersion})`);
      await writeDefaultSkill(update.skillName);
    } else {
      // No source yet (pre-ownership skill) or ambiguous — surface via toast
      logger.info(`Pending update for ${update.skillName} (v${update.currentVersion} → v${update.availableVersion})`);
      remainingPending.push(update);
    }
  }

  // Store remaining pending updates for UI notification
  pendingUpdates = remainingPending;

  const autoApplied = updateCheck.pendingUpdates.length - remainingPending.length;
  logger.info(`Default skills initialization complete. Installed ${updateCheck.newSkills.length} new, auto-updated ${autoApplied}, ${remainingPending.length} pending.`);

  return {
    pendingUpdates: remainingPending,
    newSkills: updateCheck.newSkills,
  };
}

/**
 * Get the list of pending skill updates
 */
export function getPendingSkillUpdates(): SkillUpdateInfo[] {
  return pendingUpdates;
}

/**
 * Apply a skill update (write new version to workspace).
 * Enforces the same ownership check as startup — only writes if the
 * installed skill has source: nomendex (or is missing entirely).
 */
export async function applySkillUpdate(skillName: string): Promise<boolean> {
  // Ownership gate: only allow updating Nomendex-owned skills
  const installedSource = await getInstalledSkillSource(skillName);
  if (installedSource !== null && installedSource !== "nomendex") {
    logger.warn(`Refusing to update ${skillName}: not Nomendex-owned (source: ${installedSource})`);
    // Remove from pending since it shouldn't be there
    pendingUpdates = pendingUpdates.filter((u) => u.skillName !== skillName);
    return false;
  }

  const success = await writeDefaultSkill(skillName);

  if (success) {
    // Remove from pending updates
    pendingUpdates = pendingUpdates.filter((u) => u.skillName !== skillName);
  }

  return success;
}

/**
 * Apply all pending skill updates
 */
export async function applyAllSkillUpdates(): Promise<{ success: string[]; failed: string[] }> {
  const success: string[] = [];
  const failed: string[] = [];

  for (const update of [...pendingUpdates]) {
    const result = await applySkillUpdate(update.skillName);
    if (result) {
      success.push(update.skillName);
    } else {
      failed.push(update.skillName);
    }
  }

  return { success, failed };
}
