import { z } from "zod";
import path from "node:path";
import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { WorkspaceStateSchema } from "@/types/Workspace";
import { secrets } from "@/lib/secrets";
import { OpenRouterExtractionProvider } from "@/features/agent-memory/extraction/providers/openrouter";
import { ClaudeExtractionProvider } from "@/features/agent-memory/extraction/providers/claude";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadWorkspaceState() {
    if (!hasActiveWorkspace()) return null;
    try {
        const file = Bun.file(path.join(getNomendexPath(), "workspace.json"));
        if (!(await file.exists())) return null;
        const raw = await file.json();
        return WorkspaceStateSchema.parse(raw);
    } catch {
        return null;
    }
}

async function saveWorkspaceState(state: z.infer<typeof WorkspaceStateSchema>): Promise<void> {
    await Bun.write(path.join(getNomendexPath(), "workspace.json"), JSON.stringify(state, null, 2));
}

async function loadSecrets(): Promise<Record<string, string>> {
    const file = Bun.file(path.join(getNomendexPath(), "secrets.json"));
    if (!(await file.exists())) return {};
    try {
        const parsed = await file.json() as Record<string, string>;
        const { _comment: _, ...rest } = parsed as Record<string, string> & { _comment?: string };
        return rest;
    } catch {
        return {};
    }
}

async function saveSecretKey(key: string, value: string | null): Promise<void> {
    const existing = await loadSecrets();
    if (value) {
        existing[key] = value;
        process.env[key] = value;
    } else {
        delete existing[key];
        delete process.env[key];
    }
    const toSave = { _comment: "Add your API keys here. This file is gitignored.", ...existing };
    await Bun.write(path.join(getNomendexPath(), "secrets.json"), JSON.stringify(toSave, null, 2));
    // Invalidate secrets cache
    await secrets.load();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const memoryExtractionRoutes = {
    "/api/memory-extraction/config": {
        async GET() {
            try {
                const state = await loadWorkspaceState();
                if (!state) {
                    return Response.json({ error: "No active workspace" }, { status: 400 });
                }
                const { provider, openRouterModel } = state.memoryExtraction;
                const hasApiKey = !!(await secrets.get("OPENROUTER_API_KEY"));
                return Response.json({ provider, openRouterModel, hasApiKey });
            } catch (error) {
                return Response.json(
                    { error: error instanceof Error ? error.message : "Failed to load config" },
                    { status: 500 }
                );
            }
        },

        async POST(req: Request) {
            try {
                const body = await req.json() as {
                    provider?: string;
                    openRouterModel?: string;
                    openRouterApiKey?: string | null;
                };

                const state = await loadWorkspaceState();
                if (!state) {
                    return Response.json({ error: "No active workspace" }, { status: 400 });
                }

                // Validate provider
                const providerResult = z.enum(["disabled", "openrouter", "claude"]).safeParse(body.provider);
                if (!providerResult.success) {
                    return Response.json({ error: "Invalid provider" }, { status: 400 });
                }

                // Update workspace state
                const updated = {
                    ...state,
                    memoryExtraction: {
                        provider: providerResult.data,
                        openRouterModel: typeof body.openRouterModel === "string" && body.openRouterModel.trim()
                            ? body.openRouterModel.trim()
                            : state.memoryExtraction.openRouterModel,
                    },
                };
                await saveWorkspaceState(updated);

                // Save API key if provided
                if (body.openRouterApiKey !== undefined) {
                    await saveSecretKey("OPENROUTER_API_KEY", body.openRouterApiKey || null);
                }

                const hasApiKey = !!(await secrets.get("OPENROUTER_API_KEY"));
                return Response.json({ success: true, hasApiKey });
            } catch (error) {
                return Response.json(
                    { error: error instanceof Error ? error.message : "Failed to save config" },
                    { status: 500 }
                );
            }
        },
    },

    "/api/memory-extraction/test": {
        async POST(req: Request) {
            try {
                const body = await req.json() as { provider?: string; model?: string; apiKey?: string };

                const provider = body.provider ?? "openrouter";

                // Synthetic 3-turn conversation
                const testHistory = [
                    { role: "user" as const, text: "I prefer TypeScript with strict mode enabled for all projects." },
                    { role: "assistant" as const, text: "Noted! I'll always use TypeScript strict mode in this project." },
                    { role: "user" as const, text: "Also, we're using Bun as the runtime, not Node.js." },
                    { role: "assistant" as const, text: "Got it — Bun runtime, not Node.js. I'll keep that in mind." },
                ];

                const testInput = {
                    agentId: "bpagent",
                    sessionId: "test-session",
                    conversationHistory: testHistory,
                };

                const startTime = Date.now();

                let candidates;
                let providerUsed: string;

                if (provider === "openrouter") {
                    const apiKey = body.apiKey ?? (await secrets.get("OPENROUTER_API_KEY"));
                    if (!apiKey) {
                        return Response.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 400 });
                    }
                    const p = new OpenRouterExtractionProvider({
                        apiKey,
                        model: body.model ?? "xiaomi/mimo-v2-flash:free",
                    });
                    candidates = await p.extract(testInput);
                    providerUsed = "openrouter";
                } else if (provider === "claude") {
                    const p = new ClaudeExtractionProvider();
                    candidates = await p.extract(testInput);
                    providerUsed = "claude";
                } else {
                    return Response.json({ error: "Invalid provider for test" }, { status: 400 });
                }

                return Response.json({
                    success: true,
                    candidates,
                    providerUsed,
                    durationMs: Date.now() - startTime,
                });
            } catch (error) {
                return Response.json(
                    { error: error instanceof Error ? error.message : "Test failed" },
                    { status: 500 }
                );
            }
        },
    },
};
