import { existsSync } from "node:fs";

export async function readJSONL<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return [];

  const content = await Bun.file(filePath).text();
  if (!content.trim()) return [];

  const result: T[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      result.push(JSON.parse(line) as T);
    } catch {
      // Ignore corrupted lines to keep service resilient
    }
  }

  return result;
}
