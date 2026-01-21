import * as React from "react";
import { Input } from "@/components/ui/input";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { SearchResult } from "@/features/notes";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { notesPluginSerial } from "@/features/notes";
import { useRouting } from "@/hooks/useRouting";

interface SearchNotesDialogProps {
    onSuccess?: () => void;
}

export function SearchNotesDialog({ onSuccess }: SearchNotesDialogProps) {
    const [query, setQuery] = React.useState("");
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = React.useState(false);
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    const { closeDialog } = useCommandDialog();
    const { addNewTab, setActiveTabId } = useWorkspaceContext();
    const { navigate, currentPath } = useRouting();
    const api = useNotesAPI();
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Perform search
    const performSearch = React.useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim()) {
            setResults([]);
            setSelectedIndex(0);
            return;
        }

        setIsSearching(true);
        try {
            const searchResults = await api.searchNotes({ query: searchQuery });
            setResults(searchResults);
            setSelectedIndex(0);
        } catch (error) {
            console.error("Search failed:", error);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    }, [api]);

    // Debounce search
    React.useEffect(() => {
        const timer = setTimeout(() => {
            performSearch(query);
        }, 300);

        return () => clearTimeout(timer);
    }, [query, performSearch]);

    // Open selected note
    const openNote = React.useCallback((fileName: string) => {
        const newTab = addNewTab({
            pluginMeta: notesPluginSerial,
            view: "editor",
            props: { noteFileName: fileName }
        });

        if (newTab) {
            setActiveTabId(newTab.id);
        }

        // Navigate to workspace if not already there
        if (currentPath !== "/") {
            navigate("/");
        }

        closeDialog();
        onSuccess?.();
    }, [addNewTab, setActiveTabId, closeDialog, onSuccess, navigate, currentPath]);

    // Handle keyboard navigation
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (results.length === 0) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % results.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[selectedIndex]) {
                    openNote(results[selectedIndex].fileName);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeDialog();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [results, selectedIndex, openNote, closeDialog]);

    // Auto-focus input on mount
    React.useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Highlight matching text
    const highlightMatches = (text: string, matches: SearchResult["matches"]) => {
        if (!query.trim()) return text;

        const parts: React.ReactNode[] = [];
        let lastIndex = 0;

        // Find all matches in this text
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        let searchIndex = 0;

        while (true) {
            const index = lowerText.indexOf(lowerQuery, searchIndex);
            if (index === -1) break;

            // Add non-matching part
            if (index > lastIndex) {
                parts.push(text.slice(lastIndex, index));
            }

            // Add highlighted part
            parts.push(
                <mark key={`${index}-${parts.length}`} className="bg-yellow-200 dark:bg-yellow-900">
                    {text.slice(index, index + lowerQuery.length)}
                </mark>
            );

            lastIndex = index + lowerQuery.length;
            searchIndex = lastIndex;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            parts.push(text.slice(lastIndex));
        }

        return parts.length > 0 ? parts : text;
    };

    return (
        <div className="flex flex-col h-[500px]">
            <div className="p-4 border-b">
                <Input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search notes..."
                    className="w-full"
                />
            </div>

            <div className="flex-1 overflow-y-auto">
                {isSearching && (
                    <div className="p-4 text-center text-muted-foreground">
                        Searching...
                    </div>
                )}

                {!isSearching && query && results.length === 0 && (
                    <div className="p-4 text-center text-muted-foreground">
                        No results found
                    </div>
                )}

                {!isSearching && results.length > 0 && (
                    <div className="divide-y">
                        {results.map((result, index) => {
                            const isSelected = index === selectedIndex;
                            const fileNameMatches = result.matches.filter(m => m.line === 0);
                            const contentMatches = result.matches.filter(m => m.line > 0);

                            return (
                                <div
                                    key={result.fileName}
                                    className={`p-3 cursor-pointer hover:bg-accent ${
                                        isSelected ? "bg-accent" : ""
                                    }`}
                                    onClick={() => openNote(result.fileName)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    <div className="font-medium text-sm mb-1">
                                        {fileNameMatches.length > 0
                                            ? highlightMatches(result.fileName, fileNameMatches)
                                            : result.fileName}
                                    </div>

                                    {result.folderPath && (
                                        <div className="text-xs text-muted-foreground mb-2">
                                            {result.folderPath}
                                        </div>
                                    )}

                                    {contentMatches.length > 0 && (
                                        <div className="space-y-1">
                                            {contentMatches.slice(0, 3).map((match, matchIndex) => (
                                                <div
                                                    key={`${match.line}-${matchIndex}`}
                                                    className="text-xs text-muted-foreground font-mono truncate"
                                                >
                                                    <span className="text-xs mr-2 opacity-60">
                                                        L{match.line}
                                                    </span>
                                                    {highlightMatches(match.text, [match])}
                                                </div>
                                            ))}
                                            {contentMatches.length > 3 && (
                                                <div className="text-xs text-muted-foreground opacity-60">
                                                    +{contentMatches.length - 3} more matches
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="text-xs text-muted-foreground mt-1">
                                        {result.matches.length} match{result.matches.length !== 1 ? "es" : ""}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {!query && (
                    <div className="p-4 text-center text-muted-foreground">
                        Start typing to search across all notes
                    </div>
                )}
            </div>
        </div>
    );
}
