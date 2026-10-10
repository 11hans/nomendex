import { describe, expect, test } from "bun:test";
import { mergeNomendexHooks } from "./agent-editing";

const userGroup = { matcher: "Bash", hooks: [{ type: "command", command: "./my-hook.sh" }] };

describe("mergeNomendexHooks", () => {
    test("is idempotent across repeated workspace starts", () => {
        const once = mergeNomendexHooks({ PreToolUse: [userGroup] });
        const twice = mergeNomendexHooks(once);
        expect(twice).toEqual(once);
        expect(twice.PreToolUse).toHaveLength(2);
        expect(twice.PostToolUse).toHaveLength(1);
        expect(twice.SessionEnd).toHaveLength(1);
    });

    test("collapses unlock/cleanup duplicates left by older versions", () => {
        const once = mergeNomendexHooks({});
        const accumulated = {
            PreToolUse: once.PreToolUse,
            PostToolUse: [...once.PostToolUse, ...once.PostToolUse, ...once.PostToolUse],
            SessionEnd: [...once.SessionEnd, ...once.SessionEnd],
        };
        expect(mergeNomendexHooks(accumulated)).toEqual(once);
    });

    test("keeps user-defined groups in every event", () => {
        const merged = mergeNomendexHooks({ PostToolUse: [userGroup], Stop: [userGroup] });
        expect(merged.PostToolUse[0]).toEqual(userGroup);
        expect(merged.Stop).toEqual([userGroup]);
    });
});
