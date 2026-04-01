import { describe, expect, test } from "bun:test";
import { parseYearlyGoals, parseVisionGoals, parseMonthlyGoals } from "./migration";

// ---------------------------------------------------------------------------
// parseYearlyGoals
// ---------------------------------------------------------------------------

describe("parseYearlyGoals", () => {
    const YEARLY_MD_ESCAPED = `# Yearly Goals 2026

**Theme:** FOUNDATIONS

## Goals by Area

### Career & Professional

- \\[ \\] Nomendex v produkci — funkční SaaS
- \\[x\\] Najít a dokončit 2 AI projekty

### Health & Wellness

- \\[ \\] Vybudovat konzistentní pohybový návyk

## Quarterly Milestones

### Q2 (Apr–Jun) — LAUNCH & SYSTEMS

- \\[ \\] Nomendex spuštěn veřejně
- \\[ \\] Osobní web online

### Q3 (Jul–Sep) — TRACTION

- \\[ \\] Nomendex má prvních 5 platících uživatelů
`;

    const YEARLY_MD_STANDARD = `# Yearly Goals 2026

## Goals by Area

### Career & Professional

- [ ] Nomendex v produkci
- [x] AI projekt hotový

## Quarterly Milestones

### Q2 (Apr–Jun) — LAUNCH

- [ ] Deploy to production
`;

    test("parses escaped checkboxes \\[ \\]", () => {
        const goals = parseYearlyGoals(YEARLY_MD_ESCAPED, "test.md");
        const yearly = goals.filter(g => g.horizon === "yearly");
        expect(yearly.length).toBe(3);
        expect(yearly[0]!.title).toBe("Nomendex v produkci — funkční SaaS");
        expect(yearly[0]!.status).toBe("active");
        expect(yearly[0]!.area).toBe("Career & Professional");
    });

    test("parses completed \\[x\\] as completed", () => {
        const goals = parseYearlyGoals(YEARLY_MD_ESCAPED, "test.md");
        const completed = goals.filter(g => g.status === "completed");
        expect(completed.length).toBe(1);
        expect(completed[0]!.title).toBe("Najít a dokončit 2 AI projekty");
    });

    test("parses standard checkboxes [ ]", () => {
        const goals = parseYearlyGoals(YEARLY_MD_STANDARD, "test.md");
        const yearly = goals.filter(g => g.horizon === "yearly");
        expect(yearly.length).toBe(2);
        expect(yearly[0]!.title).toBe("Nomendex v produkci");
    });

    test("parses quarterly milestones", () => {
        const goals = parseYearlyGoals(YEARLY_MD_ESCAPED, "test.md");
        const quarterly = goals.filter(g => g.horizon === "quarterly");
        expect(quarterly.length).toBe(3);
        expect(quarterly[0]!.title).toBe("Nomendex spuštěn veřejně");
    });

    test("quarterly goals have targetDate", () => {
        const goals = parseYearlyGoals(YEARLY_MD_ESCAPED, "test.md");
        const q2 = goals.filter(g => g.horizon === "quarterly" && g.targetDate?.includes("06"));
        expect(q2.length).toBeGreaterThan(0);
    });

    test("assigns correct areas to yearly goals", () => {
        const goals = parseYearlyGoals(YEARLY_MD_ESCAPED, "test.md");
        const health = goals.filter(g => g.area === "Health & Wellness" && g.horizon === "yearly");
        expect(health.length).toBe(1);
    });

    test("strips **bold** from titles", () => {
        const md = `# Yearly Goals 2026

## Goals by Area

### Career

- [ ] **Bold title** here
`;
        const goals = parseYearlyGoals(md, "test.md");
        expect(goals[0]!.title).toBe("Bold title here");
    });

    test("returns empty for no checkboxes", () => {
        const md = `# Yearly Goals 2026

## Goals by Area

### Career

Nothing here.
`;
        const goals = parseYearlyGoals(md, "test.md");
        expect(goals.length).toBe(0);
    });

    test("ignores lines outside Goals by Area / Quarterly sections", () => {
        const md = `# Yearly Goals 2026

**Theme:** test

## This Year's Focus

- [ ] This should be ignored

## Goals by Area

### Career

- [ ] This counts

## Some Other Section

- [ ] This should be ignored too
`;
        const goals = parseYearlyGoals(md, "test.md");
        expect(goals.length).toBe(1);
        expect(goals[0]!.title).toBe("This counts");
    });
});

// ---------------------------------------------------------------------------
// parseVisionGoals
// ---------------------------------------------------------------------------

describe("parseVisionGoals", () => {
    const VISION_MD = `# 3-Year Vision

## Key Areas

### Career & Professional

- Become a senior engineer
- Build a SaaS product

### Health & Wellness

- Exercise 4x weekly
`;

    test("creates one goal per ### section under Key Areas", () => {
        const goals = parseVisionGoals(VISION_MD, "vision.md");
        expect(goals.length).toBe(2);
        expect(goals[0]!.area).toBe("Career & Professional");
        expect(goals[1]!.area).toBe("Health & Wellness");
    });

    test("vision goals have horizon=vision and progressMode=rollup", () => {
        const goals = parseVisionGoals(VISION_MD, "vision.md");
        for (const g of goals) {
            expect(g.horizon).toBe("vision");
            expect(g.progressMode).toBe("rollup");
        }
    });

    test("collects description from bullet lines", () => {
        const goals = parseVisionGoals(VISION_MD, "vision.md");
        expect(goals[0]!.description).toContain("senior engineer");
    });
});

// ---------------------------------------------------------------------------
// parseMonthlyGoals
// ---------------------------------------------------------------------------

describe("parseMonthlyGoals", () => {
    const MONTHLY_MD = `# Monthly Goals

## March 2026

### Goals

- [ ] Finish migration
- [x] Set up CI

## February 2026

### Goals

- [ ] Old goal
`;

    test("parses goals under monthly sections", () => {
        const goals = parseMonthlyGoals(MONTHLY_MD, "monthly.md");
        expect(goals.length).toBe(3);
    });

    test("goals have horizon=monthly", () => {
        const goals = parseMonthlyGoals(MONTHLY_MD, "monthly.md");
        for (const g of goals) {
            expect(g.horizon).toBe("monthly");
        }
    });

    test("completed checkbox → status completed", () => {
        const goals = parseMonthlyGoals(MONTHLY_MD, "monthly.md");
        const completed = goals.filter(g => g.status === "completed");
        expect(completed.length).toBe(1);
        expect(completed[0]!.title).toBe("Set up CI");
    });

    test("empty monthly file returns no goals", () => {
        const md = `# Monthly Goals

_No monthly goals defined._
`;
        const goals = parseMonthlyGoals(md, "monthly.md");
        expect(goals.length).toBe(0);
    });
});
