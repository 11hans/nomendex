import { describe, expect, test } from "bun:test";
import {
    canonicalizeProjectFilter,
    canonicalizeTodoProject,
    INBOX_PROJECT_NAME,
    isInboxProjectName,
} from "./inbox-project";

describe("inbox project normalization", () => {
    test("canonicalizes empty and alias project values to Inbox", () => {
        expect(canonicalizeTodoProject(undefined)).toBe(INBOX_PROJECT_NAME);
        expect(canonicalizeTodoProject(null)).toBe(INBOX_PROJECT_NAME);
        expect(canonicalizeTodoProject("")).toBe(INBOX_PROJECT_NAME);
        expect(canonicalizeTodoProject("   ")).toBe(INBOX_PROJECT_NAME);
        expect(canonicalizeTodoProject("inbox")).toBe(INBOX_PROJECT_NAME);
        expect(canonicalizeTodoProject(" InBoX ")).toBe(INBOX_PROJECT_NAME);
    });

    test("preserves non-inbox project names", () => {
        expect(canonicalizeTodoProject("Roadmap")).toBe("Roadmap");
        expect(canonicalizeTodoProject("  Client X  ")).toBe("Client X");
    });

    test("canonicalizes project filters while keeping undefined unfiltered", () => {
        expect(canonicalizeProjectFilter(undefined)).toBeUndefined();
        expect(canonicalizeProjectFilter("")).toBe(INBOX_PROJECT_NAME);
        expect(canonicalizeProjectFilter("inbox")).toBe(INBOX_PROJECT_NAME);
        expect(canonicalizeProjectFilter("Focus")).toBe("Focus");
    });

    test("detects Inbox aliases", () => {
        expect(isInboxProjectName("Inbox")).toBe(true);
        expect(isInboxProjectName(" inbox ")).toBe(true);
        expect(isInboxProjectName("InBoX")).toBe(true);
        expect(isInboxProjectName("Inbox 2")).toBe(false);
        expect(isInboxProjectName(undefined)).toBe(false);
    });
});
