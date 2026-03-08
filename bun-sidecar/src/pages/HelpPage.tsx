import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { CalendarDays, Tag, Clock, FileText, ListTodo } from "lucide-react";

function HelpContent() {
    return (
        <div className="px-6 py-4 h-full flex flex-col overflow-hidden max-w-4xl mx-auto w-full bg-bg text-foreground">
            <div className="flex-shrink-0 mb-6">
                <h1 className="text-2xl font-bold">
                    Help
                </h1>
                <p className="text-sm text-muted-foreground">
                    Learn how to use the app's features effectively.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto outline-none pr-2">

                {/* Todos Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ListTodo className="size-5" />
                            Todos
                        </CardTitle>
                        <CardDescription>
                            Task management with kanban boards, projects, and more.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Due Dates */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2">
                                <CalendarDays className="size-4" />
                                Due Dates
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Set due dates for your todos using natural language. Click the calendar icon in the todo dialog and type phrases like:
                            </p>
                            <div className="rounded-lg p-4 space-y-2 bg-surface-elevated">
                                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                                    <code>today</code>
                                    <span className="text-muted-foreground">Today's date</span>

                                    <code>tomorrow</code>
                                    <span className="text-muted-foreground">Tomorrow's date</span>

                                    <code>yesterday</code>
                                    <span className="text-muted-foreground">Yesterday's date</span>

                                    <code>next wed</code>
                                    <span className="text-muted-foreground">Next Wednesday</span>

                                    <code>last fri</code>
                                    <span className="text-muted-foreground">Last Friday</span>

                                    <code>next week</code>
                                    <span className="text-muted-foreground">7 days from now</span>

                                    <code>1/15</code>
                                    <span className="text-muted-foreground">January 15th (current year)</span>

                                    <code>1/15/2026</code>
                                    <span className="text-muted-foreground">January 15th, 2026</span>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Tip: You can abbreviate — "ne wed", "tom", "yest" all work!
                            </p>
                        </div>

                        {/* Tags */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2">
                                <Tag className="size-4" />
                                Tags
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Organize todos with tags. Click the tag icon to add tags. Previously used tags appear as suggestions for quick selection.
                            </p>
                        </div>

                        {/* Status */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2">
                                <Clock className="size-4" />
                                Status
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Todos have four statuses that map to kanban columns:
                            </p>
                            <ul className="text-sm space-y-1 ml-4 text-muted-foreground">
                                <li><strong>Todo</strong> — Tasks to be done</li>
                                <li><strong>In Progress</strong> — Currently working on</li>
                                <li><strong>Done</strong> — Completed tasks</li>
                                <li><strong>Later</strong> — Deferred tasks (toggle column visibility in view)</li>
                            </ul>
                        </div>

                        {/* Kanban Shortcuts */}
                        <div className="space-y-3">
                            <h3 className="font-semibold">
                                Kanban Shortcuts
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Navigate and manage todos quickly in the kanban view:
                            </p>
                            <div className="rounded-lg p-4 space-y-2 bg-surface-elevated">
                                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                                    <code>Arrow keys</code>
                                    <span className="text-muted-foreground">Navigate between todos</span>

                                    <code>Shift + Arrow keys</code>
                                    <span className="text-muted-foreground">Move todo (reorder/change column)</span>

                                    <code>Enter</code>
                                    <span className="text-muted-foreground">Open selected todo</span>

                                    <code>c</code>
                                    <span className="text-muted-foreground">Create new todo</span>

                                    <code>;</code>
                                    <span className="text-muted-foreground">Copy todo (title & description)</span>

                                    <code>a</code>
                                    <span className="text-muted-foreground">Archive selected todo</span>

                                    <code>Delete / Backspace</code>
                                    <span className="text-muted-foreground">Delete selected todo</span>

                                    <code>/</code>
                                    <span className="text-muted-foreground">Focus search</span>
                                </div>
                            </div>
                        </div>

                        {/* Calendar Sync */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2">
                                <CalendarDays className="size-4" />
                                Calendar Sync
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Todos with a Start Date or Due Date sync automatically with Apple Calendar.
                                However, if you import tasks from an external source, you may need to force a sync:
                            </p>
                            <div className="rounded-lg p-4 space-y-2 bg-surface-elevated">
                                <div className="grid gap-2 text-sm">
                                    <div className="flex gap-2">
                                        <code>Cmd+K</code>
                                        <span className="text-muted-foreground">Open command palette</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <code>Force Sync All to Calendar</code>
                                        <span className="text-muted-foreground">Sync all eligible todos</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Notes Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="size-5" />
                            Notes
                        </CardTitle>
                        <CardDescription>
                            Markdown notes with daily note support.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Daily Notes */}
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2">
                                <CalendarDays className="size-4" />
                                Daily Notes
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Quick access to daily notes via the command palette (<code className="px-1 py-0.5 rounded bg-surface-elevated">Cmd+K</code>):
                            </p>
                            <ul className="text-sm space-y-1 ml-4 text-muted-foreground">
                                <li><strong>Open Today's Daily Note</strong> — Creates if missing</li>
                                <li><strong>Open Yesterday's Daily Note</strong></li>
                                <li><strong>Open Tomorrow's Daily Note</strong></li>
                                <li><strong>Open Daily Note...</strong> — Pick any date with the same natural language input</li>
                            </ul>
                        </div>
                    </CardContent>
                </Card>

                {/* Keyboard Shortcuts */}
                <Card>
                    <CardHeader>
                        <CardTitle>
                            Keyboard Shortcuts
                        </CardTitle>
                        <CardDescription>
                            Essential shortcuts for quick navigation.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-lg p-4 space-y-2 bg-surface-elevated">
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                                <code>Cmd+K</code>
                                <span className="text-muted-foreground">Open command palette</span>

                                <code>Cmd+Enter</code>
                                <span className="text-muted-foreground">Submit/confirm in dialogs</span>

                                <code>Cmd+W</code>
                                <span className="text-muted-foreground">Close current tab</span>

                                <code>Cmd+S</code>
                                <span className="text-muted-foreground">Save current note</span>
                            </div>
                        </div>
                        <p className="text-sm mt-3 text-muted-foreground">
                            Customize shortcuts in Settings → Keyboard Shortcuts.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export function HelpPage() {
    return <HelpContent />;
}
