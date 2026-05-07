import { useEffect, useRef, useState } from "react";
import ChatView from "@/features/chat/chat-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { goalsAPI } from "@/hooks/useGoalsAPI";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { todayPluginSerial } from "./index";
import { formatTabDateLabel, getMsUntilNextLocalMidnight, getTodayLocalDateString } from "./date";
import { Loader2 } from "lucide-react";

type TodayViewProps = {
    tabId: string;
    date?: string;
};

type SessionLookupState =
    | { status: "loading" }
    | { status: "missing"; goalCount: number }
    | { status: "ready"; sessionId: string | undefined };

export default function TodayView({ tabId, date }: TodayViewProps) {
    const { openTab } = useWorkspaceContext();
    const tabDate = date ?? getTodayLocalDateString();

    const [lookup, setLookup] = useState<SessionLookupState>({ status: "loading" });
    const [skipOnboarding, setSkipOnboarding] = useState(false);
    const [isStale, setIsStale] = useState(() => tabDate < getTodayLocalDateString());
    const didLookupRef = useRef(false);

    // Resolve sessionId for this tab's date (if any) and goal count for onboarding.
    useEffect(() => {
        if (didLookupRef.current) return;
        didLookupRef.current = true;

        let cancelled = false;
        (async () => {
            try {
                const [sessionRes, goals] = await Promise.all([
                    fetch("/api/chat/sessions/by-daily-date", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ date: tabDate }),
                    }).then((r) => (r.ok ? r.json() : { session: null })),
                    goalsAPI.listGoals({}).catch(() => []),
                ]);
                if (cancelled) return;

                const existing = sessionRes?.session?.id as string | undefined;
                if (existing) {
                    setLookup({ status: "ready", sessionId: existing });
                } else if (goals.length === 0) {
                    setLookup({ status: "missing", goalCount: 0 });
                } else {
                    setLookup({ status: "ready", sessionId: undefined });
                }
            } catch (err) {
                console.error("[Today] Lookup failed:", err);
                if (!cancelled) setLookup({ status: "ready", sessionId: undefined });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [tabDate]);

    // Single-shot timer to detect day rollover. Fires at next local midnight; once
    // stale, we don't auto-close — the user gets a banner to open today's tab.
    useEffect(() => {
        if (isStale) return;
        const ms = getMsUntilNextLocalMidnight();
        const timer = setTimeout(() => setIsStale(true), ms);
        return () => clearTimeout(timer);
    }, [isStale, tabDate]);

    const handleOpenToday = () => {
        const newDate = getTodayLocalDateString();
        openTab({
            pluginMeta: todayPluginSerial,
            view: "default",
            props: { date: newDate },
        });
    };

    if (lookup.status === "loading") {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Připravuju ranní review…</span>
                </div>
            </div>
        );
    }

    if (lookup.status === "missing" && !skipOnboarding) {
        return (
            <div className="flex items-center justify-center h-full p-6">
                <Card className="max-w-md w-full">
                    <CardHeader>
                        <CardTitle>Vítej v Today</CardTitle>
                        <CardDescription>
                            Today je tvůj denní chat s bpagentem — ranní review,
                            plánování dne, práce s tasky. Nejlépe funguje, když máš
                            nastavené cíle a projekty.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                        <Button
                            onClick={() => {
                                openTab({
                                    pluginMeta: { id: "goals", name: "Goals", icon: "workflow" },
                                    view: "browser",
                                    props: {},
                                });
                            }}
                        >
                            Nastavit cíle
                        </Button>
                        <Button variant="outline" onClick={() => setSkipOnboarding(true)}>
                            Spustit i tak
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const sessionId = lookup.status === "ready" ? lookup.sessionId : undefined;

    return (
        <div className="flex flex-col h-full">
            {isStale && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-secondary/50 border-b border-border text-xs">
                    <span className="text-muted-foreground">
                        Tento tab je z {tabDate}. Den se přehoupl přes půlnoc.
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleOpenToday}>
                        Otevřít dnešek
                    </Button>
                </div>
            )}
            <div className="flex-1 min-h-0">
                <ChatView
                    sessionId={sessionId}
                    tabId={tabId}
                    initialPrompt={sessionId ? undefined : "/daily"}
                    autoSend={!sessionId}
                    forcedAgentId="bpagent"
                    dailyDate={tabDate}
                    tabNameOverride={isStale ? formatTabDateLabel(tabDate) : `Today · ${formatTabDateLabel(tabDate)}`}
                />
            </div>
        </div>
    );
}
