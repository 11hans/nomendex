export function generateUntitledNoteName(existingFileNames: Iterable<string>): string {
    const taken = new Set<string>();
    for (const name of existingFileNames) {
        const base = name.replace(/\.md$/i, "").toLowerCase();
        const lastSlash = base.lastIndexOf("/");
        const leaf = lastSlash >= 0 ? base.slice(lastSlash + 1) : base;
        taken.add(leaf);
    }
    if (!taken.has("untitled")) return "Untitled.md";
    let i = 1;
    while (taken.has(`untitled ${i}`)) i++;
    return `Untitled ${i}.md`;
}
