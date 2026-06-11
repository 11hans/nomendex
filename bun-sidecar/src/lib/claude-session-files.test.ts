import { describe, expect, test } from "bun:test";
import { claudeProjectDirName } from "./claude-session-files";

describe("claudeProjectDirName", () => {
    test("replaces slashes and keeps the leading dash", () => {
        expect(claudeProjectDirName("/Users/honza/Code/nomendex")).toBe("-Users-honza-Code-nomendex");
    });

    test("replaces spaces, tildes and dots, not just slashes", () => {
        expect(
            claudeProjectDirName("/Users/honza/Library/Mobile Documents/iCloud~md~obsidian/Documents/TheVault"),
        ).toBe("-Users-honza-Library-Mobile-Documents-iCloud-md-obsidian-Documents-TheVault");
        expect(claudeProjectDirName("/Users/foo/my.vault_x")).toBe("-Users-foo-my-vault-x");
    });
});
