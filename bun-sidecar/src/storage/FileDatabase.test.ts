import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import { FileDatabase, type DatabaseRecord } from "./FileDatabase";

interface TestRecord extends DatabaseRecord {
    id: string;
    title: string;
    tags?: string[];
    description?: string;
}

const recordFile = (id: string, title: string) => `---\nid: ${id}\ntitle: ${title}\n---\n`;

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 2000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) return true;
        await Bun.sleep(25);
    }
    return condition();
}

describe("FileDatabase cache", () => {
    let dir: string;
    let db: FileDatabase<TestRecord>;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), "filedb-test-"));
        db = new FileDatabase<TestRecord>(dir);
        await db.initialize();
    });

    afterEach(async () => {
        db.dispose();
        await rm(dir, { recursive: true, force: true });
    });

    test("own mutations are immediately visible through find/findById", async () => {
        await db.create({ id: "a", title: "first" });
        expect((await db.findAll()).map((r) => r.id)).toEqual(["a"]);

        // Warm cache, then mutate — no waiting on watcher events allowed
        await db.create({ id: "b", title: "second" });
        expect((await db.findAll()).length).toBe(2);

        await db.update("a", { title: "renamed" });
        expect((await db.findById("a"))?.title).toBe("renamed");
        expect((await db.findAll()).find((r) => r.id === "a")?.title).toBe("renamed");

        await db.delete("b");
        expect((await db.findAll()).map((r) => r.id)).toEqual(["a"]);
        expect(await db.findById("b")).toBeNull();
    });

    test("mutating returned records does not poison the cache", async () => {
        await db.create({ id: "a", title: "clean", tags: ["x"] });

        const first = await db.findAll();
        first[0]!.title = "dirty";
        first[0]!.tags!.push("y");

        const second = await db.findAll();
        expect(second[0]!.title).toBe("clean");
        expect(second[0]!.tags).toEqual(["x"]);

        const byId = await db.findById("a");
        byId!.title = "dirty-again";
        expect((await db.findById("a"))!.title).toBe("clean");
    });

    test("external file writes invalidate the cache via watcher", async () => {
        await db.create({ id: "a", title: "first" });
        await db.findAll(); // warm cache

        // Write a file behind the database's back (like git pull or an agent)
        await writeFile(path.join(dir, "external.md"), recordFile("external", "from-outside"));

        const seen = await waitFor(async () => {
            const records = await db.findAll();
            return records.some((r) => r.id === "external");
        });
        expect(seen).toBe(true);
    });

    test("external file deletes invalidate the cache via watcher", async () => {
        await db.create({ id: "a", title: "first" });
        await db.create({ id: "b", title: "second" });
        await db.findAll(); // warm cache

        await unlink(path.join(dir, "a.md"));

        const gone = await waitFor(async () => {
            const records = await db.findAll();
            return records.length === 1 && records[0]!.id === "b";
        });
        expect(gone).toBe(true);
    });

    test("find filters, sorting, and pagination work from cache", async () => {
        await db.create({ id: "c", title: "3" });
        await db.create({ id: "a", title: "1" });
        await db.create({ id: "b", title: "2" });
        await db.findAll(); // warm cache

        const sorted = await db.find({ orderBy: "title", order: "desc" });
        expect(sorted.map((r) => r.title)).toEqual(["3", "2", "1"]);

        const paged = await db.find({ orderBy: "title", order: "asc", offset: 1, limit: 1 });
        expect(paged.map((r) => r.title)).toEqual(["2"]);

        const filtered = await db.find({ where: { title: "2" } as Partial<TestRecord> });
        expect(filtered.map((r) => r.id)).toEqual(["b"]);
    });

    test("works without initialize (cache disabled, plain scans)", async () => {
        const bareDir = await mkdtemp(path.join(tmpdir(), "filedb-bare-"));
        try {
            const bare = new FileDatabase<TestRecord>(bareDir);
            await bare.create({ id: "a", title: "first" });
            expect((await bare.findAll()).map((r) => r.id)).toEqual(["a"]);

            await writeFile(path.join(bareDir, "external.md"), recordFile("external", "outside"));
            // No watcher — but also no cache, so the new file is seen immediately
            expect((await bare.findAll()).length).toBe(2);
            bare.dispose();
        } finally {
            await rm(bareDir, { recursive: true, force: true });
        }
    });
});
