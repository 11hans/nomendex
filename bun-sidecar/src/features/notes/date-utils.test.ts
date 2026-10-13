import { describe, expect, test } from "bun:test";
import { formatDailyNoteDate, formatMomentDate, isSupportedDailyFormat, parseDailyNoteDate } from "./date-utils";

const oct5 = new Date(2026, 9, 5);

describe("formatDailyNoteDate", () => {
    test("formats the numeric Moment tokens", () => {
        expect(formatDailyNoteDate(oct5, "DD-MM-YYYY")).toBe("05-10-2026");
        expect(formatDailyNoteDate(oct5, "M-D-YYYY")).toBe("10-5-2026");
        expect(formatDailyNoteDate(oct5, "M-DD-YYYY")).toBe("10-05-2026");
        expect(formatDailyNoteDate(oct5, "YYYY-MM-DD")).toBe("2026-10-05");
        expect(formatDailyNoteDate(oct5, "[Den] D.M.YY")).toBe("Den 5.10.26");
    });

    test("defaults to M-D-YYYY and falls back to it for unsupported formats", () => {
        expect(formatDailyNoteDate(oct5)).toBe("10-5-2026");
        expect(formatDailyNoteDate(oct5, "dddd DD-MM-YYYY")).toBe("10-5-2026");
    });
});

describe("formatMomentDate", () => {
    test("formats time tokens and rejects unsupported ones", () => {
        expect(formatMomentDate(new Date(2026, 9, 5, 7, 3), "HH:mm")).toBe("07:03");
        expect(formatMomentDate(oct5, "MMMM")).toBeNull();
        expect(formatMomentDate(oct5, "Do")).toBeNull();
        expect(formatMomentDate(oct5, "[unclosed")).toBeNull();
    });
});

describe("isSupportedDailyFormat", () => {
    test("needs year, month and day and no folders", () => {
        expect(isSupportedDailyFormat("DD-MM-YYYY")).toBe(true);
        expect(isSupportedDailyFormat("YYYY-MM-DD")).toBe(true);
        expect(isSupportedDailyFormat("YYYY/MM/DD")).toBe(false);
        expect(isSupportedDailyFormat("MM-YYYY")).toBe(false);
        expect(isSupportedDailyFormat("ddd DD-MM-YYYY")).toBe(false);
        expect(isSupportedDailyFormat("")).toBe(false);
    });
});

describe("parseDailyNoteDate", () => {
    test("parses only the given format", () => {
        // The same name means 10 Nov as DD-MM-YYYY and 11 Oct as M-D-YYYY.
        expect(parseDailyNoteDate("10-11-2026.md", "DD-MM-YYYY")?.getTime()).toBe(new Date(2026, 10, 10).getTime());
        expect(parseDailyNoteDate("10-11-2026.md", "M-D-YYYY")?.getTime()).toBe(new Date(2026, 10 - 1, 11).getTime());
        expect(parseDailyNoteDate("10-13-2026.md", "DD-MM-YYYY")).toBeNull();
        expect(parseDailyNoteDate("2026-10-05.md", "DD-MM-YYYY")).toBeNull();
    });

    test("accepts numbers with or without a leading zero", () => {
        expect(parseDailyNoteDate("1-11-2026.md", "DD-MM-YYYY")?.getTime()).toBe(new Date(2026, 10, 1).getTime());
        expect(parseDailyNoteDate("01-11-2026", "DD-MM-YYYY")?.getTime()).toBe(new Date(2026, 10, 1).getTime());
    });

    test("round-trips formatDailyNoteDate", () => {
        for (const format of ["DD-MM-YYYY", "M-D-YYYY", "M-DD-YYYY", "YYYY-MM-DD", "[Den] D.M.YY"]) {
            expect(parseDailyNoteDate(`${formatDailyNoteDate(oct5, format)}.md`, format)?.getTime()).toBe(oct5.getTime());
        }
    });

    test("rejects conflict copies, impossible dates and other notes", () => {
        expect(parseDailyNoteDate("28-03-2026 2.md", "DD-MM-YYYY")).toBeNull();
        expect(parseDailyNoteDate("30-02-2026.md", "DD-MM-YYYY")).toBeNull();
        expect(parseDailyNoteDate("Mapa používání Nomendexu.md", "DD-MM-YYYY")).toBeNull();
        expect(parseDailyNoteDate("05-10-2026.md", "dddd")).toBeNull();
    });
});
