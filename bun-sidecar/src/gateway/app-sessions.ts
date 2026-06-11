import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { join } from "node:path";
import { findSessionFilePath } from "@/lib/claude-session-files";
import type { UnifiedMessage, UnifiedThread } from "./types";
import { readJSONL } from "./utils";

type AppSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  agentId?: string;
};

type SdkContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
};

type SdkMessage = {
  type: string;
  message?: string | { content?: SdkContentBlock[] };
  content?: unknown;
  uuid?: string;
};

function getSessionsFilePath(): string {
  return join(getNomendexPath(), "chat-sessions.jsonl");
}

function extractTextFromSdkMessage(msg: SdkMessage): string {
  if (typeof msg.message === "string") {
    return msg.message;
  }

  if (msg.message && typeof msg.message === "object" && Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text || "")
      .join("\n")
      .trim();
  }

  return "";
}

export async function listAppThreads(query?: string): Promise<UnifiedThread[]> {
  if (!hasActiveWorkspace()) return [];

  const sessions = await readJSONL<AppSession>(getSessionsFilePath());
  const dedup = new Map<string, AppSession>();

  for (const session of sessions) {
    const current = dedup.get(session.id);
    if (!current || new Date(session.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
      dedup.set(session.id, session);
    }
  }

  const search = query?.trim().toLowerCase() || "";
  const threads: UnifiedThread[] = [];
  for (const session of dedup.values()) {
    if (!session.id || /[^a-zA-Z0-9_-]/.test(session.id)) continue;
    const historyPath = await findSessionFilePath(session.id);
    if (!historyPath) continue;

    let preview = "";
    try {
      const sdkMessages = await readJSONL<SdkMessage>(historyPath);
      const lastAssistant = [...sdkMessages].reverse().find((msg) => msg.type === "assistant");
      if (lastAssistant) {
        preview = extractTextFromSdkMessage(lastAssistant).slice(0, 200);
      }

      if (search) {
        const inTitle = session.title.toLowerCase().includes(search);
        const inPreview = preview.toLowerCase().includes(search);
        const inBody = sdkMessages.some((msg) => extractTextFromSdkMessage(msg).toLowerCase().includes(search));
        if (!inTitle && !inPreview && !inBody) {
          continue;
        }
      }
    } catch {
      // Keep the thread visible even if preview extraction fails
      if (search && !session.title.toLowerCase().includes(search)) {
        continue;
      }
    }

    threads.push({
      id: `app:${session.id}`,
      channel: "app",
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      preview,
      sessionId: session.id,
    });
  }

  return threads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listAppThreadMessages(threadId: string): Promise<UnifiedMessage[]> {
  if (!hasActiveWorkspace()) return [];
  if (!threadId.startsWith("app:")) return [];

  const sessionId = threadId.slice(4);
  if (!sessionId || /[^a-zA-Z0-9_-]/.test(sessionId)) return [];
  const historyPath = await findSessionFilePath(sessionId);
  if (!historyPath) return [];

  const rows = await readJSONL<SdkMessage>(historyPath);
  const messages: UnifiedMessage[] = [];

  for (const row of rows) {
    if (row.type !== "user" && row.type !== "assistant") continue;
    const text = extractTextFromSdkMessage(row);
    if (!text) continue;

    messages.push({
      id: row.uuid || crypto.randomUUID(),
      threadId,
      channel: "app",
      role: row.type === "user" ? "user" : "assistant",
      text,
      createdAt: new Date().toISOString(),
      source: "app",
    });
  }

  return messages;
}
