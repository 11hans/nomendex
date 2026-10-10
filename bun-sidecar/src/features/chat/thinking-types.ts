import { z } from "zod";

/**
 * Per-message thinking depth from the chat toolbar, sent to the SDK as
 * `effort`. Undefined = the model's default. Current models think adaptively,
 * so a token budget (the deprecated `maxThinkingTokens`) only toggled thinking
 * on or off there; effort is what changes how much they think.
 */
export const ThinkingEffortSchema = z.enum(["low", "medium", "high", "max"]);

export type ThinkingEffort = z.infer<typeof ThinkingEffortSchema>;
