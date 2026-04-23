export type QuickActionId = "rewrite" | "summarize" | "translate" | "fix-grammar" | "expand";

export type QuickActionCategory = "edit" | "generate";

export interface QuickAction {
    id: QuickActionId;
    label: string;
    systemPrompt: string;
    model: string;
    category: QuickActionCategory;
}

export const CUSTOM_PROMPT_MODEL = "claude-haiku-4-5";
export const CUSTOM_PROMPT_SUFFIX = "Return only the result — no explanations, no preamble.";

export function buildCustomSystemPrompt(userInstruction: string): string {
    return `${userInstruction.trim()}\n\n${CUSTOM_PROMPT_SUFFIX}`;
}

/** Transform quick-actions render a diff view against the original selection (§3). */
export const TRANSFORM_ACTION_IDS: ReadonlySet<QuickActionId> = new Set<QuickActionId>([
    "rewrite",
    "fix-grammar",
    "translate",
]);

export const REFINE_CHIPS: { id: string; label: string; instruction: string }[] = [
    { id: "shorter", label: "Shorter", instruction: "Rewrite this to be shorter while preserving the key meaning." },
    { id: "longer", label: "Longer", instruction: "Rewrite this to be longer, adding more detail and elaboration." },
    { id: "formal", label: "More formal", instruction: "Rewrite this to be more formal in tone." },
    { id: "simpler", label: "Simpler", instruction: "Rewrite this to be simpler and easier to read." },
    { id: "bulleted", label: "Bulleted", instruction: "Rewrite this as a concise bulleted list." },
];

export const QUICK_ACTIONS: QuickAction[] = [
    {
        id: "rewrite",
        label: "Rewrite",
        systemPrompt:
            "Rewrite the following text to be clearer, more concise, and better structured. Preserve the original meaning, intent, and language. Return only the rewritten text — no explanations, no preamble.",
        model: "claude-haiku-4-5",
        category: "edit",
    },
    {
        id: "fix-grammar",
        label: "Fix grammar",
        systemPrompt:
            "Fix the grammar, spelling, and punctuation of the following text. Preserve the original language, meaning, and style as closely as possible. Return only the corrected text — no explanations, no preamble.",
        model: "claude-haiku-4-5",
        category: "edit",
    },
    {
        id: "summarize",
        label: "Summarize",
        systemPrompt:
            "Write a concise summary of the following text. Preserve the language of the original. Return only the summary — no explanations, no preamble.",
        model: "claude-haiku-4-5",
        category: "generate",
    },
    {
        id: "translate",
        label: "Translate",
        systemPrompt:
            "Translate the following text. If the text is in English, translate to Czech. If the text is in Czech or another language, translate to English. Return only the translated text — no explanations, no preamble.",
        model: "claude-haiku-4-5",
        category: "generate",
    },
    {
        id: "expand",
        label: "Expand",
        systemPrompt:
            "Expand the following text by adding more detail, context, and elaboration. Preserve the original language, tone, and intent. Return only the expanded text — no explanations, no preamble.",
        model: "claude-haiku-4-5",
        category: "generate",
    },
];
