import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../components/ui/accordion";
import { CalendarDays, Tag, Clock, FileText, ListTodo, Keyboard, GitBranch, Lightbulb, Command, Bot } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

function HelpContent() {
    const { currentTheme } = useTheme();

    return (
        <div
            className="h-full min-h-0 overflow-y-auto [&_.text-sm]:text-xs [&_.text-base]:text-xs [&_.text-xs]:text-xs"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}
        >
            <div className="mx-auto w-full max-w-[980px] space-y-2.5 px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                    <Lightbulb className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                    <span className="text-xs font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentPrimary }}>
                        Help
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        daily workflows
                    </span>
                    <span className="text-caption" style={{ color: currentTheme.styles.contentTertiary }}>
                        keyboard-first
                    </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-caption">Todos</Badge>
                    <Badge variant="secondary" className="text-caption">Notes</Badge>
                    <Badge variant="secondary" className="text-caption">Sync</Badge>
                    <Badge variant="secondary" className="text-caption">Shortcuts</Badge>
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <Card className="border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-sm">
                                    <Lightbulb className="h-4 w-4 text-muted-foreground" />
                                    First Steps
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="text-xs text-muted-foreground">
                                Open command palette with <code className="px-1">Cmd+K</code> and create your first todo with <code className="px-1">c</code>.
                            </CardContent>
                        </Card>
                        <Card className="border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-sm">
                                    <Keyboard className="h-4 w-4 text-muted-foreground" />
                                    Keyboard First
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="text-xs text-muted-foreground">
                                Most views are optimized for navigation and editing without leaving the keyboard.
                            </CardContent>
                        </Card>
                        <Card className="border-border">
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-sm">
                                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                                    Workspace Sync
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="text-xs text-muted-foreground">
                                Use Sync page to connect repository, monitor drift, and resolve merge conflicts safely.
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <ListTodo className="size-5" />
                                Todos
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Task management with kanban boards, projects, statuses, and scheduling.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold flex items-center gap-2">
                                    <CalendarDays className="size-4" />
                                    Natural Language Dates
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    In todo dialogs, type dates directly in natural language in start/due fields.
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
                                    Tip: abbreviations like <code>tom</code>, <code>yest</code>, <code>ne wed</code> also work.
                                </p>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold flex items-center gap-2">
                                    <Tag className="size-4" />
                                    Tags and Statuses
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    Tags are reusable labels, and statuses drive kanban columns: <strong>Todo</strong>, <strong>In Progress</strong>, <strong>Done</strong>, <strong>Later</strong>.
                                </p>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold flex items-center gap-2">
                                    <Clock className="size-4" />
                                    Kanban Shortcuts
                                </h3>
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

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold flex items-center gap-2">
                                    <CalendarDays className="size-4" />
                                    Calendar Sync
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    Todos with Start or Due date can sync to Apple Calendar. For imported tasks, run force sync from command palette.
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

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-sm">
                                    <FileText className="size-5" />
                                    Notes
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Markdown notes with daily note workflows.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    Open daily notes quickly from <code className="px-1 py-0.5 rounded bg-surface-elevated">Cmd+K</code>.
                                </p>
                                <ul className="text-sm space-y-1 ml-4 text-muted-foreground">
                                    <li><strong>Open Today's Daily Note</strong> (creates if missing)</li>
                                    <li><strong>Open Yesterday's Daily Note</strong></li>
                                    <li><strong>Open Tomorrow's Daily Note</strong></li>
                                    <li><strong>Open Daily Note...</strong> with natural language date input</li>
                                </ul>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-sm">
                                    <Keyboard className="size-5" />
                                    Essential Shortcuts
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Core actions that speed up daily usage.
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
                                    Customize shortcuts in Settings -&gt; Keyboard Shortcuts.
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <Command className="size-5" />
                                Command Palette Reference
                            </CardTitle>
                            <CardDescription className="text-xs">
                                All commands available via <code className="px-1 py-0.5 rounded bg-surface-elevated">Cmd+K</code>. Some commands only appear when a specific view is active.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Accordion type="multiple" className="w-full">
                                <AccordionItem value="general">
                                    <AccordionTrigger>General <Badge variant="secondary" className="ml-auto text-caption">8</Badge></AccordionTrigger>
                                    <AccordionContent>
                                        <div className="rounded-lg p-4 bg-surface-elevated">
                                            <div className="grid grid-cols-[1fr_2fr] gap-x-6 gap-y-1.5 text-sm">
                                                <code>Manage Workspaces</code>
                                                <span className="text-muted-foreground">Open the workspace manager</span>
                                                <code>Open Settings</code>
                                                <span className="text-muted-foreground">Open the settings page</span>
                                                <code>Close All Tabs</code>
                                                <span className="text-muted-foreground">Close all open tabs</span>
                                                <code>Toggle Split View</code>
                                                <span className="text-muted-foreground">Switch between single and split pane layout</span>
                                                <code>Tags</code>
                                                <span className="text-muted-foreground">Manage tags for the current note <span className="opacity-60">*</span></span>
                                                <code>Reveal Logs in Finder</code>
                                                <span className="text-muted-foreground">Show the log file in Finder</span>
                                                <code>Reset Logs</code>
                                                <span className="text-muted-foreground">Clear all log entries</span>
                                                <code>dev: Trigger Error</code>
                                                <span className="text-muted-foreground">Throw an error to test the error boundary</span>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>

                                <AccordionItem value="todos">
                                    <AccordionTrigger>Todos <Badge variant="secondary" className="ml-auto text-caption">5</Badge></AccordionTrigger>
                                    <AccordionContent>
                                        <div className="rounded-lg p-4 bg-surface-elevated">
                                            <div className="grid grid-cols-[1fr_2fr] gap-x-6 gap-y-1.5 text-sm">
                                                <code>Open Todos</code>
                                                <span className="text-muted-foreground">Open the all-project todos board (default)</span>
                                                <code>Open All Todos</code>
                                                <span className="text-muted-foreground">Open the all-project todos board</span>
                                                <code>Open Projects</code>
                                                <span className="text-muted-foreground">Open the projects browser</span>
                                                <code>Create New Todo</code>
                                                <span className="text-muted-foreground">Create a new todo item</span>
                                                <code>Force Sync All to Calendar</code>
                                                <span className="text-muted-foreground">Sync all todos with dates to Apple Calendar</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-3 opacity-70">
                                                Additional per-project commands (<code>Open Todos: &lt;project&gt;</code>) are generated dynamically.
                                            </p>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>

                                <AccordionItem value="notes">
                                    <AccordionTrigger>Notes <Badge variant="secondary" className="ml-auto text-caption">16</Badge></AccordionTrigger>
                                    <AccordionContent>
                                        <div className="rounded-lg p-4 bg-surface-elevated">
                                            <div className="grid grid-cols-[1fr_2fr] gap-x-6 gap-y-1.5 text-sm">
                                                <code>Search Notes</code>
                                                <span className="text-muted-foreground">Search across all notes (Cmd+Shift+F)</span>
                                                <code>Create New Note</code>
                                                <span className="text-muted-foreground">Create a new note with custom name</span>
                                                <code>Open Today&apos;s Daily Note</code>
                                                <span className="text-muted-foreground">Create if missing and open in editor</span>
                                                <code>Open Yesterday&apos;s Daily Note</code>
                                                <span className="text-muted-foreground">Create if missing and open in editor</span>
                                                <code>Open Tomorrow&apos;s Daily Note</code>
                                                <span className="text-muted-foreground">Create if missing and open in editor</span>
                                                <code>Open Daily Note...</code>
                                                <span className="text-muted-foreground">Pick a date to open or create a daily note</span>
                                                <code>Notes</code>
                                                <span className="text-muted-foreground">Open the notes browser</span>
                                                <code>Rebuild Tags Index</code>
                                                <span className="text-muted-foreground">Clear cache and reparse all tags</span>
                                            </div>
                                            <div className="mt-3 pt-3 border-t border-border/50">
                                                <p className="text-xs text-muted-foreground mb-2 opacity-70">Only visible when a note is open in editor <span className="opacity-60">*</span></p>
                                                <div className="grid grid-cols-[1fr_2fr] gap-x-6 gap-y-1.5 text-sm">
                                                    <code>Save Current Note</code>
                                                    <span className="text-muted-foreground">Save the current note (Cmd+S)</span>
                                                    <code>Delete Current Note</code>
                                                    <span className="text-muted-foreground">Delete the currently open note</span>
                                                    <code>Rename Current Note</code>
                                                    <span className="text-muted-foreground">Rename the currently open note</span>
                                                    <code>Move Note to Folder</code>
                                                    <span className="text-muted-foreground">Move the current note to a different folder</span>
                                                    <code>Copy Markdown</code>
                                                    <span className="text-muted-foreground">Copy the note content as markdown</span>
                                                    <code>Reveal in Finder</code>
                                                    <span className="text-muted-foreground">Show the current note in Finder</span>
                                                    <code>Run Spellcheck</code>
                                                    <span className="text-muted-foreground">Check spelling and highlight misspelled words</span>
                                                    <code>Clear Spellcheck</code>
                                                    <span className="text-muted-foreground">Remove all spellcheck highlighting</span>
                                                </div>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>

                                <AccordionItem value="chat">
                                    <AccordionTrigger>Chat <Badge variant="secondary" className="ml-auto text-caption">2</Badge></AccordionTrigger>
                                    <AccordionContent>
                                        <div className="rounded-lg p-4 bg-surface-elevated">
                                            <div className="grid grid-cols-[1fr_2fr] gap-x-6 gap-y-1.5 text-sm">
                                                <code>Chats</code>
                                                <span className="text-muted-foreground">Open the chat browser</span>
                                                <code>New Chat</code>
                                                <span className="text-muted-foreground">Start a new chat conversation</span>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <Bot className="size-5" />
                                Chat Skills (BPagent)
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Slash commands available in chat when using the BPagent agent. Type <code className="px-1 py-0.5 rounded bg-surface-elevated">/skill-name</code> in the chat input to invoke.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Accordion type="multiple" className="w-full">
                                <AccordionItem value="user-invoked">
                                    <AccordionTrigger>User-Invoked Skills <Badge variant="secondary" className="ml-auto text-caption">9</Badge></AccordionTrigger>
                                    <AccordionContent>
                                        <div className="rounded-lg p-4 bg-surface-elevated">
                                            <div className="grid grid-cols-[1fr_2fr] gap-x-6 gap-y-1.5 text-sm">
                                                <code>/daily</code>
                                                <span className="text-muted-foreground">Create daily notes, morning/midday/evening routines</span>
                                                <code>/weekly</code>
                                                <span className="text-muted-foreground">Weekly review — reflect, align with goals, plan next week</span>
                                                <code>/timeblocking</code>
                                                <span className="text-muted-foreground">Preview and apply weekly or ad-hoc timeblock schedules</span>
                                                <code>/monthly</code>
                                                <span className="text-muted-foreground">Monthly review — roll up weeks, check quarterly milestones, plan next month</span>
                                                <code>/project</code>
                                                <span className="text-muted-foreground">Create, track, and archive projects linked to goals</span>
                                                <code>/review</code>
                                                <span className="text-muted-foreground">Smart router — auto-detects daily/weekly/monthly based on context</span>
                                                <code>/adopt</code>
                                                <span className="text-muted-foreground">Scaffold BPagent structure onto an existing notes workspace</span>
                                                <code>/check-links</code>
                                                <span className="text-muted-foreground">Find broken wiki-links in the vault</span>
                                                <code>/search &lt;term&gt;</code>
                                                <span className="text-muted-foreground">Search vault content by keyword</span>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>

                                <AccordionItem value="auto-skills">
                                    <AccordionTrigger>Auto Skills <Badge variant="secondary" className="ml-auto text-caption">4</Badge></AccordionTrigger>
                                    <AccordionContent>
                                        <div className="rounded-lg p-4 bg-surface-elevated">
                                            <p className="text-xs text-muted-foreground mb-3 opacity-70">
                                                These skills are invoked automatically by the system or other skills — not directly by the user.
                                            </p>
                                            <div className="grid grid-cols-[1fr_2fr] gap-x-6 gap-y-1.5 text-sm">
                                                <code>goal-tracking</code>
                                                <span className="text-muted-foreground">Track progress across goal cascade, calculate completion, surface stalled goals</span>
                                                <code>obsidian-vault-ops</code>
                                                <span className="text-muted-foreground">Read/write vault files, manage wiki-links, process markdown with YAML frontmatter</span>
                                                <code>todos</code>
                                                <span className="text-muted-foreground">Manage project todos via REST API — create, view, update, delete with Kanban support</span>
                                                <code>daily-notes</code>
                                                <span className="text-muted-foreground">Manage daily notes using vault-config folder mapping and naming convention</span>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

export function HelpPage() {
    return <HelpContent />;
}
