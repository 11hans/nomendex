import path from "node:path";
import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { hasActiveWorkspace, getNomendexPath } from "@/storage/root-path";
import { WorkspaceStateSchema } from "@/types/Workspace";
import { createHash } from "crypto";
import {
    cleanupExpired,
    deleteMemoryRaw,
    loadAllNormalized,
    updateMemoryFields,
} from "./fx";
import { getAllEmbeddings, removeEmbedding } from "./embeddings";
import type { AgentMemoryRecord } from "./index";

const logger = createServiceLogger("AGENT_MEMORY_MAINT");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const AI_CONSOLIDATION_MIN_RECORDS = 10;
const AI_CONSOLIDATION_MAX_RECORDS = 80;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type IntegrityIssue =
    | { id: string; reason: "empty-content" }
    | { id: string; reason: "fingerprint-mismatch"; expected: string; actual: string };

export interface MaintenanceReport {
    cleanupOk: boolean;
    repairedSupersedes: number;
    orphanEmbeddingsRemoved: number;
    integrityIssues: IntegrityIssue[];
    aiConsolidation?: ConsolidationReport;
}

export interface ConsolidationReport {
    provider: "openrouter" | "claude" | "skipped";
    proposals: number;
    pruned: number;
    superseded: number;
    merged: number;
    failed: number;
    reason?: string;
}

// ---------------------------------------------------------------------------
// Mechanical maintenance
// ---------------------------------------------------------------------------

/**
 * Walk every record's `supersedes[]` and drop ids that no longer exist in the DB.
 * These dead refs accumulate when a superseded record is later pruned by decay/TTL.
 */
