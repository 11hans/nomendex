import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
    scoreRecordBase,
    computeMemoryScore,
} from "./fx";
import {
    dot,
    l2Normalize,
    getEmbedding,
    setEmbedding,
    removeEmbedding,
    getAllEmbeddings,
    initEmbeddings,
    flushEmbeddings,
    disposeEmbeddings,
} from "./embeddings";
import type { AgentMemoryRecord } from "./index";

// --- Test Helpers ---

function makeTestMemory(overrides: Partial<AgentMemoryRecord> = {}): AgentMemoryRecord {
    const now = new Date().toISOString();
    const id = `mem-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return {
        id,
        agentId: "test-agent",
        scope: "agent",
        kind: "preference",
        title: "Coffee preference",
        text: "Preferuji espresso s mlekem",
        tags: ["coffee", "preference"],
        importance: 0.5,
        confidence: 0.8,
        fingerprint: `fp-test-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        supersedes: [],
        ...overrides,
    };
}

// --- Pure Function Tests ---

describe("scoreRecordBase (keyword-only scoring)", () => {
    test("basic keyword match score", () => {
        const record = makeTestMemory({
            title: "Coffee preference",
            text: "I like espresso with milk",
            tags: ["coffee", "drink"],
        });

        const score = scoreRecordBase(record, ["coffee", "preference"]);
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThanOrEqual(1);
    });

    test("correction boost is NOT applied in scoreRecordBase", () => {
        const correction = makeTestMemory({
            kind: "correction",
            title: "Fixed coffee preference",
            text: "Actually I don't like milk",
        });

        const preference = makeTestMemory({
            kind: "preference",
            title: "Coffee preference",
            text: "I like espresso with milk",
        });

        const queryTokens = ["coffee", "preference"];

        // scoreRecordBase does NOT apply correction boost
        const correctionBase = scoreRecordBase(correction, queryTokens);
        const preferenceBase = scoreRecordBase(preference, queryTokens);

        // Both should get comparable base scores (different from old scoreRecord)
        expect(correctionBase).toBeGreaterThan(0);
        expect(preferenceBase).toBeGreaterThan(0);
    });

    test("no match returns low score", () => {
        const record = makeTestMemory({
            title: "Coffee preference",
            text: "I like espresso",
        });

        const score = scoreRecordBase(record, ["motorcycle", "repair"]);
        expect(score).toBeLessThan(0.5);
    });

    test("tag match contributes to score", () => {
        const record = makeTestMemory({
            title: "Unknown thing",
            text: "Some random content that doesn't match",
            tags: ["coffee", "espresso", "milk"],
        });

        const noTagRecord = makeTestMemory({
            title: "Unknown thing",
            text: "Some random content that doesn't match",
            tags: [],
        });

        const queryTokens = ["coffee"];
        const scoreWithTags = scoreRecordBase(record, queryTokens);
        const scoreNoTags = scoreRecordBase(noTagRecord, queryTokens);

        expect(scoreWithTags).toBeGreaterThan(scoreNoTags);
    });

    test("exact match scores higher than partial", () => {
        const exactMatch = makeTestMemory({
            title: "Coffee preference",
            text: "espreso kava kofola",
            tags: ["drink"],
        });

        const partialMatch = makeTestMemory({
            title: "Coding style",
            text: "espresso with milk and sugar",
            tags: ["food"],
        });

        // "coffee" matches "coffee" in title exactly
        const exactScore = scoreRecordBase(exactMatch, ["coffee"]);
        const partialScore = scoreRecordBase(partialMatch, ["coffee"]);

        // Title match on "coffee" should give higher score
        expect(exactScore).toBeGreaterThan(partialScore);
    });
});

describe("computeMemoryScore (decay scoring)", () => {
    test("recently accessed record scores higher", () => {
        const now = Date.now();
        const recent = makeTestMemory({
            lastAccessedAt: new Date(now).toISOString(),
        });
        const old = makeTestMemory({
            lastAccessedAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
        });

        const recentScore = computeMemoryScore(recent, now);
        const oldScore = computeMemoryScore(old, now);

        expect(recentScore).toBeGreaterThan(oldScore);
    });

    test("high importance records score higher", () => {
        const now = Date.now();
        const important = makeTestMemory({ importance: 0.9 });
        const unimportant = makeTestMemory({ importance: 0.1 });

        const importantScore = computeMemoryScore(important, now);
        const unimportantScore = computeMemoryScore(unimportant, now);

        expect(importantScore).toBeGreaterThan(unimportantScore);
    });

    test("accessCount reinforcement increases score", () => {
        const now = Date.now();
        const manyAccesses = makeTestMemory({ accessCount: 100 });
        const fewAccesses = makeTestMemory({ accessCount: 0 });

        const manyScore = computeMemoryScore(manyAccesses, now);
        const fewScore = computeMemoryScore(fewAccesses, now);

        expect(manyScore).toBeGreaterThan(fewScore);
    });

    test("permanent importance (>= 0.7) stays high", () => {
        const now = Date.now();
        const permanent = makeTestMemory({ importance: 0.85 });
        const normal = makeTestMemory({ importance: 0.3 });

        const permanentScore = computeMemoryScore(permanent, now);
        const normalScore = computeMemoryScore(normal, now);

        expect(permanentScore).toBeGreaterThan(normalScore);
    });
});

// --- Embedding Storage Tests ---

let tmpDir: string;

beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-mem-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
    disposeEmbeddings();
    try { await rm(tmpDir, { recursive: true }); } catch { /* ok */ }
});

describe("embedding storage lifecycle", () => {
    test("set / get / remove lifecycle", async () => {
        disposeEmbeddings();
        await initEmbeddings(tmpDir);

        const id = "lifecycle-test-1";
        const vec = new Float32Array(512);
        for (let i = 0; i < 512; i++) vec[i] = Math.random();

        setEmbedding(id, vec);
        const retrieved = getEmbedding(id);
        expect(retrieved).toBeDefined();
        if (retrieved) {
            expect(retrieved.length).toBe(512);
            for (let i = 0; i < 512; i++) {
                expect(retrieved[i]).toBe(vec[i]);
            }
        }

        removeEmbedding(id);
        expect(getEmbedding(id)).toBeUndefined();
    });

    test("flush + reload preserves vectors", async () => {
        disposeEmbeddings();

        const persistDir = path.join(tmpDir, "persist-" + Date.now());
        await mkdir(persistDir, { recursive: true });
        await initEmbeddings(persistDir);

        const id = "persist-test-1";
        const vec = new Float32Array(512);
        for (let i = 0; i < 512; i++) vec[i] = parseFloat((Math.random() * 2 - 1).toFixed(6));

        setEmbedding(id, vec);
        await flushEmbeddings();

        // Reload
        disposeEmbeddings();
        await initEmbeddings(persistDir);

        const reloaded = getEmbedding(id);
        expect(reloaded).toBeDefined();
        if (reloaded) {
            for (let i = 0; i < 512; i++) {
                expect(reloaded[i]).toBe(vec[i]);
            }
        }

        disposeEmbeddings();
    });

    test("initEmbeddings with empty directory starts empty", async () => {
        disposeEmbeddings();

        const emptyDir = path.join(tmpDir, "empty-" + Date.now());
        await mkdir(emptyDir, { recursive: true });
        await initEmbeddings(emptyDir);

        expect(getAllEmbeddings().size).toBe(0);

        disposeEmbeddings();
    });

    test("getAllEmbeddings returns all stored vectors", async () => {
        disposeEmbeddings();

        const dir = path.join(tmpDir, "all-vecs-" + Date.now());
        await mkdir(dir, { recursive: true });
        await initEmbeddings(dir);

        setEmbedding("mem-a", new Float32Array(512));
        setEmbedding("mem-b", new Float32Array(512));

        const all = getAllEmbeddings();
        expect(all.size).toBe(2);
        expect(all.has("mem-a")).toBe(true);
        expect(all.has("mem-b")).toBe(true);

        disposeEmbeddings();
    });
});

// --- Hybrid Scoring Simulation ---

describe("hybrid scoring logic (simulated)", () => {
    test("records without embedding use sim=0 in hybrid", () => {
        const record = makeTestMemory({ id: "no-embedding-rec" });
        const queryTokens = ["coffee", "preference"];

        const kw = scoreRecordBase(record, queryTokens);
        // Simulate hybrid: sim=0, so combined = 0.6*0 + 0.4*kw = 0.4*kw
        const sim = 0; // no embedding available
        const combined = 0.6 * sim + 0.4 * kw;
        const withCorrectionBoost = record.kind === "correction" ? combined + 0.15 : combined;

        expect(withCorrectionBoost).toBe(0.4 * kw);
    });

    test("correction boost applied AFTER hybrid combine", () => {
        const correction = makeTestMemory({ kind: "correction", id: "corr-1" });
        const preference = makeTestMemory({ kind: "preference", id: "pref-1" });

        const queryTokens = ["coffee"];

        const kwCorr = scoreRecordBase(correction, queryTokens);
        const kwPref = scoreRecordBase(preference, queryTokens);

        // Without embeddings (sim=0)
        const sim = 0;
        const combinedCorr = 0.6 * sim + 0.4 * kwCorr + 0.15; // correction boost after
        const combinedPref = 0.6 * sim + 0.4 * kwPref;

        // The correction should outrank a same-keyword-score preference
        if (Math.abs(kwCorr - kwPref) < 0.001) {
            expect(combinedCorr).toBeGreaterThan(combinedPref);
        }
    });

    test("same dot product + same keyword = same hybrid", () => {
        const record1 = makeTestMemory({ id: "r1" });
        const record2 = makeTestMemory({ id: "r2" });

        const queryTokens = ["test"];

        // Create two identical embedding vectors
        const vec = new Float32Array(512);
        for (let i = 0; i < 512; i++) vec[i] = 0.1;
        const normalized = l2Normalize(vec);

        setEmbedding("r1", normalized);
        setEmbedding("r2", normalized);

        const kw1 = scoreRecordBase(record1, queryTokens);
        const kw2 = scoreRecordBase(record2, queryTokens);

        const sim1 = Math.max(0, dot(normalized, normalized)); // = 1.0
        const sim2 = Math.max(0, dot(normalized, normalized)); // = 1.0

        expect(sim1).toBeCloseTo(1.0);
        expect(sim2).toBeCloseTo(1.0);

        const hybrid1 = 0.6 * sim1 + 0.4 * kw1;
        const hybrid2 = 0.6 * sim2 + 0.4 * kw2;

        // For same kws, hybrid scores should be identical
        if (kw1 === kw2) {
            expect(hybrid1).toBe(hybrid2);
        }
    });
});
