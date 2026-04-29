import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { secrets } from "@/lib/secrets";
import { createServiceLogger } from "@/lib/logger";
import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import type { AgentMemoryRecord } from "./index";

const logger = createServiceLogger("EMBEDDINGS");

// --- Constants ---
const VOYAGE_BASE_URL = "https://api.voyageai.com/v1";
const VOYAGE_MODEL = "voyage-3-large";
const EMBEDDING_DIM = 1024;
const MIN_TEXT_LENGTH = 20;
const MAX_INPUT_TOKENS = 8000;
const BATCH_SIZE = 128;
const CONCURRENCY = 5;

const QUERY_CACHE_MAX = 50;
const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;

const EMBEDDINGS_BIN_FILE = "agent-memory-embeddings.bin";
const EMBEDDINGS_IDX_FILE = "agent-memory-embeddings.idx";

// --- FileMutex ---
const fileMutexes = new Map<string, Promise<void>>();

async function withFileMutex<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const previous = fileMutexes.get(filePath) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    fileMutexes.set(filePath, previous.then(() => next));
    try {
        await previous;
        return await fn();
    } finally {
        resolve!();
        if (fileMutexes.get(filePath) === next) {
            fileMutexes.delete(filePath);
        }
    }
}

// --- Concurrency limiter ---
class Semaphore {
    private current = 0;
    private queue: Array<() => void> = [];

    constructor(private max: number) {}

