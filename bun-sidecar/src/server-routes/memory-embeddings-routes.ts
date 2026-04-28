import { z } from "zod";
import path from "node:path";
import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { WorkspaceStateSchema } from "@/types/Workspace";
import { secrets } from "@/lib/secrets";
import { invalidateEmbeddingsConfig } from "@/features/agent-memory/embeddings";

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
    await secrets.load();
}

export const memoryEmbeddingsRoutes = {
    "/api/memory-embeddings/config": {
        async GET() {
            try {
                const state = await loadWorkspaceState();
                if (!state) {
                    return Response.json({ error: "No active workspace" }, { status: 400 });
                }
                const { provider } = state.embeddings;
                const hasApiKey = !!(await secrets.get("VOYAGE_API_KEY"));
                return Response.json({ provider, hasApiKey });
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
                    voyageApiKey?: string | null;
                };

                const state = await loadWorkspaceState();
                if (!state) {
                    return Response.json({ error: "No active workspace" }, { status: 400 });
                }

                const providerResult = z.enum(["disabled", "voyage"]).safeParse(body.provider);
                if (!providerResult.success) {
                    return Response.json({ error: "Invalid provider" }, { status: 400 });
                }

                const updated = {
                    ...state,
                    embeddings: { provider: providerResult.data },
                };
                await saveWorkspaceState(updated);

                if (body.voyageApiKey !== undefined) {
                    await saveSecretKey("VOYAGE_API_KEY", body.voyageApiKey || null);
                }

                invalidateEmbeddingsConfig();

                const hasApiKey = !!(await secrets.get("VOYAGE_API_KEY"));
                return Response.json({ success: true, hasApiKey });
            } catch (error) {
                return Response.json(
                    { error: error instanceof Error ? error.message : "Failed to save config" },
                    { status: 500 }
                );
            }
        },
    },
};
