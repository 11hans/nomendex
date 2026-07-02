// Dev-only: list-price estimates for Anthropic models, USD per 1M tokens.
// Not billed against Max subscription; used for relative cost comparison only.

export type ModelPricing = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
};

const PRICES: Record<string, ModelPricing> = {
    "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-1": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    "claude-haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

function resolvePricing(model: string): ModelPricing | null {
    if (PRICES[model]) return PRICES[model];
    // Loose match: strip date suffix (e.g. "claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5").
    const trimmed = model.replace(/-\d{8}$/, "");
    if (PRICES[trimmed]) return PRICES[trimmed];
    // Fallback: longest prefix match.
    const keys = Object.keys(PRICES).sort((a, b) => b.length - a.length);
    for (const k of keys) {
        if (model.startsWith(k)) return PRICES[k];
    }
    return null;
}

export type TokenBreakdown = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
};

export function computeCostUsd(model: string, tokens: TokenBreakdown): number {
    const p = resolvePricing(model);
    if (!p) return 0;
    const M = 1_000_000;
    return (
        (tokens.inputTokens * p.input) / M +
        (tokens.outputTokens * p.output) / M +
        (tokens.cacheReadTokens * p.cacheRead) / M +
        (tokens.cacheCreationTokens * p.cacheWrite) / M
    );
}
