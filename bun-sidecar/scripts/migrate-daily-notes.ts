/**
 * Moves daily notes into the folder and file name format set in Obsidian's Daily notes
 * settings (.obsidian/daily-notes.json) and rewrites the links that point at them.
 *
 *   bun scripts/migrate-daily-notes.ts --vault <path> [--from-folder daily-notes] [--from-format M-D-YYYY] [--apply]
 *
 * Without --apply it only prints what it would do. It never overwrites a file: a note
 * whose new name is taken stays where it is, and so do its links.
 */

import path from "node:path";
import { mkdir, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { formatDailyNoteDate, isSupportedDailyFormat, parseDailyNoteDate } from "../src/features/notes/date-utils";

const SKIPPED_DIRS = new Set([".git", ".claude", ".obsidian", ".nomendex", ".trash", "node_modules"]);

const { values: args } = parseArgs({
    options: {
        vault: { type: "string" },
        "from-folder": { type: "string", default: "daily-notes" },
        "from-format": { type: "string", default: "M-D-YYYY" },
        apply: { type: "boolean", default: false },
    },
});

function fail(message: string): never {
    console.error(`✗ ${message}`);
    process.exit(1);
}

const vault = args.vault ? path.resolve(args.vault) : fail("--vault <path> is required");
const fromFolder = normalizeFolder(args["from-folder"] ?? "");
const fromFormat = args["from-format"] ?? "";
if (!isSupportedDailyFormat(fromFormat)) fail(`Unsupported --from-format "${fromFormat}"`);

const settingsFile = Bun.file(path.join(vault, ".obsidian", "daily-notes.json"));
if (!(await settingsFile.exists())) fail(`${settingsFile.name} not found`);
const obsidian = z.object({ folder: z.string().optional(), format: z.string().optional() }).parse(await settingsFile.json());
const toFolder = normalizeFolder(obsidian.folder ?? "");
const toFormat = obsidian.format?.trim() || "YYYY-MM-DD";
if (toFolder === fromFolder) fail(`Obsidian still keeps daily notes in "${fromFolder}"; set the new folder there first`);
if (!isSupportedDailyFormat(toFormat)) fail(`Obsidian's daily note format "${toFormat}" isn't supported`);

const fromDir = path.join(vault, fromFolder);
const toDir = path.join(vault, toFolder);
const fromPrefix = fromFolder ? `${fromFolder}/` : "";
const toPrefix = toFolder ? `${toFolder}/` : "";

console.log(`${args.apply ? "APPLY" : "DRY RUN"}  ${fromPrefix || "./"}${fromFormat}  →  ${toPrefix || "./"}${toFormat}\n`);

// --- Renames -------------------------------------------------------------------------

// "3-28-2026" → "28-03-2026"; iCloud conflict copies ("3-28-2026 2") keep their suffix.
function convertName(stem: string): string | null {
    const { date: datePart, copy } = stem.match(/^(?<date>.*?)(?<copy>(?: \d+)?)$/)?.groups ?? { date: stem, copy: "" };
    const date = parseDailyNoteDate(datePart, fromFormat);
    return date ? `${formatDailyNoteDate(date, toFormat)}${copy}` : null;
}

type Rename = { from: string; to: string };
const renames: Rename[] = [];
const skipped: string[] = [];
const unparsed: string[] = [];
const takenTargets = new Set<string>();

const sourceEntries = await readdir(fromDir).catch(() => fail(`${fromDir} not found`));
for (const name of sourceEntries.sort()) {
    if (!name.endsWith(".md")) continue;
    const stem = name.slice(0, -3);
    const target = convertName(stem);
    if (!target) {
        unparsed.push(name);
        continue;
    }
    if (takenTargets.has(target) || (await Bun.file(path.join(toDir, `${target}.md`)).exists())) {
        skipped.push(`${name} → ${toPrefix}${target}.md already exists`);
        continue;
    }
    takenTargets.add(target);
    renames.push({ from: stem, to: target });
}

const renameMap = new Map(renames.map((r) => [r.from, r.to]));
// Notes that stay put (unparsed or skipped) keep their links.
const stayingNames = new Set(sourceEntries.filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3)));
for (const r of renames) stayingNames.delete(r.from);

// The new name for a link to `stem`: a moved note, or a day without a note (yesterday/tomorrow
// links), which should create the note in the new place when clicked.
function linkName(stem: string): string | null {
    return renameMap.get(stem) ?? (stayingNames.has(stem) ? null : convertName(stem));
}

// Oldest first, so the preview's ends are the first and the last day.
const dayOf = (stem: string) => parseDailyNoteDate(stem.replace(/ \d+$/, ""), fromFormat)?.getTime() ?? 0;
renames.sort((x, y) => dayOf(x.from) - dayOf(y.from) || x.from.localeCompare(y.from));

console.log(`Renames: ${renames.length}`);
const preview = renames.length > 10 ? [...renames.slice(0, 5), null, ...renames.slice(-5)] : renames;
for (const r of preview) {
    console.log(r ? `  ${fromPrefix}${r.from}.md → ${toPrefix}${r.to}.md` : "  …");
}
if (skipped.length) {
    console.log(`\nSkipped (target taken, note and its links stay): ${skipped.length}`);
    for (const line of skipped) console.log(`  ${line}`);
}
if (unparsed.length) {
    console.log(`\nNot in ${fromFormat}, left in ${fromPrefix || "./"}: ${unparsed.length}`);
    for (const name of unparsed) console.log(`  ${name}`);
}

// --- Links ---------------------------------------------------------------------------

