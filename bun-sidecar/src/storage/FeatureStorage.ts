import path from "path";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";

export interface FolderInfo {
    name: string;
    path: string; // Relative path from basePath
}

/**
 * Simple file storage for features (replaces PluginStorage)
 * Uses direct paths like {workspace}/notes instead of nested plugin paths
 */
export class FeatureStorage {
    private basePath: string;

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    private async ensureDirectory(folder: string) {
        await mkdir(this.basePath, { recursive: true });
        const dataDir = path.join(this.basePath, folder);
        await mkdir(dataDir, { recursive: true });
    }

    async initializeFolder(folder: string) {
        await this.ensureDirectory(folder);
    }

    async initialize() {
        await mkdir(this.basePath, { recursive: true });
    }

    async readFile(filename: string): Promise<string | null> {
        const filePath = path.join(this.basePath, filename);
        const exists = await Bun.file(filePath).exists();
        if (!exists) {
            return null;
        }
        return await readFile(filePath, "utf-8");
    }

    async writeFile(filename: string, data: string): Promise<void> {
        const filePath = path.join(this.basePath, filename);
        await Bun.write(filePath, data, { createPath: true });
    }

    async listFiles(directory?: string, options?: { includeHidden?: boolean }): Promise<string[]> {
        const filePath = directory ? path.join(this.basePath, directory) : this.basePath;
        const includeHidden = options?.includeHidden ?? false;
        try {
            const entries = await readdir(filePath, { withFileTypes: true });
            const files: string[] = [];
            for (const entry of entries) {
                if (!includeHidden && entry.name.startsWith(".")) continue;
                if (entry.isFile()) {
                    files.push(entry.name);
                }
            }
            return files;
        } catch {
            return [];
        }
    }

    async createFile(filename: string, data: string): Promise<void> {
        const filePath = path.join(this.basePath, filename);
        await Bun.write(filePath, data, { createPath: true });
    }

    async fileExists(filename: string): Promise<boolean> {
        const filePath = path.join(this.basePath, filename);
        return await Bun.file(filePath).exists();
    }

    async deleteFile(filename: string): Promise<void> {
        const filePath = path.join(this.basePath, filename);
        await Bun.file(filePath).delete();
    }

    // Folder operations
    async createFolder(folderPath: string): Promise<void> {
        const fullPath = path.join(this.basePath, folderPath);
        await mkdir(fullPath, { recursive: true });
    }

    async deleteFolder(folderPath: string): Promise<void> {
        const fullPath = path.join(this.basePath, folderPath);
        await rm(fullPath, { recursive: true, force: true });
    }

    async folderExists(folderPath: string): Promise<boolean> {
        const fullPath = path.join(this.basePath, folderPath);
        try {
            const stats = await stat(fullPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    async listFolders(directory?: string, options?: { includeHidden?: boolean }): Promise<FolderInfo[]> {
        const basePath = directory ? path.join(this.basePath, directory) : this.basePath;
        const includeHidden = options?.includeHidden ?? false;
        try {
            const entries = await readdir(basePath, { withFileTypes: true });
            const folders: FolderInfo[] = [];
            for (const entry of entries) {
                if (!includeHidden && entry.name.startsWith(".")) continue;
                if (entry.isDirectory()) {
                    const relativePath = directory ? path.join(directory, entry.name) : entry.name;
                    folders.push({ name: entry.name, path: relativePath });
                }
            }
            return folders;
        } catch {
            return [];
        }
    }

    async listAllFoldersRecursive(directory?: string, options?: { includeHidden?: boolean }): Promise<FolderInfo[]> {
        const baseFolders = await this.listFolders(directory, options);

        const subFolderLists = await Promise.all(
            baseFolders.map((folder) => this.listAllFoldersRecursive(folder.path, options)),
        );

        const folders: FolderInfo[] = [];
        for (let i = 0; i < baseFolders.length; i++) {
            folders.push(baseFolders[i]!, ...subFolderLists[i]!);
        }

        return folders;
    }

    async moveFile(oldPath: string, newPath: string): Promise<void> {
        const content = await this.readFile(oldPath);
        if (content === null) {
            throw new Error(`File ${oldPath} not found`);
        }
        await this.writeFile(newPath, content);
        await this.deleteFile(oldPath);
    }

    async getFileMtime(filename: string): Promise<number | null> {
        const filePath = path.join(this.basePath, filename);
        const file = Bun.file(filePath);
        const exists = await file.exists();
        if (!exists) {
            return null;
        }
        const stats = await file.stat();
        return stats.mtimeMs;
    }
}
