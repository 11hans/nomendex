import { useEffect, useRef } from "react";
import type { ChannelEvent } from "./types";

export function useChannelEvents(onEvent: (event: ChannelEvent) => void): void {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", topic: "channels" }));
      ws.send(JSON.stringify({ type: "ping" }));
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as ChannelEvent;
        if (parsed?.type === "event" && typeof parsed.id === "string") {
          onEventRef.current(parsed);
        }
      } catch {
        // ignore unrelated websocket payloads
      }
    };

    return () => {
      ws.close();
    };
  }, []);
}
