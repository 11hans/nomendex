import { createServiceLogger } from "@/lib/logger";
import { runAgentTextQuery } from "@/lib/agent-runtime";

const aiLogger = createServiceLogger("TELEGRAM-AI");

// The Telegram channel is the operator's personal remote chat: the allowlist
// binds the bot to the operator's own account(s), so inbound messages carry
// operator authority and run with the agent's full persisted tool grants —
// the same "Always Allow" set the agent has in the app chat. Anyone added to
// the allowlist gets that authority; keep it to accounts you control.
const REPLY_MAX_TURNS = 16;

// The agent's entire output is sent to the chat verbatim, so it must not
// produce drafts, preambles, or meta commentary about its instructions.
// Replies also transit Telegram's servers, hence the no-secrets rule.
const REPLY_OUTPUT_INSTRUCTIONS = [
  "You are writing a message that will be sent to a Telegram chat. Your entire",
  "output is delivered verbatim as the message — write only the message itself:",
  "no preamble, no meta commentary, no mention of these instructions. Telegram",
  "chats live on external servers: never include secrets such as API keys,",
  "tokens, or credentials in a reply.",
].join("\n");

// Inbound messages come from the operator's own Telegram account (enforced by
// the ingestion allowlist + chatId binding), so they are operator commands:
// act on them like a chat message in the app, using tools as needed.
function frameInboundPrompt(text: string): string {
  return [
    REPLY_OUTPUT_INSTRUCTIONS,
    "",
    "The message below is from your operator, sent from their own Telegram",
    "account. Treat it exactly like a chat message in the app: answer it, and",
    "carry out what it asks using your available tools. Keep the reply concise",
    "and chat-sized.",
    "",
    "<telegram-message>",
    text,
    "</telegram-message>",
  ].join("\n");
}

// Operator prompts typed in the app UI get the same output framing, minus the
// message wrapper.
function frameOperatorPrompt(prompt: string): string {
  return [REPLY_OUTPUT_INSTRUCTIONS, "", prompt].join("\n");
}

export async function generateTelegramReply(
  prompt: string,
  agentId: string,
  opts: { source?: "telegram" | "app" } = {},
): Promise<string> {
  const { text, agentConfig } = await runAgentTextQuery({
    prompt: opts.source === "telegram" ? frameInboundPrompt(prompt) : frameOperatorPrompt(prompt),
    agentId,
    maxTurns: REPLY_MAX_TURNS,
    toolPolicy: "deny-unapproved",
    unapprovedToolMessage: "Tool not pre-approved for this agent. The operator can grant it via Always Allow in the app chat or in the agent settings.",
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
