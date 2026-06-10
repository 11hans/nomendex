import { gatewayService } from "@/gateway/service";
import { GatewayHttpError } from "@/gateway/errors";
import { ChannelsSettingsPatchSchema, TelegramAiReplySchema, TelegramSendSchema } from "@/gateway/types";
import { createServiceLogger } from "@/lib/logger";
import { evaluateMutatingRequestPolicy } from "@/lib/request-security";

const logger = createServiceLogger("CHANNELS-ROUTES");

// CSRF guard: these routes send Telegram messages and trigger agent runs, so
// browser requests from foreign origins (or without a JSON content type) are
// rejected before the body is parsed.
function rejectUntrustedMutation(req: Request): Response | null {
  const policy = evaluateMutatingRequestPolicy(req);
  if (policy.allowed) return null;

  logger.warn("Rejected channels mutation request", {
    path: new URL(req.url).pathname,
    reason: policy.reason,
  });

  if (policy.reason === "content-type") {
    return Response.json(
      { error: "Content-Type must be application/json", code: "UNSUPPORTED_CONTENT_TYPE" },
      { status: 415 },
    );
  }
  return Response.json(
    { error: "Cross-origin request rejected", code: "FORBIDDEN_ORIGIN" },
    { status: 403 },
  );
}

export const channelsRoutes = {
  "/api/channels/threads": {
    async GET(req: Request) {
      try {
        const url = new URL(req.url);
        const channelParam = url.searchParams.get("channel");
        const query = url.searchParams.get("query") || undefined;

        const channel = channelParam === "app" || channelParam === "telegram" ? channelParam : "all";
        const threads = await gatewayService.listThreads({ channel, query });
        return Response.json({
          threads,
          status: gatewayService.getStatus(),
        });
      } catch (error) {
        logger.error("Failed to list threads", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "Failed to list threads" }, { status: 500 });
      }
    },
  },

  "/api/channels/threads/*": {
    async GET(req: Request) {
      try {
        const url = new URL(req.url);
        const parts = url.pathname.split("/");
        const threadId = decodeURIComponent(parts[parts.length - 1] || "");

        if (!threadId) {
          return Response.json({ error: "threadId is required" }, { status: 400 });
        }

        const messages = await gatewayService.getThreadMessages(threadId);
        return Response.json({ messages });
      } catch (error) {
        logger.error("Failed to load thread messages", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "Failed to load thread messages" }, { status: 500 });
      }
    },
  },

  "/api/channels/telegram/send": {
    async POST(req: Request) {
      const rejected = rejectUntrustedMutation(req);
      if (rejected) return rejected;
      try {
        const body = await req.json();
        const parsed = TelegramSendSchema.parse(body);

        const sent = await gatewayService.sendTelegramMessage({
          threadId: parsed.threadId,
          chatId: parsed.chatId,
          text: parsed.text,
          source: "manual",
        });

        return Response.json({ success: true, message: sent });
      } catch (error) {
        if (error instanceof Error && error.name === "ZodError") {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
        if (error instanceof GatewayHttpError) {
          return Response.json({ error: error.message, code: error.code }, { status: error.status });
        }
        logger.error("Failed to send Telegram message", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "Failed to send Telegram message" }, { status: 500 });
      }
    },
  },

  "/api/channels/telegram/ai-reply": {
    async POST(req: Request) {
      const rejected = rejectUntrustedMutation(req);
      if (rejected) return rejected;
      try {
        const body = await req.json();
        const parsed = TelegramAiReplySchema.parse(body);

        const result = await gatewayService.aiReplyTelegram({
          threadId: parsed.threadId,
          prompt: parsed.prompt,
        });

        return Response.json({ success: true, ...result });
      } catch (error) {
        if (error instanceof Error && error.name === "ZodError") {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
        if (error instanceof GatewayHttpError) {
          return Response.json({ error: error.message, code: error.code }, { status: error.status });
        }
        logger.error("Failed to generate Telegram AI reply", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "Failed to generate Telegram AI reply" }, { status: 500 });
      }
    },
  },

  "/api/channels/settings": {
    async GET() {
      try {
        const settings = await gatewayService.getSettings();
        return Response.json({ settings });
      } catch (error) {
        logger.error("Failed to load channel settings", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "Failed to load channel settings" }, { status: 500 });
      }
    },

    async PUT(req: Request) {
      const rejected = rejectUntrustedMutation(req);
      if (rejected) return rejected;
      try {
        const body = await req.json();
        const parsed = ChannelsSettingsPatchSchema.parse(body);
        const settings = await gatewayService.updateSettings(parsed);
        return Response.json({ success: true, settings });
      } catch (error) {
        if (error instanceof Error && error.name === "ZodError") {
          return Response.json({ error: "Invalid settings payload" }, { status: 400 });
        }
        logger.error("Failed to update channel settings", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "Failed to update channel settings" }, { status: 500 });
      }
    },
  },

  "/api/channels/status": {
    async GET() {
      try {
        const status = await gatewayService.getDebugStatus();
        return Response.json(status);
      } catch (error) {
        logger.error("Failed to load channel status", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "Failed to load channel status" }, { status: 500 });
      }
    },
  },
};
