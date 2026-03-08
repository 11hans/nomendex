import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronRight, ChevronDown, Folder as FolderIcon, FolderOpen, FileText } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useNativeSubmit } from "@/hooks/useNativeKeyboardBridge";
import { NoteFolder, Note } from "./index";
import { cn } from "@/lib/utils";

// ============ Create Folder Dialog ============

interface CreateFolderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parentPath: string | null;
    parentName?: string;
    onCreate: (name: string, parentPath: string | null) => void;
}

export function CreateFolderDialog({
    open,
    onOpenChange,
    parentPath,
    parentName,
    onCreate,
}: CreateFolderDialogProps) {
    const { currentTheme } = useTheme();
    const [name, setName] = useState("");

    useEffect(() => {
        if (open) {
            setName("");
        }
    }, [open]);

    const handleCreate = () => {
        if (name.trim()) {
            onCreate(name.trim(), parentPath);
            onOpenChange(false);
        }
    };

    useNativeSubmit(() => {
        if (name.trim()) {
            handleCreate();
        }
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-md p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div
                    className="px-6 py-3"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderBottom: `1px solid ${currentTheme.styles.borderDefault}`,
                    }}
                >
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: currentTheme.styles.contentPrimary }}>
                        {parentName ? `New Folder in "${parentName}"` : "New Folder"}
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: currentTheme.styles.contentTertiary }}>
                        Enter to confirm
                    </div>
                </div>
                <div className="px-6 pt-5 pb-4 space-y-2">
                    <Label
                        htmlFor="folder-name"
                        className="text-[10px] uppercase tracking-[0.08em]"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        Folder Name
                    </Label>
                    <Input
                        id="folder-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter folder name..."
                        autoFocus
                        className="h-9 text-sm"
                        style={{
                            color: currentTheme.styles.contentPrimary,
                            backgroundColor: currentTheme.styles.surfacePrimary,
                            borderColor: currentTheme.styles.borderDefault,
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && name.trim()) {
                                handleCreate();
                            }
                        }}
                    />
                </div>
                <div
                    className="px-6 py-3 border-t"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    <DialogFooter className="mt-0 pt-0">
                        <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={!name.trim()} size="sm" className="h-8 px-3 text-xs">
                            Create
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ============ Rename Folder Dialog ============

interface RenameFolderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    folder: NoteFolder | null;
    onRename: (oldPath: string, newName: string) => void;
}

export function RenameFolderDialog({
    open,
    onOpenChange,
    folder,
    onRename,
}: RenameFolderDialogProps) {
    const { currentTheme } = useTheme();
    const [name, setName] = useState("");

    useEffect(() => {
        if (open && folder) {
            setName(folder.name);
        }
    }, [open, folder]);

    const handleRename = () => {
        if (name.trim() && folder) {
            onRename(folder.path, name.trim());
            onOpenChange(false);
        }
    };

    useNativeSubmit(() => {
        if (name.trim() && folder) {
            handleRename();
        }
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-md p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <DialogHeader
                    className="px-6 py-3 gap-1"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderBottom: `1px solid ${currentTheme.styles.borderDefault}`,
                    }}
                >
                    <DialogTitle className="text-[11px] uppercase tracking-[0.08em]" style={{ color: currentTheme.styles.contentPrimary }}>
                        Rename Folder
                    </DialogTitle>
                    {folder && (
                        <DialogDescription className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                            Current: {folder.path}
                        </DialogDescription>
                    )}
                </DialogHeader>
                <div className="px-6 pt-5 pb-4 space-y-2">
                    <Label
                        htmlFor="folder-name"
                        className="text-[10px] uppercase tracking-[0.08em]"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        Folder Name
                    </Label>
                    <Input
                        id="folder-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter folder name..."
                        autoFocus
                        className="h-9 text-sm"
                        style={{
                            color: currentTheme.styles.contentPrimary,
                            backgroundColor: currentTheme.styles.surfacePrimary,
                            borderColor: currentTheme.styles.borderDefault,
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && name.trim()) {
                                handleRename();
                            }
                        }}
                    />
                </div>
                <div
                    className="px-6 py-3 border-t"
                    style={{
                        backgroundColor: currentTheme.styles.surfaceSecondary,
                        borderColor: currentTheme.styles.borderDefault,
                    }}
                >
                    <DialogFooter className="mt-0 pt-0">
                        <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleRename} disabled={!name.trim()} size="sm" className="h-8 px-3 text-xs">
                            Rename
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ============ Move to Folder Dialog ============

interface FolderNode {
    folder: NoteFolder;
    children: FolderNode[];
}

function buildFolderTree(folders: NoteFolder[]): FolderNode[] {
    const folderMap = new Map<string, FolderNode>();
    folders.forEach(folder => {
        folderMap.set(folder.path, { folder, children: [] });
    });

    const rootNodes: FolderNode[] = [];
    folders.forEach(folder => {
        const node = folderMap.get(folder.path);
        if (!node) return;

        const parentPath = folder.path.includes("/")
            ? folder.path.substring(0, folder.path.lastIndexOf("/"))
            : null;

        if (parentPath && folderMap.has(parentPath)) {
            folderMap.get(parentPath)?.children.push(node);
        } else {
            rootNodes.push(node);
        }
    });

    const sortNodes = (nodes: FolderNode[]) => {
        nodes.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
        nodes.forEach(node => sortNodes(node.children));
    };
    sortNodes(rootNodes);

    return rootNodes;
}

