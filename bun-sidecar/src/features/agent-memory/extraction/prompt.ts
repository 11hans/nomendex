import type { ConversationTurn } from "./types";

const MAX_TRANSCRIPT_CHARS = 8_000;
const MAX_TURN_CHARS = 600;

/**
 * System prompt that instructs the extraction model to act as a memory analyst.
 * Output format is JSON inside a <memories> tag to make extraction robust.
 */
export function buildExtractionSystemPrompt(): string {
    return `You are a memory analyst for Nomendex — a desktop application for notes, tasks, and AI agents. Your task is to extract durable, high-signal facts from a BPagent conversation that are worth remembering across future sessions.

## Output format

Respond with ONLY a JSON object wrapped in <memories> tags:

<memories>
{
  "memories": [
    {
      "kind": "preference",
      "scope": "agent",
      "title": "Short, descriptive title (max 120 chars)",
      "text": "Detailed description of what to remember (max 500 chars)",
      "tags": ["tag1", "tag2"],
      "importance": 0.8,
      "confidence": 0.9
    }
  ]
}
</memories>

If there is nothing worth remembering, return: <memories>{"memories": []}</memories>

## Nomendex context

The user works with:
- **Notes**: Markdown notes in a workspace folder, sometimes synced with Obsidian/TheVault
- **Todos**: Kanban-style task management organized into projects
- **BPagent**: An AI agent they chat with to manage notes, tasks, research, and code work
- **Workspaces**: Filesystem folders that contain all their data
- **Skills**: Custom slash commands that extend BPagent's capabilities
- **MCP servers**: Tool integrations the agent uses

## Memory kinds — Nomendex-specific examples

- **preference**: How user likes to name notes, structure todos, communicate with the agent, preferred language (Czech/English), writing style, how they organize projects, markdown conventions they follow
- **goal**: Active writing projects, research areas they're pursuing, personal productivity goals, long-term workspace organization goals
- **project**: Facts about specific Nomendex projects or workspaces — their purpose, naming conventions used, which areas are active, tech stack if coding-related
- **decision**: Organizational choices made (e.g., "decided to use a flat note structure", "chose GTD for task management"), agreed ways of working with the agent
- **context**: Currently active focus area, important ongoing task or project, a concept they are researching, recent major changes to their workspace
- **reference**: Important note file paths, frequently used project names, key workspace locations, useful external resources the user mentioned

## Memory scopes

- **agent**: Personal to this user — communication preferences, how they like to interact, their personal workflow habits
- **workspace**: Workspace-level facts — project names and purposes, organizational structure of notes/todos, naming conventions, shared decisions about how the workspace is organized

## Importance scale (0.0 – 1.0)

- 0.0–0.3: Ephemeral or obvious — skip entirely
- 0.4–0.6: Mildly useful context (e.g., currently working on X)
- 0.7–0.8: Will likely matter in many future sessions (e.g., note naming convention, preferred language)
- 0.9–1.0: Critical long-term knowledge (e.g., core workflow system, fundamental project structure)

## Rules

1. Only extract facts explicitly stated in the conversation — do NOT infer or hallucinate
2. Minimum importance threshold: 0.4 (skip anything below)
3. Prefer specific, actionable titles ("Names daily notes as YYYY-MM-DD in /journal/") over vague ones ("Note naming")
4. Strip conversational noise: greetings, thanks, filler text, one-off requests
5. Do NOT extract: content of individual notes or todos shown in conversation, file listings, MCP tool output, command results
6. Do NOT extract: individual task completions ("user finished task X") — too ephemeral
7. Do NOT extract: things that are obvious from the workspace structure itself
8. Merge closely related facts into one memory rather than fragmenting
9. Use English for titles and text regardless of the conversation language (Czech users are common)
10. Tag with relevant Nomendex concepts: notes, todos, projects, workspace, agent, skills, vault, coding, writing, etc.`;
}

/**
 * Builds the user content block sent to the extraction model.
 * Applies a sliding window and per-turn character cap.
 */
export function buildExtractionUserContent(turns: ConversationTurn[]): string {
    const windowed = applyContextWindow(turns, MAX_TRANSCRIPT_CHARS, MAX_TURN_CHARS);

    if (windowed.length === 0) {
        return "CONVERSATION TO ANALYZE:\n(empty)\n\nExtract memories from this conversation.";
    }

    const transcript = windowed
        .map((t) => `[${t.role === "user" ? "User" : "Assistant"}]: ${t.text}`)
        .join("\n\n");

    return `CONVERSATION TO ANALYZE:\n\n${transcript}\n\nExtract memories from this conversation. Return ONLY the <memories> JSON block.`;
}

/**
 * Applies a sliding window: keeps the most recent turns that fit within maxTotalChars.
 * Also truncates each individual turn to maxTurnChars.
 */
function applyContextWindow(
    turns: ConversationTurn[],
    maxTotalChars: number,
    maxTurnChars: number
): ConversationTurn[] {
    // Truncate each turn first
    const truncated = turns.map((t) => ({
        role: t.role,
        text: t.text.length > maxTurnChars ? `${t.text.slice(0, maxTurnChars)}…` : t.text,
    }));

    // Sliding window from the end
    let totalChars = 0;
    const result: ConversationTurn[] = [];
    for (let i = truncated.length - 1; i >= 0; i--) {
        const chars = truncated[i].text.length + 20; // +20 for role label overhead
        if (totalChars + chars > maxTotalChars) break;
        result.unshift(truncated[i]);
        totalChars += chars;
    }

    return result;
}

/**
 * Parses the <memories> JSON block from the model's response.
 * Returns null if the response cannot be parsed.
 */
export function parseExtractionResponse(rawResponse: string): Array<{
    kind: string;
    scope: string;
    title: string;
    text: string;
    tags: string[];
    importance: number;
    confidence: number;
}> | null {
    // Extract content between <memories> tags
    const match = rawResponse.match(/<memories>([\s\S]*?)<\/memories>/);
    if (!match) {
        // Fallback: try to parse the whole response as JSON
        try {
            const parsed = JSON.parse(rawResponse.trim());
            if (parsed && Array.isArray(parsed.memories)) {
                return parsed.memories;
            }
        } catch {
            // ignore
        }
        return null;
    }

    try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed && Array.isArray(parsed.memories)) {
            return parsed.memories;
        }
        return null;
    } catch {
        return null;
    }
}
