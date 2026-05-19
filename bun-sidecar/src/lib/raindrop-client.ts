import {
    createRaindropClaudeAgentSDK,
    eventMetadata,
    type EventMetadata,
    type RaindropClaudeAgentSDKClient,
} from "@raindrop-ai/claude-agent-sdk";
import { secrets } from "@/lib/secrets";
import { globalConfig } from "@/storage/global-config";
import { createServiceLogger } from "@/lib/logger";

export { eventMetadata };

const logger = createServiceLogger("RAINDROP");

type ClientEntry = {
    client: RaindropClaudeAgentSDKClient;
    identifiedWorkspaces: Set<string>;
};

// Single shared client per mode. Cloud mode keys by write key; Workshop-only
// uses the literal "__workshop__" key (no write key needed).
const clientByKey = new Map<string, ClientEntry>();
const WORKSHOP_ONLY_KEY = "__workshop__";

function getOrCreateClient(writeKey: string | undefined): ClientEntry {
    const cacheKey = writeKey || WORKSHOP_ONLY_KEY;
    const existing = clientByKey.get(cacheKey);
    if (existing) return existing;

    // SDK accepts undefined writeKey for Workshop-only / local-debugger mode.
    // It auto-detects the daemon on localhost:5899 when NODE_ENV=development.
    const client = createRaindropClaudeAgentSDK(writeKey ? { writeKey } : {});
    const entry: ClientEntry = { client, identifiedWorkspaces: new Set() };
    clientByKey.set(cacheKey, entry);
    logger.info(
        writeKey
            ? "Raindrop client initialised (cloud mode)"
            : "Raindrop client initialised (Workshop / local-debugger mode)",
    );
    return entry;
}

export type TracedQueryHandle<P, R> = {
    query: (params: P, metadata?: EventMetadata) => R;
    flush: () => Promise<void>;
};

/**
 * Returns a wrapped query() that ships traces/events to Raindrop, plus a flush()
 * to call at session end.
 *
 * Modes:
 *  - Cloud: RAINDROP_WRITE_KEY set → ships to app.raindrop.ai.
 *  - Workshop: write key absent but RAINDROP_WORKSHOP=1 (or any non-empty
 *    value) set → ships only to the local Workshop daemon on :5899.
 *  - Disabled: neither set → no-op wrapper, zero overhead.
 */
export async function getRaindropQuery<P, R>(
    rawQuery: (params: P) => R,
): Promise<TracedQueryHandle<P, R>> {
    const writeKey = await secrets.get("RAINDROP_WRITE_KEY");
    const workshopEnabled = Boolean(await secrets.get("RAINDROP_WORKSHOP"));

    if (!writeKey && !workshopEnabled) {
        return {
            query: (params: P) => rawQuery(params),
            flush: async () => {},
        };
    }

    const { client, identifiedWorkspaces } = getOrCreateClient(writeKey);

    const workspace = await globalConfig.getActiveWorkspace();
    if (workspace && !identifiedWorkspaces.has(workspace.id)) {
        identifiedWorkspaces.add(workspace.id);
        try {
            await client.users.identify({
                userId: workspace.id,
                traits: { workspaceName: workspace.name, workspacePath: workspace.path },
            });
        } catch (err) {
            logger.warn("Raindrop users.identify failed", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const wrapped = client.wrap({ query: rawQuery });

    return {
        query: (params: P, metadata?: EventMetadata) =>
            wrapped.query(params, metadata) as R,
        flush: async () => {
            try {
                await client.flush();
            } catch (err) {
                logger.warn("Raindrop flush failed", {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        },
    };
}

/**
 * Convenience: returns the active workspace id for use as Raindrop userId,
 * or `undefined` if no workspace is active.
 */
export async function getRaindropUserId(): Promise<string | undefined> {
    const workspace = await globalConfig.getActiveWorkspace();
    return workspace?.id;
}