function FolderSelectItem({
    node,
    depth,
    selectedFolderPath,
    expandedFolders,
    onToggleExpand,
    onSelect,
}: {
    node: FolderNode;
    depth: number;
    selectedFolderPath: string | null;
    expandedFolders: Set<string>;
    onToggleExpand: (folderPath: string) => void;
    onSelect: (folderPath: string) => void;
}) {
    const { currentTheme } = useTheme();
    const isExpanded = expandedFolders.has(node.folder.path);
    const isSelected = selectedFolderPath === node.folder.path;
    const hasChildren = node.children.length > 0;

    return (
        <div>
            <div
                className={cn(
                    "flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer"
                )}
                style={{
                    paddingLeft: `${depth * 16 + 8}px`,
                    backgroundColor: isSelected ? currentTheme.styles.surfaceSecondary : undefined,
                }}
                onClick={() => onSelect(node.folder.path)}
            >
                <button
                    type="button"
                    className="p-0.5 hover:bg-muted rounded shrink-0"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(node.folder.path);
                    }}
                    style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
                >
                    {isExpanded ? (
                        <ChevronDown className="size-3.5" style={{ color: currentTheme.styles.contentSecondary }} />
                    ) : (
                        <ChevronRight className="size-3.5" style={{ color: currentTheme.styles.contentSecondary }} />
                    )}
                </button>
                {isExpanded ? (
                    <FolderOpen className="size-4 shrink-0" style={{ color: currentTheme.styles.contentSecondary }} />
                ) : (
                    <FolderIcon className="size-4 shrink-0" style={{ color: currentTheme.styles.contentSecondary }} />
                )}
                <span
                    className="flex-1 truncate text-sm"
                    style={{ color: currentTheme.styles.contentPrimary }}
                >
                    {node.folder.name}
                </span>
            </div>
            {isExpanded && node.children.map(child => (
                <FolderSelectItem
                    key={child.folder.path}
                    node={child}
                    depth={depth + 1}
                    selectedFolderPath={selectedFolderPath}
                    expandedFolders={expandedFolders}
                    onToggleExpand={onToggleExpand}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}

interface MoveToFolderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    note: Note | null;
    folders: NoteFolder[];
    onMove: (fileName: string, targetFolder: string | null) => void;
}

export function MoveToFolderDialog({
    open,
    onOpenChange,
    note,
    folders,
    onMove,
}: MoveToFolderDialogProps) {
    const { currentTheme } = useTheme();
    const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(note?.folderPath ?? null);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

    const tree = useMemo(() => buildFolderTree(folders), [folders]);

    const toggleExpand = (folderPath: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderPath)) {
                next.delete(folderPath);
            } else {
                next.add(folderPath);
            }
            return next;
        });
    };

    const handleMove = () => {
        if (note) {
            onMove(note.fileName, selectedFolderPath);
            onOpenChange(false);
        }
    };

    const handleOpenChange = (newOpen: boolean) => {
        if (newOpen && note) {
            setSelectedFolderPath(note.folderPath ?? null);
        }
        onOpenChange(newOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className="sm:max-w-md"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <DialogHeader>
                    <DialogTitle style={{ color: currentTheme.styles.contentPrimary }}>
                        Move to Folder
                    </DialogTitle>
                </DialogHeader>
                <div className="py-4">
                    <div
                        className="rounded-md border max-h-64 overflow-y-auto"
                        style={{ borderColor: currentTheme.styles.borderDefault }}
                    >
                        {/* No Folder option */}
                        <div
                            className={cn(
                                "flex items-center gap-2 py-1.5 px-3 cursor-pointer"
                            )}
                            style={{
                                backgroundColor: selectedFolderPath === null ? currentTheme.styles.surfaceSecondary : undefined,
                            }}
                            onClick={() => setSelectedFolderPath(null)}
                        >
                            <FileText className="size-4" style={{ color: currentTheme.styles.contentSecondary }} />
                            <span
                                className="text-sm"
                                style={{ color: currentTheme.styles.contentPrimary }}
                            >
                                No Folder (Root)
                            </span>
                        </div>

                        {/* Folder tree */}
                        {tree.map(node => (
                            <FolderSelectItem
                                key={node.folder.path}
                                node={node}
                                depth={0}
                                selectedFolderPath={selectedFolderPath}
                                expandedFolders={expandedFolders}
                                onToggleExpand={toggleExpand}
                                onSelect={setSelectedFolderPath}
                            />
                        ))}

                        {folders.length === 0 && (
                            <div
                                className="py-8 text-center text-sm"
                                style={{ color: currentTheme.styles.contentSecondary }}
                            >
                                No folders yet. Create one first.
                            </div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleMove}>
                        Move
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
