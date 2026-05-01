/**
 * Canonical slug derivation for goal titles.
 *
 * Used in three places that must agree:
 * 1. createGoal — to build the goal id
 * 2. mirror-sync — to write/locate the per-goal mirror note at Goals/goals/{slug}.md
 * 3. initializeGoalsService repair sweep — to find existing mirror notes
 *
 * If these diverge, repair will miss long-titled goals because the mirror file
 * lives at a 50-char truncated path while the lookup uses the full title.
 */
export function slugFromTitle(title: string): string {
    let slug = title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");

    if (slug.length > 50) {
        slug = slug.substring(0, 50).replace(/-$/, "");
    }
    if (!slug) {
        slug = "untitled";
    }
    return slug;
}
