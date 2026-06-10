import { createServiceLogger } from "@/lib/logger";
import { runAgentTextQuery } from "@/lib/agent-runtime";

const aiLogger = createServiceLogger("TELEGRAM-AI");

export async function generateTelegramReply(prompt: string, agentId: string): Promise<string> {
  const { text, agentConfig } = await runAgentTextQuery({
    prompt,
    agentId,
    maxTurns: 4,
    toolPolicy: "deny-unapproved",
    unapprovedToolMessage: "Tool not pre-approved for Telegram auto-reply",
    onStderr: (data) => {
      aiLogger.error("Telegram query stderr", { data });
    },
  });

  aiLogger.info("Generated Telegram AI response", {
    agentId: agentConfig.id,
    outputLength: text.length,
  });

  return text.trim();
}