    async acquire(): Promise<void> {
        if (this.current < this.max) {
            this.current++;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        this.current--;
        const next = this.queue.shift();
        if (next) {
            this.current++;
            next();
        }
    }
}

// --- In-memory store ---
let embeddingsMap: Map<string, Float32Array> | null = null;
let dirty = false;
let embeddingsBasePath: string | null = null;
let apiAbortController: AbortController | null = null;

// --- Query cache ---
interface CacheEntry {
    vec: Float32Array;
    at: number;
}
const queryCache = new Map<string, CacheEntry>();

function cacheKey(query: string): string {
    return query.trim().toLowerCase();
}

function trimCache(): void {
    if (queryCache.size <= QUERY_CACHE_MAX) return;
    const entries = [...queryCache.entries()].sort((a, b) => a[1].at - b[1].at);
    while (queryCache.size > QUERY_CACHE_MAX) {
        const [key] = entries.shift()!;
        queryCache.delete(key);
    }
}

// --- Configuration ---

interface EmbeddingsConfig {
    provider: "disabled" | "voyage";
}

async function loadEmbeddingsConfig(): Promise<EmbeddingsConfig> {
    if (!hasActiveWorkspace()) return { provider: "disabled" };
    const nomendexDir = getNomendexPath();

    try {
        const file = Bun.file(path.join(nomendexDir, "workspace.json"));
        if (!(await file.exists())) return { provider: "disabled" };
        const raw = await file.json();
        if (raw && typeof raw === "object" && "embeddings" in (raw as Record<string, unknown>)) {
            const emb = (raw as Record<string, unknown>).embeddings as Record<string, unknown> | null;
            if (emb && emb.provider === "voyage") {
                return { provider: "voyage" };
            }
        }
    } catch {
        // Config parse failure — stay disabled
    }
    return { provider: "disabled" };
}

let embeddingsConfigCache: EmbeddingsConfig | null = null;

async function getEmbeddingsConfig(): Promise<EmbeddingsConfig> {
    if (!embeddingsConfigCache) {
        embeddingsConfigCache = await loadEmbeddingsConfig();
    }
    return embeddingsConfigCache;
}

/**
 * Force-reload the embeddings config from disk on next access.
 * Call this when workspace.json embeddings settings change at runtime.
 */
export function invalidateEmbeddingsConfig(): void {
    embeddingsConfigCache = null;
}

export async function embeddingsAvailable(): Promise<boolean> {
    const config = await getEmbeddingsConfig();
    if (config.provider !== "voyage") return false;
    const key = await secrets.get("VOYAGE_API_KEY");
    return !!key;
}

// --- API key (never logged) ---
async function getVoyageApiKey(): Promise<string | undefined> {
    return secrets.get("VOYAGE_API_KEY");
}

// --- Vector math ---

export function dot(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}

export function l2Normalize(v: Float32Array): Float32Array {
    let sumSq = 0;
    for (let i = 0; i < v.length; i++) {
        sumSq += v[i] * v[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return new Float32Array(v.length);
    const result = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
        result[i] = v[i] / norm;
    }
    return result;
}

// --- Embedding API ---

function truncateTextForEmbedding(text: string): string {
    const maxChars = MAX_INPUT_TOKENS * 4;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars);
}

export async function embed(text: string, signal?: AbortSignal): Promise<Float32Array | null> {
    const trimmed = text.trim();
    if (trimmed.length < MIN_TEXT_LENGTH) return null;

    const available = await embeddingsAvailable();
    if (!available) return null;

    const apiKey = await getVoyageApiKey();
    if (!apiKey) return null;

    const input = truncateTextForEmbedding(trimmed);

    try {
        const response = await fetch(`${VOYAGE_BASE_URL}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: VOYAGE_MODEL,
                input: [input],
            }),
            signal: signal || apiAbortController?.signal || undefined,
        });

        if (!response.ok) {
            if (signal?.aborted) return null;
            const retryable = response.status >= 500 || response.status === 429;
            logger.warn("Embeddings: API failure", { status: response.status, retryable });
            return null;
        }

        const data = await response.json() as {
            data?: Array<{ embedding: number[] }>;
        };

        if (!data.data || !data.data[0] || !data.data[0].embedding) {
            logger.warn("Embeddings: unexpected API response shape");
            return null;
        }

        const rawVec = data.data[0].embedding;
        if (rawVec.length !== EMBEDDING_DIM) {
            logger.warn("Embeddings: unexpected embedding dimension", { got: rawVec.length, expected: EMBEDDING_DIM });
            return null;
        }

        return l2Normalize(new Float32Array(rawVec));
    } catch (error) {
        if (signal?.aborted) return null;
        logger.warn("Embeddings: embed failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export async function embedBatch(
    texts: string[],
    signal?: AbortSignal
): Promise<(Float32Array | null)[]> {
    const available = await embeddingsAvailable();
    if (!available) return texts.map(() => null);

    const apiKey = await getVoyageApiKey();
    if (!apiKey) return texts.map(() => null);

    const chunks: string[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        chunks.push(texts.slice(i, i + BATCH_SIZE));
    }

    const allResults: (Float32Array | null)[] = new Array(texts.length).fill(null);
    const semaphore = new Semaphore(CONCURRENCY);

    const chunkPromises = chunks.map(async (chunk, chunkIdx) => {
        await semaphore.acquire();
        try {
            const offset = chunkIdx * BATCH_SIZE;
            const validTexts: Array<{ text: string; idx: number }> = [];
            const skipIndices: number[] = [];

            for (let j = 0; j < chunk.length; j++) {
                const trimmed = chunk[j].trim();
                if (trimmed.length < MIN_TEXT_LENGTH) {
                    skipIndices.push(offset + j);
                } else {
                    validTexts.push({ text: truncateTextForEmbedding(trimmed), idx: offset + j });
                }
            }

            if (validTexts.length === 0) return;

            try {
                const response = await fetch(`${VOYAGE_BASE_URL}/embeddings`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: VOYAGE_MODEL,
                        input: validTexts.map((v) => v.text),
                    }),
                    signal: signal || apiAbortController?.signal || undefined,
                });

                if (!response.ok) {
                    if (signal?.aborted) return;
                    const retryable = response.status >= 500 || response.status === 429;
                    logger.warn("Embeddings: batch API failure", { status: response.status, retryable });
                    return;
                }

                const data = await response.json() as {
                    data?: Array<{ embedding: number[] }>;
                };

                if (!data.data || !Array.isArray(data.data)) {
                    logger.warn("Embeddings: unexpected batch API response shape");
                    return;
                }

                for (let k = 0; k < validTexts.length && k < data.data.length; k++) {
                    const rawVec = data.data[k].embedding;
                    if (rawVec && rawVec.length === EMBEDDING_DIM) {
                        allResults[validTexts[k].idx] = l2Normalize(new Float32Array(rawVec));
                    }
                }
            } catch (error) {
                if (signal?.aborted) return;
                logger.warn("Embeddings: batch chunk failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        } finally {
            semaphore.release();
        }
    });

    await Promise.all(chunkPromises);
    return allResults;
}

// --- Embedding text helper ---
export function toEmbedText(record: { title: string; text: string }): string {
    return `${record.title}. ${record.text}`;
}

// --- Vector Storage ---

function ensureStores(): { map: Map<string, Float32Array>; basePath: string } | null {
    if (!embeddingsBasePath || !embeddingsMap) return null;
    return { map: embeddingsMap, basePath: embeddingsBasePath };
}

export async function initEmbeddings(basePath: string): Promise<void> {
    const storageDir = basePath;
    embeddingsBasePath = storageDir;
    // Reset config cache so toggling provider in workspace settings is observed
    // on next workspace init (and any subsequent embeddingsAvailable() call).
    embeddingsConfigCache = null;
    // Fresh AbortController so in-flight Voyage requests can be cancelled on dispose.
    apiAbortController = new AbortController();
    await mkdir(storageDir, { recursive: true });

    const binPath = path.join(storageDir, EMBEDDINGS_BIN_FILE);
    const idxPath = path.join(storageDir, EMBEDDINGS_IDX_FILE);

    try {
        const binFile = Bun.file(binPath);
        const idxFile = Bun.file(idxPath);

        if (!(await binFile.exists()) || !(await idxFile.exists())) {
            embeddingsMap = new Map();
            dirty = false;
            logger.info("Embeddings: init", { available: await embeddingsAvailable(), count: 0 });
            return;
        }

        const idxRaw = await idxFile.json() as Record<string, number>;
        const arrayBuffer = await binFile.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);

        const map = new Map<string, Float32Array>();
        const FLOAT_BYTES = 4;

        for (const [id, offset] of Object.entries(idxRaw)) {
            const byteOffset = offset * FLOAT_BYTES;
            const byteLength = EMBEDDING_DIM * FLOAT_BYTES;
            if (byteOffset + byteLength > buf.length) {
                logger.warn("Embeddings: corrupt store, skipping offset", { id, offset, bufLen: buf.length });
                continue;
            }
            const vec = new Float32Array(EMBEDDING_DIM);
            for (let j = 0; j < EMBEDDING_DIM; j++) {
                vec[j] = buf.readFloatLE(byteOffset + j * FLOAT_BYTES);
            }
            map.set(id, vec);
        }

        embeddingsMap = map;
        dirty = false;
        logger.info("Embeddings: init", { available: await embeddingsAvailable(), count: map.size });
    } catch (error) {
        logger.warn("Embeddings: corrupt store, starting empty", {
            error: error instanceof Error ? error.message : String(error),
        });
        embeddingsMap = new Map();
        dirty = false;
    }
}

export function setEmbedding(id: string, vec: Float32Array): void {
    const stores = ensureStores();
    if (!stores) return;
    stores.map.set(id, vec);
    dirty = true;
}

export function getEmbedding(id: string): Float32Array | undefined {
    return embeddingsMap?.get(id);
}

export function removeEmbedding(id: string): void {
    if (!embeddingsMap) return;
    if (embeddingsMap.delete(id)) {
        dirty = true;
    }
}

export function getAllEmbeddings(): ReadonlyMap<string, Float32Array> {
    return embeddingsMap ?? new Map();
}

export async function flushEmbeddings(): Promise<void> {
    if (!dirty || !embeddingsBasePath || !embeddingsMap) return;

    const binPath = path.join(embeddingsBasePath, EMBEDDINGS_BIN_FILE);
    const idxPath = path.join(embeddingsBasePath, EMBEDDINGS_IDX_FILE);
    const lockPath = path.join(embeddingsBasePath, "embeddings.lock");

    await withFileMutex(lockPath, async () => {
        try {
            const entries = [...embeddingsMap!.entries()];
            const FLOAT_BYTES = 4;
            const totalBytes = entries.length * EMBEDDING_DIM * FLOAT_BYTES;
            const buffer = Buffer.alloc(totalBytes);
            const idx: Record<string, number> = {};

            for (let i = 0; i < entries.length; i++) {
                const [id, vec] = entries[i];
                idx[id] = i * EMBEDDING_DIM;
                const floatCount = Math.min(vec.length, EMBEDDING_DIM);
                for (let j = 0; j < floatCount; j++) {
                    buffer.writeFloatLE(vec[j], (i * EMBEDDING_DIM + j) * FLOAT_BYTES);
                }
                for (let j = floatCount; j < EMBEDDING_DIM; j++) {
                    buffer.writeFloatLE(0, (i * EMBEDDING_DIM + j) * FLOAT_BYTES);
                }
            }

            // Atomic write: write to .tmp then rename onto final path.
            // rename(2) is atomic on POSIX; a crash between writes leaves the previous
            // committed file intact. Bin first, then idx — if idx is older than bin we
            // can re-derive (offsets recomputed); the reverse would orphan ids.
            const tmpBin = binPath + ".tmp";
            const tmpIdx = idxPath + ".tmp";

            await Bun.write(tmpBin, buffer);
            await rename(tmpBin, binPath);
            await Bun.write(tmpIdx, JSON.stringify(idx));
            await rename(tmpIdx, idxPath);

            dirty = false;
        } catch (error) {
            logger.warn("Embeddings: flush failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}

// --- Query cache ---

export async function embedQuery(query: string, signal?: AbortSignal): Promise<Float32Array | null> {
    const key = cacheKey(query);
    const now = Date.now();

    const cached = queryCache.get(key);
    if (cached && (now - cached.at) < QUERY_CACHE_TTL_MS) {
        return cached.vec;
    }

    const vec = await embed(query, signal);
    if (!vec) return null;

    queryCache.set(key, { vec, at: now });
    trimCache();

    return vec;
}

// --- Background backfill ---

export async function backfillMissingEmbeddings(
    records: AgentMemoryRecord[],
    signal?: AbortSignal
): Promise<{ embedded: number; failed: number }> {
    const available = await embeddingsAvailable();
    if (!available) return { embedded: 0, failed: 0 };

    const start = Date.now();
    const stores = ensureStores();
    if (!stores) return { embedded: 0, failed: 0 };

    const missing = records.filter((r) => {
        if (getEmbedding(r.id)) return false;
        const text = toEmbedText(r);
        if (text.trim().length < MIN_TEXT_LENGTH) return false;
        return true;
    });

    if (missing.length === 0) {
        logger.info("Embeddings: backfill done", { embedded: 0, failed: 0, durationMs: Date.now() - start });
        return { embedded: 0, failed: 0 };
    }

    const texts = missing.map((r) => toEmbedText(r));
    const results = await embedBatch(texts, signal);

    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < missing.length; i++) {
        if (signal?.aborted) break;
        if (results[i]) {
            setEmbedding(missing[i].id, results[i]!);
            embedded++;
        } else {
            failed++;
        }
    }

    // Single flush at the end — avoids rewriting the whole .bin file per batch.
    // If aborted partway, in-memory state is already updated for completed items;
    // the flush still persists what we have so far.
    await flushEmbeddings();

    if (signal?.aborted) {
        logger.info("Embeddings: backfill aborted", { embedded, failed, durationMs: Date.now() - start });
    } else {
        logger.info("Embeddings: backfill done", { embedded, failed, durationMs: Date.now() - start });
    }

    return { embedded, failed };
}

// --- Dispose ---

export function disposeEmbeddings(): void {
    if (apiAbortController) {
        apiAbortController.abort();
        apiAbortController = null;
    }
    embeddingsMap = null;
    embeddingsBasePath = null;
    dirty = false;
    embeddingsConfigCache = null;
    queryCache.clear();
}
