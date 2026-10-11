import path from "node:path";
import { INBOX_PROJECT_NAME } from "@/features/projects/inbox-project";
import { createTodo } from "@/features/todos/fx";
import type { Todo } from "@/features/todos/todo-types";
import { ensureUploadsDir, generateFileId } from "@/server-routes/uploads-routes";
import { broadcastTodoEvent } from "@/services/todo-events";
import type { Attachment } from "@/types/attachments";
import { inboxTodoText } from "./telegram-normalization";
import type { TelegramInboundMessage } from "./types";

// Telegram capture: every allowlisted message becomes one Inbox todo, written
// deterministically — no agent, no tools. The bot only confirms the save.

export const CAPTURE_REPLY_SAVED = "uloženo";
export const CAPTURE_REPLY_UNSUPPORTED = "neuloženo – pošli text nebo fotku";
export const CAPTURE_REPLY_FAILED = "neuloženo – chyba, zkus to znovu";

// Same cap as /api/uploads.
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const PHOTO_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function savePhoto(data: ArrayBuffer, telegramFilePath: string): Promise<Attachment> {
  const ext = path.extname(telegramFilePath).toLowerCase();
  // Telegram re-encodes photos as JPEG; the extension check is only a safeguard.
  const mimeType = PHOTO_MIME_BY_EXT[ext] ?? "image/jpeg";
  const fileId = generateFileId();
  const filename = `${fileId}${PHOTO_MIME_BY_EXT[ext] ? ext : ".jpg"}`;
  await Bun.write(path.join(await ensureUploadsDir(), filename), data);

  return {
    id: fileId,
    filename,
    originalName: path.basename(telegramFilePath),
    mimeType,
    size: data.byteLength,
    url: `/api/uploads/${filename}`,
    createdAt: new Date().toISOString(),
  };
}

export async function captureToInbox(
  message: TelegramInboundMessage,
  downloadPhoto: (fileId: string) => Promise<{ data: ArrayBuffer; filePath: string }>,
): Promise<Todo> {
  const attachments: Attachment[] = [];
  if (message.kind === "photo" && message.photoFileId) {
    const photo = await downloadPhoto(message.photoFileId);
    attachments.push(await savePhoto(photo.data, photo.filePath));
  }

  const todo = await createTodo({
    ...inboxTodoText(message.text),
    project: INBOX_PROJECT_NAME,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
  // Same event the /api/todos/create route emits, so open views refresh.
  broadcastTodoEvent({ type: "upsert", todo });
  return todo;
}
