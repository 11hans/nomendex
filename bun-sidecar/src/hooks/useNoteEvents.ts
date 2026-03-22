/**
 * useNoteEvents - Client-side hook for real-time note events via SSE.
 *
 * Connects to /api/notes/events and dispatches:
 * - lock-acquired → upsertFileLock (makes editor read-only, shows banner)
 * - lock-released → removeFileLock (re-enables editor, shows toast)
 * - file-changed  → emits "notes:fileChanged" event for the note view to handle
 */

import { useEffect, useRef } from "react";
import { upsertFileLock, removeFileLock } from "@/hooks/useFileLocks";
import { emit } from "@/lib/events";

// Reconnection constants
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;

export function useNoteEvents(): void {
    const reconnectAttemptRef = useRef(0);
    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        let cancelled = false;

        function connect() {
            if (cancelled) return;

            const es = new EventSource("/api/notes/events");
            eventSourceRef.current = es;

            es.onopen = () => {
                reconnectAttemptRef.current = 0;
            };

            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    switch (data.type) {
                        case "lock-acquired":
                            upsertFileLock({
                                noteFileName: data.fileName,
                                agentId: data.sessionId,
                                agentName: data.agentName,
                                lockedAt: data.lockedAt,
                            });
                            break;

                        case "lock-released":
                            removeFileLock(data.fileName);
                            emit("notes:fileChanged", { fileName: data.fileName, source: "agent" });
                            break;

                        case "file-changed":
                            emit("notes:fileChanged", { fileName: data.fileName, source: "external" });
                            break;
                    }
                } catch {
                    // Ignore parse errors (e.g., keepalive comments)
                }
            };

            es.onerror = () => {
                es.close();
                eventSourceRef.current = null;

                if (cancelled) return;

                // Exponential backoff reconnection
                const attempt = reconnectAttemptRef.current++;
                const delay = Math.min(
                    RECONNECT_DELAY_MS * Math.pow(2, attempt),
                    MAX_RECONNECT_DELAY_MS
                );
                setTimeout(connect, delay);
            };
        }

        connect();

        return () => {
            cancelled = true;
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
        };
    }, []);
}
