import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "./ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "./ui/button";
import { Download, X, ZoomIn, ZoomOut, RotateCcw, Copy, Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { toast } from "sonner";

interface ImageViewerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    src: string;
    alt?: string;
    filename?: string;
}

export function ImageViewer({ open, onOpenChange, src, alt, filename }: ImageViewerProps) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const [zoom, setZoom] = useState(1);

    const handleDownload = () => {
        const link = document.createElement("a");
        link.href = src;
        link.download = filename || "image";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleZoomIn = () => {
        setZoom(prev => Math.min(prev + 0.25, 3));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(prev - 0.25, 0.5));
    };

    const resetZoom = () => {
        setZoom(1);
    };

    const handleCopyUrl = async () => {
        try {
            const absoluteUrl = src.startsWith("http")
                ? src
                : new URL(src, window.location.origin).toString();
            await navigator.clipboard.writeText(absoluteUrl);
            toast.success("Image URL copied");
        } catch (error) {
            console.error("Failed to copy image URL:", error);
            toast.error("Copy failed");
        }
    };

    useEffect(() => {
        if (!open) return;
        // Keep zoom predictable when opening or switching images.
        setZoom(1);
    }, [open, src]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            handleZoomIn();
        } else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            handleZoomOut();
        } else if (e.key === "0") {
            e.preventDefault();
            resetZoom();
        } else if (e.key === "Escape") {
            e.preventDefault();
            onOpenChange(false);
        }
    };

    const displayName = filename || alt || "Image";
    const zoomOutDisabled = zoom <= 0.5;
    const zoomInDisabled = zoom >= 3;

    return (
        <Dialog open={open} onOpenChange={(newOpen) => {
            if (!newOpen) resetZoom();
            onOpenChange(newOpen);
        }}>
            <DialogContent
                size="jumbo"
                showCloseButton={false}
                className="w-[min(96vw,1280px)] h-[min(92vh,920px)] max-w-[96vw] max-h-[92vh] p-0 overflow-hidden"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                <VisuallyHidden>
                    <DialogTitle>{displayName}</DialogTitle>
                </VisuallyHidden>

                <div className="h-full flex flex-col" onKeyDown={handleKeyDown} tabIndex={0}>
                    {/* Toolbar */}
                    <div
                        className="shrink-0 flex items-center justify-between gap-3 px-3 py-2"
                        style={{
                            backgroundColor: styles.surfacePrimary,
                            borderBottom: `1px solid ${styles.borderDefault}`,
                        }}
                    >
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <ImageIcon className="size-3" style={{ color: styles.contentTertiary }} />
                                <span className="text-caption uppercase tracking-[0.1em]" style={{ color: styles.contentTertiary }}>
                                    Image Preview
                                </span>
                            </div>
                            <div
                                className="text-sm font-medium truncate"
                                style={{ color: styles.contentPrimary }}
                            >
                                {displayName}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={handleZoomOut} title="Zoom out" disabled={zoomOutDisabled} className="h-7 w-7">
                                <ZoomOut className="size-4" />
                            </Button>
                            <span
                                className="text-xs min-w-[52px] text-center tabular-nums"
                                style={{ color: styles.contentSecondary }}
                                title="Current zoom"
                            >
                                {Math.round(zoom * 100)}%
                            </span>
                            <Button variant="ghost" size="icon" onClick={handleZoomIn} title="Zoom in" disabled={zoomInDisabled} className="h-7 w-7">
                                <ZoomIn className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={resetZoom} title="Reset zoom" className="h-7 w-7">
                                <RotateCcw className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={handleCopyUrl} title="Copy URL" className="h-7 w-7">
                                <Copy className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={handleDownload} title="Download" className="h-7 w-7">
                                <Download className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} title="Close" className="h-7 w-7">
                                <X className="size-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Image container */}
                    <div
                        className="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4"
                        style={{
                            backgroundColor: styles.surfaceSecondary,
                        }}
                    >
                        <img
                            src={src}
                            alt={alt || "Preview"}
                            className="select-none"
                            style={{
                                transform: `scale(${zoom})`,
                                transformOrigin: "center center",
                                transition: "transform 0.2s ease",
                                maxWidth: "100%",
                                maxHeight: "100%",
                                objectFit: "contain",
                            }}
                            onDoubleClick={resetZoom}
                        />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