// The new link target for a link to `target` (an Obsidian path, maybe with .md), or null.
function rewriteTarget(target: string): string | null {
    const ext = target.endsWith(".md") ? ".md" : "";
    const linkPath = ext ? target.slice(0, -3) : target;
    if (fromPrefix && linkPath.startsWith(fromPrefix)) {
        const renamed = linkName(linkPath.slice(fromPrefix.length));
        return renamed ? `${toPrefix}${renamed}${ext}` : null;
    }
    // A bare [[3-28-2026]] resolves by file name, so it stays bare; only notes that moved.
    if (!linkPath.includes("/")) {
        const renamed = renameMap.get(linkPath);
        return renamed ? `${renamed}${ext}` : null;
    }
    return null;
}

function rewriteLinks(content: string): { content: string; count: number } {
    let count = 0;
    // [[target]], [[target|alias]], [[target#heading]], [[target^block]], and the ![[…]] forms.
    let result = content.replace(/\[\[([^\]|#^\n]+?)(?=[\]|#^])/g, (match, target: string) => {
        const rewritten = rewriteTarget(target);
        if (rewritten === null) return match;
        count++;
        return `[[${rewritten}`;
    });
    // [text](daily-notes/3-28-2026.md), spaces possibly as %20.
    result = result.replace(/\]\(([^)\s]+?\.md)(?=[)#])/g, (match, target: string) => {
        const encoded = target.includes("%20");
        const rewritten = rewriteTarget(encoded ? target.replace(/%20/g, " ") : target);
        if (rewritten === null) return match;
        count++;
        return `](${encoded ? rewritten.replace(/ /g, "%20") : rewritten}`;
    });
    return { content: result, count };
}

async function* markdownFiles(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) yield* markdownFiles(path.join(dir, entry.name));
        } else if (entry.name.endsWith(".md")) {
            yield path.join(dir, entry.name);
        }
    }
}

// Decode strictly so a file that isn't valid UTF-8 is reported instead of mangled; the
// BOM is kept so the rewritten file differs only in its links.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const linkUpdates: { file: string; content: string; count: number }[] = [];
const leftovers: string[] = [];
const undecodable: string[] = [];

for await (const file of markdownFiles(vault)) {
    let content: string;
    try {
        content = decoder.decode(await Bun.file(file).arrayBuffer());
    } catch {
        undecodable.push(path.relative(vault, file));
        continue;
    }
    const updated = rewriteLinks(content);
    if (updated.count > 0) linkUpdates.push({ file, content: updated.content, count: updated.count });
    const remaining = fromPrefix ? updated.content.split(fromPrefix).length - 1 : 0;
    if (remaining > 0) leftovers.push(`${path.relative(vault, file)} (${remaining}×)`);
}

linkUpdates.sort((a, b) => a.file.localeCompare(b.file));
const linkTotal = linkUpdates.reduce((sum, u) => sum + u.count, 0);
console.log(`\nLinks rewritten: ${linkTotal} in ${linkUpdates.length} files`);
for (const u of linkUpdates) console.log(`  ${String(u.count).padStart(3)}  ${path.relative(vault, u.file)}`);
if (leftovers.length) {
    console.log(`\nStill mention "${fromPrefix}" (check by hand):`);
    for (const line of leftovers) console.log(`  ${line}`);
}
if (undecodable.length) {
    console.log(`\nNot UTF-8, links not checked:`);
    for (const line of undecodable) console.log(`  ${line}`);
}

// --- vault-config.json ---------------------------------------------------------------

const vaultConfigPath = path.join(vault, "vault-config.json");
let vaultConfig: string | null = null;
if (await Bun.file(vaultConfigPath).exists()) {
    const original = await Bun.file(vaultConfigPath).text();
    // Edit the one value in place so the rest of the file keeps its formatting.
    const updated = original.replace(/("dailyNotes"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(toFolder || ".")}`);
    if (updated !== original) vaultConfig = updated;
}
console.log(`\nvault-config.json folderMapping.dailyNotes → ${vaultConfig ? `"${toFolder || "."}"` : "no change"}`);

if (!args.apply) {
    console.log("\nDry run, nothing changed. Run again with --apply.");
    process.exit(0);
}

// --- Apply ---------------------------------------------------------------------------

await mkdir(toDir, { recursive: true });
// Files that were moved get their links rewritten at the new path.
const movedTo = new Map<string, string>();
for (const r of renames) {
    const source = path.join(fromDir, `${r.from}.md`);
    const target = path.join(toDir, `${r.to}.md`);
    // Checked again right before moving, in case something created it meanwhile.
    if (await Bun.file(target).exists()) {
        console.error(`✗ ${target} appeared meanwhile, ${r.from}.md not moved`);
        continue;
    }
    await rename(source, target);
    movedTo.set(source, target);
}

for (const u of linkUpdates) {
    await Bun.write(movedTo.get(u.file) ?? u.file, u.content);
}

if (vaultConfig) await Bun.write(vaultConfigPath, vaultConfig);

const remainingEntries = (await readdir(fromDir)).filter((name) => name !== ".DS_Store");
if (remainingEntries.length === 0) {
    await unlink(path.join(fromDir, ".DS_Store")).catch(() => undefined);
    await rmdir(fromDir);
    console.log(`\nRemoved the empty ${fromPrefix}`);
} else {
    console.log(`\n${fromPrefix} kept, it still holds: ${remainingEntries.join(", ")}`);
}

console.log(`\nDone: ${movedTo.size} notes moved, ${linkTotal} links rewritten.`);

function normalizeFolder(folder: string): string {
    const trimmed = folder.trim().replace(/^\/+|\/+$/g, "");
    return trimmed ? path.normalize(trimmed) : "";
}
