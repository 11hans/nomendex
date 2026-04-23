export type DiffOp = "equal" | "removed" | "added";
export interface DiffToken {
    op: DiffOp;
    text: string;
}

/** Split on whitespace boundaries, keeping whitespace as its own tokens. */
function tokenize(text: string): string[] {
    return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Word-level diff using LCS. Intended for short paragraphs (selection + AI output);
 * runs in O(n*m) which is fine at a few hundred tokens.
 */
export function wordDiff(before: string, after: string): DiffToken[] {
    const a = tokenize(before);
    const b = tokenize(after);
    const n = a.length;
    const m = b.length;

    // LCS DP
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const out: DiffToken[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ op: "equal", text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ op: "removed", text: a[i] });
            i++;
        } else {
            out.push({ op: "added", text: b[j] });
            j++;
        }
    }
    while (i < n) out.push({ op: "removed", text: a[i++] });
    while (j < m) out.push({ op: "added", text: b[j++] });
    return out;
}
