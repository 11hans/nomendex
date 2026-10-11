import { describe, expect, test } from "bun:test";
import { isAutoAllowedLocalApiCurl } from "./local-api-curl";

const allowed = (command: string) => isAutoAllowedLocalApiCurl(command, 1299);

describe("isAutoAllowedLocalApiCurl", () => {
    test("allows the calls BPagent makes during /daily", () => {
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths`)).toBe(true);
        expect(allowed(`curl -s -X POST "http://localhost:1299/api/todos/list" -H "Content-Type: application/json" -d '{"statuses":["todo","planned","in_progress"]}'`)).toBe(true);
        expect(allowed(`curl -s -X POST "http://localhost:1299/api/todos/list" -H "Content-Type: application/json" -d '{"kinds":["event"],"scheduledOverlap":{"start":"2026-10-10T00:00:00","end":"2026-10-10T23:59:59"}}' | head -c 5000`)).toBe(true);
        expect(allowed(`curl -s -m 10 http://localhost:1299/api/insights/scan -X POST -H 'Content-Type: application/json' -d '{}' | head -c 4000`)).toBe(true);
        expect(allowed(`curl -sS -XPOST http://127.0.0.1:1299/api/goals/graph/forest --json '{}'`)).toBe(true);
        expect(allowed(`curl -s -X POST http://localhost:1299/api/todos/update \\\n  -H "Content-Type: application/json" \\\n  -d '{"id":"t1","updates":{"status":"done; rm -rf ~"}}'`)).toBe(true);
    });

    test("rejects anything besides the one local URL", () => {
        expect(allowed(`curl -s https://example.com/ http://localhost:1299/api/workspace/paths`)).toBe(false);
        expect(allowed(`curl -s -o /tmp/x http://localhost:1299/api/workspace/paths`)).toBe(false);
        expect(allowed(`curl -s -d @/Users/x/.ssh/id_rsa http://localhost:1299/api/todos/create`)).toBe(false);
        expect(allowed(`curl -s -H @headers.txt http://localhost:1299/api/todos/list`)).toBe(false);
        expect(allowed(`curl -sL http://localhost:1299/api/todos/list`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1234/api/todos/list`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299@evil.com/api/todos/list`)).toBe(false);
        expect(allowed(`curl -s "http://localhost:1299/api/todos/{list,get}"`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/todos/list http://localhost:1299/api/todos/get`)).toBe(false);
    });

    test("rejects settings, permission and delete endpoints", () => {
        expect(allowed(`curl -s -X POST http://localhost:1299/api/agents/preferences -d '{}'`)).toBe(false);
        expect(allowed(`curl -s -X POST http://localhost:1299/api/chat/permission-response -d '{}'`)).toBe(false);
        expect(allowed(`curl -s -X POST http://localhost:1299/api/mcp-servers/create -d '{}'`)).toBe(false);
        expect(allowed(`curl -s -X POST http://localhost:1299/api/todos/delete -d '{"id":"t1"}'`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/todos/events`)).toBe(false);
    });

    test("rejects compound commands, expansions and other pipes", () => {
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths; touch x`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths && touch x`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths\ntouch x`)).toBe(false);
        expect(allowed(`curl -s "http://localhost:1299/api/workspace/paths?x=$(touch x)"`)).toBe(false);
        expect(allowed(`curl -s "http://localhost:1299/api/workspace/paths?x=\`touch x\`"`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths > out.json`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths | python3 -c "print(1)"`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths | head -c 100 | sh`)).toBe(false);
        expect(allowed(`curl -s http://localhost:1299/api/workspace/paths || touch x`)).toBe(false);
        expect(allowed(`curl -s 'http://localhost:1299/api/workspace/paths`)).toBe(false);
        expect(allowed(`NOTES_DIR=x curl -s http://localhost:1299/api/workspace/paths`)).toBe(false);
    });
});
