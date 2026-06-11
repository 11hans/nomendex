import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelsSettings, UnifiedMessage, UnifiedThread } from "./types";
import { DEFAULT_CHANNELS_SETTINGS } from "./types";
import { readJSONL } from "./utils";

type TelegramState = {
  lastUpdateId: number;
};

const CHANNELS_SETTINGS_FILE = "channels-settings.json";
const CHANNEL_THREADS_FILE = "channels-threads.json";
const CHANNEL_MESSAGES_FILE = "channels-messages.jsonl";
const TELEGRAM_STATE_FILE = "channels-telegram-state.json";

function getChannelsSettingsPath(): string {
  return join(getNomendexPath(), CHANNELS_SETTINGS_FILE);
}

function getChannelThreadsPath(): string {
  return join(getNomendexPath(), CHANNEL_THREADS_FILE);
}

function getChannelMessagesPath(): string {
  return join(getNomendexPath(), CHANNEL_MESSAGES_FILE);
}

function getTelegramStatePath(): string {
  return join(getNomendexPath(), TELEGRAM_STATE_FILE);
}

async function ensureWorkspaceDir(): Promise<boolean> {
  if (!hasActiveWorkspace()) return false;
  await mkdir(getNomendexPath(), { recursive: true });
  return true;
}

function mergeSettings(raw: Partial<ChannelsSettings> | undefined): ChannelsSettings {
  const telegram = raw?.telegram;
  return {
    telegram: {
      ...DEFAULT_CHANNELS_SETTINGS.telegram,
      ...(telegram || {}),
      allowlist: Array.isArray(telegram?.allowlist) ? telegram.allowlist : DEFAULT_CHANNELS_SETTINGS.telegram.allowlist,
    },
  };
}

export async function loadChannelsSettings(): Promise<ChannelsSettings> {
  if (!(await ensureWorkspaceDir())) {
    return DEFAULT_CHANNELS_SETTINGS;
  }

  const file = Bun.file(getChannelsSettingsPath());
  if (!(await file.exists())) {
    return DEFAULT_CHANNELS_SETTINGS;
  }

  try {
    const raw = await file.json();
    return mergeSettings(raw as Partial<ChannelsSettings>);
  } catch {
    return DEFAULT_CHANNELS_SETTINGS;
  }
}

export async function saveChannelsSettings(settings: ChannelsSettings): Promise<void> {
  if (!(await ensureWorkspaceDir())) return;
  await Bun.write(getChannelsSettingsPath(), JSON.stringify(mergeSettings(settings), null, 2));
}

export async function loadTelegramState(): Promise<TelegramState> {
  if (!(await ensureWorkspaceDir())) {
    return { lastUpdateId: 0 };
  }

  const file = Bun.file(getTelegramStatePath());
  if (!(await file.exists())) {
    return { lastUpdateId: 0 };
  }

  try {
    const raw = await file.json() as Partial<TelegramState>;
    return { lastUpdateId: Number(raw.lastUpdateId) || 0 };
  } catch {
    return { lastUpdateId: 0 };
  }
}

export async function saveTelegramState(state: TelegramState): Promise<void> {
  if (!(await ensureWorkspaceDir())) return;
  await Bun.write(getTelegramStatePath(), JSON.stringify({ lastUpdateId: state.lastUpdateId }, null, 2));
}

export async function loadTelegramThreads(): Promise<UnifiedThread[]> {
  if (!(await ensureWorkspaceDir())) return [];

  const file = Bun.file(getChannelThreadsPath());
  if (!(await file.exists())) return [];

  try {
    const raw = await file.json();
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is UnifiedThread => !!item && typeof item === "object" && item.channel === "telegram" && typeof (item as UnifiedThread).id === "string")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}

async function saveTelegramThreads(threads: UnifiedThread[]): Promise<void> {
  if (!(await ensureWorkspaceDir())) return;
  await Bun.write(getChannelThreadsPath(), JSON.stringify(threads, null, 2));
}

// Serialize upserts: concurrent read-modify-write cycles on
// channels-threads.json (inbound message + manual send at the same time)
// could otherwise drop one of the updates.
let threadWriteQueue: Promise<unknown> = Promise.resolve();

export function upsertTelegramThread(thread: UnifiedThread): Promise<void> {
  const task = threadWriteQueue.then(async () => {
    const threads = await loadTelegramThreads();
    const index = threads.findIndex((item) => item.id === thread.id);

    if (index >= 0) {
      threads[index] = thread;
    } else {
      threads.push(thread);
    }

    threads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    await saveTelegramThreads(threads);
  });
  threadWriteQueue = task.catch(() => undefined);
  return task;
}

export async function findTelegramThread(threadId: string): Promise<UnifiedThread | null> {
  const threads = await loadTelegramThreads();
  return threads.find((thread) => thread.id === threadId) || null;
}

export async function appendTelegramMessage(message: UnifiedMessage): Promise<void> {
  if (!(await ensureWorkspaceDir())) return;
  const path = getChannelMessagesPath();
  const line = `${JSON.stringify(message)}\n`;
  await appendFile(path, line, "utf-8");
}

// channels-messages.jsonl is append-only and every thread read scans the
// whole file, so it must not grow unbounded. Compacted on gateway init.
const MESSAGES_COMPACT_THRESHOLD_BYTES = 5 * 1024 * 1024;
const MESSAGES_COMPACT_KEEP_LINES = 5000;

export async function compactTelegramMessagesFile(): Promise<void> {
  if (!(await ensureWorkspaceDir())) return;
  const path = getChannelMessagesPath();
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size <= MESSAGES_COMPACT_THRESHOLD_BYTES) return;

  const lines = (await file.text()).split("\n").filter(Boolean);
  if (lines.length <= MESSAGES_COMPACT_KEEP_LINES) return;

  const kept = lines.slice(-MESSAGES_COMPACT_KEEP_LINES);
  await Bun.write(path, `${kept.join("\n")}\n`);
}


export async function listTelegramMessages(threadId: string): Promise<UnifiedMessage[]> {
  if (!(await ensureWorkspaceDir())) return [];

  const rows = await readJSONL<UnifiedMessage>(getChannelMessagesPath());
  return rows
    .filter((item) => item.channel === "telegram" && item.threadId === threadId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getLatestTelegramInboundText(threadId: string): Promise<string | null> {
  const messages = await listTelegramMessages(threadId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (msg.role === "user" && msg.text.trim()) {
      return msg.text;
    }
  }
  return null;
}
