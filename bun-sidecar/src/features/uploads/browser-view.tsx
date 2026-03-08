import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Trash2,
    Upload,
    Grid,
    List,
    Download,
    Copy,
    Check,
    Image as ImageIcon,
    Search,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { ImageViewer } from "@/components/ImageViewer";
import type { Attachment } from "@/types/attachments";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { toast } from "sonner";

type ViewMode = "grid" | "list";
type SortMode = "newest" | "oldest" | "name" | "size";

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (diffDays === 1) {
        return "Yesterday";
    }
    if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: "short" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fuzzySearch(query: string, text: string): boolean {
    if (!query) return true;

    const q = query.toLowerCase();
    const t = text.toLowerCase();

    let qIdx = 0;
    let tIdx = 0;

    while (qIdx < q.length && tIdx < t.length) {
        if (q[qIdx] === t[tIdx]) {
            qIdx++;
        }
        tIdx++;
    }

    return qIdx === q.length;
}

export default function UploadsBrowserView() {
    const { currentTheme } = useTheme();
    const [uploads, setUploads] = useState<Attachment[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [sortMode, setSortMode] = useState<SortMode>("newest");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedImage, setSelectedImage] = useState<Attachment | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchUploads = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/uploads/list");
            const data = await response.json();
            setUploads(data.uploads || []);
        } catch (error) {
            console.error("Failed to fetch uploads:", error);
            toast.error("Failed to load uploads");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUploads();
    }, [fetchUploads]);

    const handleDelete = useCallback(async (filename: string) => {
        try {
            const response = await fetch("/api/uploads/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename }),
            });

            if (response.ok) {
                setUploads((prev) => prev.filter((u) => u.filename !== filename));
                setSelectedImage((prev) => (prev?.filename === filename ? null : prev));
                toast.success("File deleted");
            } else {
                toast.error("Delete failed");
            }
        } catch (error) {
            console.error("Failed to delete upload:", error);
            toast.error("Delete failed");
        }
    }, []);

    const handleUpload = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        setUploading(true);
        const fileList = Array.from(files);

        try {
            const uploaded: Attachment[] = [];

            for (const file of fileList) {
                if (!file.type.startsWith("image/")) continue;

                const formData = new FormData();
                formData.append("file", file);

                const response = await fetch("/api/uploads", {
                    method: "POST",
                    body: formData,
                });
                const result = await response.json();

                if (result.success && result.data) {
                    uploaded.push(result.data);
                }
            }

            if (uploaded.length > 0) {
                setUploads((prev) => [...uploaded, ...prev]);
                toast.success(`Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}`);
            }
        } catch (error) {
            console.error("Failed to upload file:", error);
            toast.error("Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }, []);

    const handleCopyUrl = useCallback(async (upload: Attachment) => {
        try {
            const fullUrl = `${window.location.origin}${upload.url}`;
            await navigator.clipboard.writeText(fullUrl);
            setCopiedId(upload.id);
            setTimeout(() => setCopiedId(null), 2000);
            toast.success("URL copied");
        } catch (error) {
            console.error("Failed to copy URL:", error);
            toast.error("Copy failed");
        }
    }, []);

    const handleDownload = useCallback((upload: Attachment) => {
        const link = document.createElement("a");
        link.href = upload.url;
        link.download = upload.originalName || upload.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, []);

    const filteredUploads = useMemo(() => {
        let list = uploads;

        if (searchQuery.trim()) {
            list = list.filter((upload) =>
                fuzzySearch(searchQuery, upload.originalName || "")
                || fuzzySearch(searchQuery, upload.filename)
                || fuzzySearch(searchQuery, upload.mimeType)
            );
        }

        const sorted = [...list];
        sorted.sort((a, b) => {
            switch (sortMode) {
                case "newest":
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                case "oldest":
                    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                case "name":
                    return (a.originalName || a.filename).localeCompare(b.originalName || b.filename);
                case "size":
                    return b.size - a.size;
                default:
                    return 0;
            }
        });

        return sorted;
    }, [uploads, searchQuery, sortMode]);

    const totalBytes = useMemo(() => uploads.reduce((sum, upload) => sum + upload.size, 0), [uploads]);

    return (
        <div
            className="h-full min-h-0 overflow-y-auto"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary, color: currentTheme.styles.contentPrimary }}
        >
            <div className="mx-auto w-full max-w-[1240px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    <ImageIcon className="size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: currentTheme.styles.contentPrimary }}>
                        Media Library
                    </span>
                    <span className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                        {uploads.length} files
                    </span>
                    <span className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                        {formatFileSize(totalBytes)} total
                    </span>

                    <div className="ml-auto flex items-center gap-1.5">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => handleUpload(e.target.files)}
                            className="hidden"
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchUploads()}
                            className="h-7 px-2 text-[11px] rounded-md"
                        >
                            refresh
                        </Button>
                        <Button
                            onClick={() => fileInputRef.current?.click()}
                            className="h-7 px-2 text-[11px] font-medium rounded-md"
                            disabled={uploading}
                        >
                            <Upload className="size-3 mr-1.5" />
                            {uploading ? "uploading..." : "upload"}
                        </Button>
                    </div>
                </div>

                <div className="shrink-0 mt-2.5 flex items-center gap-1.5">
                    <div className="relative flex-1 min-w-[220px] max-w-[460px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3" style={{ color: currentTheme.styles.contentTertiary }} />
                        <Input
                            placeholder="search media..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 pl-8 text-xs bg-transparent"
                            style={{ borderColor: currentTheme.styles.borderDefault, color: currentTheme.styles.contentPrimary }}
                        />
                    </div>

                    <div className="flex items-center gap-0.5">
                        {([
                            { id: "newest", label: "new" },
                            { id: "oldest", label: "old" },
                            { id: "name", label: "name" },
                            { id: "size", label: "size" },
                        ] as const).map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setSortMode(item.id)}
                                className="h-7 rounded-md px-2 text-[10px] transition-colors"
                                style={sortMode === item.id ? {
                                    backgroundColor: currentTheme.styles.surfaceAccent,
                                    color: currentTheme.styles.contentPrimary,
                                } : {
                                    color: currentTheme.styles.contentTertiary,
                                }}
                                title={`Sort by ${item.id}`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div
                        className="flex rounded-md border overflow-hidden"
                        style={{ borderColor: currentTheme.styles.borderDefault }}
                        title="View mode"
                    >
                        <button
                            className="h-7 w-7 grid place-items-center"
                            onClick={() => setViewMode("grid")}
                            style={{
                                backgroundColor: viewMode === "grid" ? currentTheme.styles.surfaceAccent : "transparent",
                                color: viewMode === "grid" ? currentTheme.styles.contentPrimary : currentTheme.styles.contentTertiary,
                            }}
                            aria-label="Grid view"
                        >
                            <Grid className="size-3.5" />
                        </button>
                        <button
                            className="h-7 w-7 grid place-items-center border-l"
                            onClick={() => setViewMode("list")}
                            style={{
                                borderColor: currentTheme.styles.borderDefault,
                                backgroundColor: viewMode === "list" ? currentTheme.styles.surfaceAccent : "transparent",
                                color: viewMode === "list" ? currentTheme.styles.contentPrimary : currentTheme.styles.contentTertiary,
                            }}
                            aria-label="List view"
                        >
                            <List className="size-3.5" />
                        </button>
                    </div>
                </div>

                <div className="mt-2.5">
                    {loading ? (
                        <div className="py-10 text-center text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                            loading media...
                        </div>
                    ) : filteredUploads.length === 0 ? (
                        <div className="py-10 text-center text-xs" style={{ color: currentTheme.styles.contentTertiary }}>
                            {uploads.length === 0
                                ? "no media yet. upload images to get started"
                                : "no files match current search"}
                        </div>
                    ) : viewMode === "grid" ? (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-1.5 pb-2">
                            {filteredUploads.map((upload) => (
                                <ContextMenu key={upload.id}>
                                    <ContextMenuTrigger>
                                        <div
                                            className="group relative rounded-lg overflow-hidden border cursor-pointer aspect-square"
                                            style={{
                                                borderColor: currentTheme.styles.borderDefault,
                                                backgroundColor: currentTheme.styles.surfaceSecondary,
                                            }}
                                            onClick={() => setSelectedImage(upload)}
                                        >
                                            <img
                                                src={upload.url}
                                                alt={upload.originalName}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />

                                            <div
                                                className="absolute inset-x-0 bottom-0 px-1.5 py-1"
                                                style={{
                                                    background: `linear-gradient(to top, ${currentTheme.styles.surfacePrimary}dd, transparent)`,
                                                }}
                                            >
                                                <p className="text-[10px] truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                                                    {upload.originalName || upload.filename}
                                                </p>
                                                <p className="text-[9px]" style={{ color: currentTheme.styles.contentTertiary }}>
                                                    {formatFileSize(upload.size)}
                                                </p>
                                            </div>

                                            <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleDelete(upload.filename);
                                                    }}
                                                    className="size-6 grid place-items-center rounded"
                                                    style={{ backgroundColor: currentTheme.styles.semanticDestructive, color: "white" }}
                                                    title="Delete"
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                        <ContextMenuItem onClick={() => setSelectedImage(upload)}>View</ContextMenuItem>
                                        <ContextMenuItem onClick={() => void handleCopyUrl(upload)}>
                                            {copiedId === upload.id ? (
                                                <>
                                                    <Check className="size-4 mr-2" />
                                                    Copied!
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="size-4 mr-2" />
                                                    Copy URL
                                                </>
                                            )}
                                        </ContextMenuItem>
                                        <ContextMenuItem onClick={() => handleDownload(upload)}>
                                            <Download className="size-4 mr-2" />
                                            Download
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                            onClick={() => void handleDelete(upload.filename)}
                                            className="text-destructive"
                                        >
                                            <Trash2 className="size-4 mr-2" />
                                            Delete
                                        </ContextMenuItem>
                                    </ContextMenuContent>
                                </ContextMenu>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg border divide-y" style={{ borderColor: currentTheme.styles.borderDefault }}>
                            {filteredUploads.map((upload) => (
                                <ContextMenu key={upload.id}>
                                    <ContextMenuTrigger>
                                        <div
                                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                                            style={{ backgroundColor: currentTheme.styles.surfaceSecondary }}
                                            onClick={() => setSelectedImage(upload)}
                                        >
                                            <div
                                                className="size-10 rounded overflow-hidden shrink-0 border"
                                                style={{ borderColor: currentTheme.styles.borderDefault, backgroundColor: currentTheme.styles.surfacePrimary }}
                                            >
                                                <img
                                                    src={upload.url}
                                                    alt={upload.originalName}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                                                    {upload.originalName || upload.filename}
                                                </p>
                                                <p className="text-[10px]" style={{ color: currentTheme.styles.contentTertiary }}>
                                                    {formatFileSize(upload.size)} · {formatDate(upload.createdAt)} · {upload.mimeType}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleCopyUrl(upload);
                                                    }}
                                                    title="Copy URL"
                                                >
                                                    {copiedId === upload.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDownload(upload);
                                                    }}
                                                    title="Download"
                                                >
                                                    <Download className="size-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleDelete(upload.filename);
                                                    }}
                                                    title="Delete"
                                                    style={{ color: currentTheme.styles.semanticDestructive }}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                        <ContextMenuItem onClick={() => setSelectedImage(upload)}>View</ContextMenuItem>
                                        <ContextMenuItem onClick={() => void handleCopyUrl(upload)}>
                                            {copiedId === upload.id ? (
                                                <>
                                                    <Check className="size-4 mr-2" />
                                                    Copied!
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="size-4 mr-2" />
                                                    Copy URL
                                                </>
                                            )}
                                        </ContextMenuItem>
                                        <ContextMenuItem onClick={() => handleDownload(upload)}>
                                            <Download className="size-4 mr-2" />
                                            Download
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                            onClick={() => void handleDelete(upload.filename)}
                                            className="text-destructive"
                                        >
                                            <Trash2 className="size-4 mr-2" />
                                            Delete
                                        </ContextMenuItem>
                                    </ContextMenuContent>
                                </ContextMenu>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <ImageViewer
                open={!!selectedImage}
                onOpenChange={(open) => !open && setSelectedImage(null)}
                src={selectedImage?.url || ""}
                alt={selectedImage?.originalName || ""}
                filename={selectedImage?.filename || ""}
            />
        </div>
    );
}
