import path from "path";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";

export interface DatabaseRecord {
    id: string;
    [key: string]: unknown;
}

export interface QueryOptions<T> {
    where?: Partial<T>;
    orderBy?: keyof T;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
}

export class FileDatabase<T extends DatabaseRecord> {
    private basePath: string;
    private fileExtension: string = ".md";

    // Full-directory snapshot cache, populated lazily by find(). Own mutations
    // invalidate it synchronously; the directory watcher invalidates it on
    // external writes (git pull/checkout, agents editing files directly).
    // Only active while the watcher runs — without it we could never see
    // external changes, so we fall back to scanning on every find().
    private cache: Map<string, T> | null = null;
    // Bumped on every invalidation so a directory scan that raced with a
    // write can't store its (possibly already stale) snapshot.
    private cacheGeneration = 0;
    private watcher: FSWatcher | null = null;
    private cacheEnabled = false;

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    /**
     * Initialize the database directory
     */
    async initialize(): Promise<void> {
        await mkdir(this.basePath, { recursive: true });
        this.startWatcher();
    }

    private invalidateCache(): void {
        this.cache = null;
        this.cacheGeneration++;
    }

    private startWatcher(): void {
        this.stopWatcher();
        try {
            this.watcher = watch(this.basePath, () => {
                this.invalidateCache();
            });
            this.watcher.on("error", () => {
                this.stopWatcher();
            });
            // Never keep the process alive just for the cache watcher
            this.watcher.unref();
            this.cacheEnabled = true;
        } catch {
            this.cacheEnabled = false;
        }
    }

    private stopWatcher(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.cacheEnabled = false;
        this.invalidateCache();
    }

    /**
     * Stop the directory watcher and drop the cache. Call when replacing an
     * instance (e.g. on workspace switch) to avoid leaking watchers.
     */
    dispose(): void {
        this.stopWatcher();
    }

    /**
     * Convert a record to markdown with YAML frontmatter
     */
    private recordToFile(record: T): string {
        const { description, ...metadata } = record as Record<string, unknown>;

        // Build YAML frontmatter
        const yamlContent = Object.entries(metadata)
            .map(([key, value]) => {
                // Handle different value types
                if (value === null || value === undefined) {
                    return `${key}: null`;
                } else if (typeof value === "string") {
                    // Always quote empty strings or strings with special characters
                    if (value === "" || value.includes(":") || value.includes("\n") || value.includes("#") || /^\d/.test(value)) {
                        return `${key}: "${value.replace(/"/g, '\\"')}"`;
                    }
                    return `${key}: ${value}`;
                } else if (typeof value === "boolean") {
                    return `${key}: ${value}`;
                } else if (value instanceof Date) {
                    return `${key}: ${value.toISOString()}`;
                } else {
                    return `${key}: ${JSON.stringify(value)}`;
                }
            })
            .join("\n");

        // Build the full file content
        let content = `---\n${yamlContent}\n---\n`;

        if (description) {
            content += `\n${description}\n`;
        }

        return content;
    }

    /**
     * Parse a markdown file with YAML frontmatter to a record
     */
    private fileToRecord(content: string): T {
        // Extract frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            throw new Error("Invalid file format: missing frontmatter");
        }

        const yamlContent = frontmatterMatch[1];
        const bodyContent = content.slice(frontmatterMatch[0].length).trim();

        // Parse YAML frontmatter
        // @ts-ignore - Bun.YAML is available at runtime
        const metadata = (globalThis as any).Bun.YAML.parse(yamlContent) as Record<string, unknown>;

        // Convert numeric id to string if needed (for backward compatibility)
        if (typeof metadata.id === "number") {
            metadata.id = String(metadata.id);
        }

        // Note: We intentionally preserve null values to allow explicit field clearing
        // (e.g., clearing a dueDate field by setting it to null)

        // Add description from body if present
        if (bodyContent) {
            metadata.description = bodyContent;
        }