export async function repairSupersedes(): Promise<number> {
    const all = await loadAllNormalized();
    const liveIds = new Set(all.map((r) => r.id));
    let repaired = 0;

    for (const record of all) {
        const sup = record.supersedes ?? [];
        if (sup.length === 0) continue;
        const cleaned = sup.filter((id) => liveIds.has(id));
        if (cleaned.length === sup.length) continue;
        try {
            await updateMemoryFields(record.id, { supersedes: cleaned });
            repaired++;
        } catch (err) {
            logger.warn("Failed to repair supersedes", {
                id: record.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return repaired;
}

/**
 * Remove embeddings whose owning record is gone. Same logic as service init,
 * exposed here so the daily loop can re-run it.
 */
export async function sweepOrphanEmbeddings(): Promise<number> {
    const all = await loadAllNormalized();
    const liveIds = new Set(all.map((r) => r.id));
    let removed = 0;
    for (const eid of getAllEmbeddings().keys()) {
        if (!liveIds.has(eid)) {
            removeEmbedding(eid);
            removed++;
        }
    }
    return removed;
}

function computeFingerprint(title: string, text: string, kind: string, scope: string): string {
    const normalized = `${title.trim().toLowerCase()}|${text.trim().toLowerCase()}|${kind}|${scope}`;
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Read-only sanity check: empty title+text, fingerprint drift.
 * Returns issues; does not mutate.
 */
export async function runIntegrityCheck(): Promise<IntegrityIssue[]> {
    const all = await loadAllNormalized();
    const issues: IntegrityIssue[] = [];

    for (const r of all) {
        if (!r.title.trim() && !r.text.trim()) {
            issues.push({ id: r.id, reason: "empty-content" });
            continue;
        }
        const expected = computeFingerprint(r.title, r.text, r.kind, r.scope);
        if (expected !== r.fingerprint) {
            issues.push({
                id: r.id,
                reason: "fingerprint-mismatch",
                expected,
                actual: r.fingerprint,
            });
        }
    }

    return issues;
}

// ---------------------------------------------------------------------------
// AI consolidation (single-pass Proposer)
// ---------------------------------------------------------------------------

type ConsolidationProposal =
    | { type: "prune"; id: string; reason?: string }
    | { type: "supersede"; winnerId: string; loserIds: string[]; reason?: string }
    | { type: "merge"; winnerId: string; loserIds: string[]; reason?: string };

const CONSOLIDATION_SYSTEM_PROMPT = `You are a memory librarian. Given a list of memory records, propose minimal cleanup actions.

Allowed proposal types:
- "prune"     — record is obsolete or noise; should be deleted entirely.
- "supersede" — one record fully replaces others; archive losers, keep winner.
- "merge"     — multiple records describe the same fact; pick a winner, archive losers.

Conservative rules:
- Only propose changes when you are confident the records are about the SAME fact / preference / project.
- Different kinds (preference vs decision vs project) are almost never duplicates.
- "correction" kind records must NEVER be pruned, superseded, or merged away.
- Records with importance >= 0.7 should rarely be pruned.
- If unsure, propose nothing.

Output strict JSON only, no prose:
{ "proposals": [ { "type": "prune", "id": "..." }, { "type": "supersede", "winnerId": "...", "loserIds": ["..."] } ] }`;

function buildConsolidationUserContent(records: AgentMemoryRecord[]): string {
    const lines: string[] = ["Memories:"];
    for (const r of records) {
        const title = r.title.replace(/\s+/g, " ").slice(0, 120);
        const text = r.text.replace(/\s+/g, " ").slice(0, 240);
        lines.push(
            `[${r.id}] (kind=${r.kind}, scope=${r.scope}, imp=${r.importance.toFixed(2)}) ${title} — ${text}`,
        );
    }
    return lines.join("\n");
}

function parseConsolidationProposals(raw: string): ConsolidationProposal[] {
    const trimmed = raw.trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    } catch {
        return [];
    }

    if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray((parsed as { proposals?: unknown }).proposals)
    ) {
        return [];
    }

    const out: ConsolidationProposal[] = [];
    for (const p of (parsed as { proposals: unknown[] }).proposals) {
        if (!p || typeof p !== "object") continue;
        const obj = p as Record<string, unknown>;
        if (obj.type === "prune" && typeof obj.id === "string") {
            out.push({ type: "prune", id: obj.id, reason: typeof obj.reason === "string" ? obj.reason : undefined });
        } else if (
            (obj.type === "supersede" || obj.type === "merge") &&
            typeof obj.winnerId === "string" &&
            Array.isArray(obj.loserIds)
        ) {
            const losers = obj.loserIds.filter((x): x is string => typeof x === "string");
            if (losers.length === 0) continue;
            out.push({
                type: obj.type,
                winnerId: obj.winnerId,
                loserIds: losers,
                reason: typeof obj.reason === "string" ? obj.reason : undefined,
            });
        }
    }
    return out;
}

interface ExtractionWorkspaceConfig {
    provider: "disabled" | "openrouter" | "claude";
    openRouterModel: string;
    consolidationModel: string;
}

async function loadExtractionWorkspaceConfig(): Promise<ExtractionWorkspaceConfig | null> {
    if (!hasActiveWorkspace()) return null;
    try {
        const file = Bun.file(path.join(getNomendexPath(), "workspace.json"));
        if (!(await file.exists())) return null;
        const raw = await file.json();
        const state = WorkspaceStateSchema.parse(raw);
        return {
            provider: state.memoryExtraction.provider,
            openRouterModel: state.memoryExtraction.openRouterModel,
            consolidationModel: state.memoryExtraction.consolidationModel,
        };
    } catch (err) {
        logger.warn("Failed to read extraction config for consolidation", {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

async function callOpenRouterForProposals(params: {
    apiKey: string;
    model: string;
    records: AgentMemoryRecord[];
}): Promise<ConsolidationProposal[]> {
    const { apiKey, model, records } = params;
    const body = {
        model,
        messages: [
            { role: "system", content: CONSOLIDATION_SYSTEM_PROMPT },
            { role: "user", content: buildConsolidationUserContent(records) },
        ],
        temperature: 0.1,
        max_tokens: 1500,
    };

    const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://nomendex.app",
            "X-Title": "Nomendex Memory Consolidation",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "(unreadable)");
        throw new Error(`OpenRouter API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return parseConsolidationProposals(content);
}

/**
 * Pick the highest-signal active records as candidates for the consolidation pass.
 * - Skip archived / corrections / very high importance.
 * - Sort by importance asc + age asc (older, lower-importance first → most likely junk to consolidate).
 */
function selectConsolidationCandidates(all: AgentMemoryRecord[]): AgentMemoryRecord[] {
    const nowIso = new Date().toISOString();
    const filtered = all.filter((r) => {
        if (r.archived) return false;
        if (r.kind === "correction") return false;
        if (r.expiresAt && r.expiresAt < nowIso) return false;
        if (r.importance >= 0.9) return false;
        return true;
    });
    filtered.sort((a, b) => {
        const impDiff = a.importance - b.importance;
        if (impDiff !== 0) return impDiff;
        return a.updatedAt.localeCompare(b.updatedAt);
    });
    return filtered.slice(0, AI_CONSOLIDATION_MAX_RECORDS);
}

async function applyProposal(
    proposal: ConsolidationProposal,
    byId: Map<string, AgentMemoryRecord>,
): Promise<{ ok: boolean; kind: "prune" | "supersede" | "merge" }> {
    const nowIso = new Date().toISOString();

    if (proposal.type === "prune") {
        const target = byId.get(proposal.id);
        if (!target) return { ok: false, kind: "prune" };
        if (target.kind === "correction" || target.importance >= 0.7) {
            return { ok: false, kind: "prune" };
        }
        const ok = await deleteMemoryRaw(proposal.id);
        return { ok, kind: "prune" };
    }

    // supersede / merge: same shape — winner stays, losers archived
    const winner = byId.get(proposal.winnerId);
    if (!winner) return { ok: false, kind: proposal.type };

    const livLosers: string[] = [];
    for (const loserId of proposal.loserIds) {
        if (loserId === winner.id) continue;
        const loser = byId.get(loserId);
        if (!loser) continue;
        if (loser.kind === "correction") continue;
        if (loser.importance >= 0.7) continue;
        // Cross-scope safety: never archive a workspace memory in favor of an agent one.
        if (loser.scope === "workspace" && winner.scope === "agent") continue;
        livLosers.push(loserId);
    }
    if (livLosers.length === 0) return { ok: false, kind: proposal.type };

    let anyOk = false;
    for (const loserId of livLosers) {
        try {
            await updateMemoryFields(loserId, { archived: true, updatedAt: nowIso });
            anyOk = true;
        } catch (err) {
            logger.warn("Failed to archive loser in consolidation", {
                loserId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    if (anyOk) {
        const mergedSupersedes = [
            ...new Set([...(winner.supersedes ?? []), ...livLosers]),
        ];
        try {
            await updateMemoryFields(winner.id, {
                supersedes: mergedSupersedes,
                updatedAt: nowIso,
            });
        } catch (err) {
            logger.warn("Failed to update winner supersedes in consolidation", {
                winnerId: winner.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { ok: anyOk, kind: proposal.type };
}

export async function runAIConsolidation(): Promise<ConsolidationReport> {
    const config = await loadExtractionWorkspaceConfig();
    if (!config || config.provider === "disabled") {
        return {
            provider: "skipped",
            proposals: 0,
            pruned: 0,
            superseded: 0,
            merged: 0,
            failed: 0,
            reason: "extraction disabled",
        };
    }

    // Resolve model: both openrouter and claude providers use OpenRouter API.
    // The "claude" provider simply pins the model to Claude Sonnet 4.6.
    const apiKey = await secrets.get("OPENROUTER_API_KEY");
    if (!apiKey) {
        return {
            provider: "skipped",
            proposals: 0,
            pruned: 0,
            superseded: 0,
            merged: 0,
            failed: 0,
            reason: "OPENROUTER_API_KEY missing",
        };
    }

    const all = await loadAllNormalized();
    if (all.filter((r) => !r.archived).length < AI_CONSOLIDATION_MIN_RECORDS) {
        return {
            provider: "skipped",
            proposals: 0,
            pruned: 0,
            superseded: 0,
            merged: 0,
            failed: 0,
            reason: "too few active records",
        };
    }

    const candidates = selectConsolidationCandidates(all);
    if (candidates.length < AI_CONSOLIDATION_MIN_RECORDS) {
        return {
            provider: "skipped",
            proposals: 0,
            pruned: 0,
            superseded: 0,
            merged: 0,
            failed: 0,
            reason: "no consolidation candidates",
        };
    }

    let proposals: ConsolidationProposal[] = [];
    try {
        proposals = await callOpenRouterForProposals({
            apiKey,
            model: config.consolidationModel,
            records: candidates,
        });
    } catch (err) {
        logger.warn("AI consolidation provider call failed", {
            provider: config.provider,
            model: config.consolidationModel,
            error: err instanceof Error ? err.message : String(err),
        });
        return {
            provider: config.provider,
            proposals: 0,
            pruned: 0,
            superseded: 0,
            merged: 0,
            failed: 1,
            reason: "provider error",
        };
    }

    const byId = new Map(all.map((r) => [r.id, r]));
    let pruned = 0;
    let superseded = 0;
    let merged = 0;
    let failed = 0;

    for (const proposal of proposals) {
        const result = await applyProposal(proposal, byId);
        if (!result.ok) {
            failed++;
            continue;
        }
        if (result.kind === "prune") pruned++;
        else if (result.kind === "supersede") superseded++;
        else if (result.kind === "merge") merged++;
    }

    return {
        provider: config.provider,
        proposals: proposals.length,
        pruned,
        superseded,
        merged,
        failed,
    };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runDailyMaintenance(options: { runAI?: boolean } = {}): Promise<MaintenanceReport> {
    const { runAI = true } = options;
    const startedAt = Date.now();

    let cleanupOk = true;
    try {
        await cleanupExpired();
    } catch (err) {
        cleanupOk = false;
        logger.warn("cleanupExpired failed during daily maintenance", {
            error: err instanceof Error ? err.message : String(err),
        });
    }

    let repairedSupersedes = 0;
    try {
        repairedSupersedes = await repairSupersedes();
    } catch (err) {
        logger.warn("repairSupersedes failed", {
            error: err instanceof Error ? err.message : String(err),
        });
    }

    let orphanEmbeddingsRemoved = 0;
    try {
        orphanEmbeddingsRemoved = await sweepOrphanEmbeddings();
    } catch (err) {
        logger.warn("sweepOrphanEmbeddings failed", {
            error: err instanceof Error ? err.message : String(err),
        });
    }

    let integrityIssues: IntegrityIssue[] = [];
    try {
        integrityIssues = await runIntegrityCheck();
    } catch (err) {
        logger.warn("runIntegrityCheck failed", {
            error: err instanceof Error ? err.message : String(err),
        });
    }

    let aiConsolidation: ConsolidationReport | undefined;
    if (runAI) {
        try {
            aiConsolidation = await runAIConsolidation();
        } catch (err) {
            logger.warn("runAIConsolidation threw unexpectedly", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const report: MaintenanceReport = {
        cleanupOk,
        repairedSupersedes,
        orphanEmbeddingsRemoved,
        integrityIssues,
        aiConsolidation,
    };

    logger.info("Daily memory maintenance complete", {
        durationMs: Date.now() - startedAt,
        repairedSupersedes,
        orphanEmbeddingsRemoved,
        integrityIssueCount: integrityIssues.length,
        aiConsolidation,
    });

    return report;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function computeMsUntilNext(hour: number, minute: number): number {
    const now = new Date();
    const target = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hour,
        minute,
        0,
        0,
    );
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
}

/**
 * Schedule daily maintenance at `hour`:00 local time. Returns a dispose function
 * that cancels the pending timer / interval. Safe to call multiple times.
 */
export function startDailyMaintenance(hour = 22): () => void {
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let loopTimer: ReturnType<typeof setInterval> | null = null;

    const run = () => {
        runDailyMaintenance().catch((err) => {
            logger.warn("Scheduled maintenance run failed", {
                error: err instanceof Error ? err.message : String(err),
            });
        });
    };

    const msUntilTarget = computeMsUntilNext(hour, 0);
    initialTimer = setTimeout(() => {
        initialTimer = null;
        run();
        loopTimer = setInterval(run, ONE_DAY_MS);
        if (loopTimer && typeof loopTimer === "object" && "unref" in loopTimer) {
            loopTimer.unref();
        }
    }, msUntilTarget);
    if (initialTimer && typeof initialTimer === "object" && "unref" in initialTimer) {
        initialTimer.unref();
    }

    logger.info("Daily memory maintenance scheduled", {
        hour,
        msUntilFirstRun: msUntilTarget,
    });

    return () => {
        if (initialTimer) {
            clearTimeout(initialTimer);
            initialTimer = null;
        }
        if (loopTimer) {
            clearInterval(loopTimer);
            loopTimer = null;
        }
    };
}
