import { describe, expect, test } from "bun:test";
import { assertInboxMutationAllowed } from "./fx";

describe("project Inbox guardrails", () => {
    test("rejects archiving Inbox", () => {
        expect(() => assertInboxMutationAllowed({
            existingProjectName: "Inbox",
            operation: "archive",
        })).toThrow(/cannot be archived/i);
    });

    test("rejects deleting Inbox", () => {
        expect(() => assertInboxMutationAllowed({
            existingProjectName: "Inbox",
            operation: "delete",
        })).toThrow(/cannot be deleted/i);
    });

    test("rejects renaming Inbox to another name", () => {
        expect(() => assertInboxMutationAllowed({
            existingProjectName: "Inbox",
            operation: "rename",
            nextProjectName: "Client A",
        })).toThrow(/cannot be renamed/i);
    });

    test("rejects renaming non-Inbox project to Inbox", () => {
        expect(() => assertInboxMutationAllowed({
            existingProjectName: "Client A",
            operation: "rename",
            nextProjectName: "Inbox",
        })).toThrow(/reserved system project name/i);
    });

    test("allows non-Inbox project rename to another non-Inbox name", () => {
        expect(() => assertInboxMutationAllowed({
            existingProjectName: "Client A",
            operation: "rename",
            nextProjectName: "Client B",
        })).not.toThrow();
    });
});
