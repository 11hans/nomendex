import { describe, expect, it } from "bun:test";
import { dump, load } from "./yaml";

// Frontmatter semantics notes were written with (js-yaml 4); keep them stable across upgrades.
describe("yaml", () => {
  it("loads unquoted dates as Date and keeps YAML 1.1 words as strings", () => {
    const fm = load("date: 2024-01-15\nflag: yes\nstate: off\ncode: 0123\ntime: 12:30") as Record<string, unknown>;
    expect(fm.date).toEqual(new Date("2024-01-15T00:00:00.000Z"));
    expect(fm).toMatchObject({ flag: "yes", state: "off", code: 123, time: "12:30" });
  });

  it("resolves merge keys", () => {
    expect(load("base: &b {x: 1}\nderived:\n  <<: *b\n  y: 2")).toEqual({ base: { x: 1 }, derived: { x: 1, y: 2 } });
  });

  it("returns undefined for empty or comment-only frontmatter", () => {
    expect(load("")).toBeUndefined();
    expect(load("# just a comment")).toBeUndefined();
  });

  it("rejects multiple documents", () => {
    expect(() => load("a: 1\n---\nb: 2")).toThrow();
  });

  it("quotes date-like strings when dumping so they round-trip as strings", () => {
    const out = dump({ targetDate: "2026-12-31", lastSyncedAt: "2026-10-10T08:00:00.000Z", tags: ["a"] }, { lineWidth: -1 });
    expect(out).toBe("targetDate: '2026-12-31'\nlastSyncedAt: '2026-10-10T08:00:00.000Z'\ntags:\n  - a\n");
    expect(load(out)).toEqual({ targetDate: "2026-12-31", lastSyncedAt: "2026-10-10T08:00:00.000Z", tags: ["a"] });
  });
});