        return metadata as T;
    }

    /**
     * Get the file path for a record
     */
    private getFilePath(id: string): string {
        // Sanitize ID for filename
        const sanitizedId = id.replace(/[^a-zA-Z0-9-_]/g, "-");
        return path.join(this.basePath, `${sanitizedId}${this.fileExtension}`);
    }

    /**
     * Create a new record
     */
    async create(record: T): Promise<T> {
        const filePath = this.getFilePath(record.id);
        // Strip null/undefined so optional fields don't serialize as `key: null`
        // and then fail Zod re-validation on subsequent reads. Mirrors the strip
        // logic in update().
        const sanitized = { ...record };
        for (const key of Object.keys(sanitized)) {
            if ((sanitized as Record<string, unknown>)[key] == null) {
                delete (sanitized as Record<string, unknown>)[key];
            }
        }
        const content = this.recordToFile(sanitized as T);

        await Bun.write(filePath, content);
        // Invalidate synchronously — the watcher event from our own write is
        // async, so a find() racing right behind this write must not see a
        // stale snapshot.
        this.invalidateCache();
        return sanitized as T;
    }

    /**
     * Read a record by ID
     */
    async findById(id: string): Promise<T | null> {
        // Serve from the snapshot cache when warm; on a miss fall through to
        // the single-file read (ids whose frontmatter differs from the
        // sanitized filename aren't necessarily keyed in the cache).
        if (this.cacheEnabled && this.cache) {
            const cached = this.cache.get(id);
            if (cached) {
                return structuredClone(cached);
            }
        }

        const filePath = this.getFilePath(id);

        try {
            const file = Bun.file(filePath);
            if (!(await file.exists())) {
                return null;
            }

            const content = await file.text();
            return this.fileToRecord(content);
        } catch (error) {
            console.error(`Error reading record ${id}:`, error);
            return null;
        }
    }

    /**
     * Update a record
     */
    async update(id: string, updates: Partial<T>): Promise<T | null> {
        const existing = await this.findById(id);
        if (!existing) {
            return null;
        }

        const updated = { ...existing, ...updates, id }; // Ensure ID doesn't change
        // Remove null/undefined values so cleared fields don't persist in YAML
        for (const key of Object.keys(updated)) {
            if ((updated as any)[key] === null || (updated as any)[key] === undefined) {
                delete (updated as any)[key];
            }
        }
        const filePath = this.getFilePath(id);
        const content = this.recordToFile(updated);

        await Bun.write(filePath, content);
        this.invalidateCache();
        return updated;
    }

    /**
     * Delete a record
     */
    async delete(id: string): Promise<boolean> {
        const filePath = this.getFilePath(id);

        try {
            await unlink(filePath);
            this.invalidateCache();
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return false;
            }
            throw error;
        }
    }

    /**
     * Find all records matching query options
     */
    private async loadAllRecords(): Promise<T[]> {
        const files = await readdir(this.basePath);

        // Read all markdown files in parallel
        const parsed = await Promise.all(
            files
                .filter((fileName) => fileName.endsWith(this.fileExtension))
                .map(async (fileName): Promise<T | null> => {
                    const filePath = path.join(this.basePath, fileName);
                    try {
                        const content = await Bun.file(filePath).text();
                        return this.fileToRecord(content);
                    } catch (error) {
                        console.error(`Error reading file ${fileName}:`, error);
                        return null;
                    }
                }),
        );

        const records: T[] = [];
        for (const record of parsed) {
            if (record) {
                records.push(record);
            }
        }
        return records;
    }

    /**
     * All records as fresh objects — from the snapshot cache when warm,
     * otherwise from a directory scan (which warms the cache). Cloning keeps
     * the historical contract that every call returns independent objects,
     * so callers mutating results can't poison the cache.
     */
    private async getAllRecords(): Promise<T[]> {
        if (this.cacheEnabled && this.cache) {
            const records: T[] = [];
            for (const record of this.cache.values()) {
                records.push(structuredClone(record));
            }
            return records;
        }

        const generationAtScanStart = this.cacheGeneration;
        const loaded = await this.loadAllRecords();
        // Only cache if nothing was invalidated while we were scanning —
        // otherwise the snapshot may already miss a concurrent write.
        if (this.cacheEnabled && this.cacheGeneration === generationAtScanStart) {
            this.cache = new Map(loaded.map((record) => [record.id, structuredClone(record)]));
        }
        return loaded;
    }

    async find(options: QueryOptions<T> = {}): Promise<T[]> {
        const allRecords = await this.getAllRecords();

        const records: T[] = [];
        for (const record of allRecords) {

            // Apply where filters
            if (options.where) {
                let matches = true;
                for (const [key, value] of Object.entries(options.where)) {
                    if (record[key as keyof T] !== value) {
                        matches = false;
                        break;
                    }
                }
                if (!matches) continue;
            }

            records.push(record);
        }

        // Apply sorting
        if (options.orderBy) {
            records.sort((a, b) => {
                const aVal = a[options.orderBy as keyof T];
                const bVal = b[options.orderBy as keyof T];

                if (aVal < bVal) return options.order === "desc" ? 1 : -1;
                if (aVal > bVal) return options.order === "desc" ? -1 : 1;
                return 0;
            });
        }

        // Apply pagination
        let result = records;
        if (options.offset) {
            result = result.slice(options.offset);
        }
        if (options.limit) {
            result = result.slice(0, options.limit);
        }

        return result;
    }

    /**
     * Find all records (convenience method)
     */
    async findAll(): Promise<T[]> {
        return this.find();
    }

    /**
     * Count records matching query
     */
    async count(options: QueryOptions<T> = {}): Promise<number> {
        const records = await this.find({ ...options, limit: undefined, offset: undefined });
        return records.length;
    }

    /**
     * Check if a record exists
     */
    async exists(id: string): Promise<boolean> {
        const filePath = this.getFilePath(id);
        const file = Bun.file(filePath);
        return file.exists();
    }

    /**
     * Batch create multiple records
     */
    async createMany(records: T[]): Promise<T[]> {
        const results = await Promise.all(records.map((record) => this.create(record)));
        return results;
    }

    /**
     * Batch update multiple records
     */
    async updateMany(updates: Array<{ id: string; updates: Partial<T> }>): Promise<(T | null)[]> {
        const results = await Promise.all(updates.map(({ id, updates }) => this.update(id, updates)));
        return results;
    }

    /**
     * Clear all records (use with caution!)
     */
    async clear(): Promise<void> {
        const files = await readdir(this.basePath);

        await Promise.all(files.filter((f) => f.endsWith(this.fileExtension)).map((f) => unlink(path.join(this.basePath, f))));
        this.invalidateCache();
    }
}
