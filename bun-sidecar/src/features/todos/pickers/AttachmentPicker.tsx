import { useState, useRef, useCallback } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Loader2, Paperclip } from "lucide-react";
import type { Attachment } from "@/types/attachments";

interface AttachmentPickerProps {
    attachments: Attachment[];
    onChange: (attachments: Attachment[]) => void;
}

export function AttachmentPicker({ attachments, onChange }: AttachmentPickerProps) {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const uploadFile = useCallback(async (file: File): Promise<Attachment | null> => {
        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch("/api/uploads", {
                method: "POST",
                body: formData,
            });

            const result = await response.json();
            if (result.success && result.data) {
                return result.data as Attachment;
            }
            console.error("Upload failed:", result.error);
            return null;
        } catch (error) {
            console.error("Upload error:", error);
            return null;
        }
    }, []);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setIsUploading(true);
        const newAttachments: Attachment[] = [];

        for (const file of files) {
            if (file.type.startsWith("image/")) {
                const attachment = await uploadFile(file);
                if (attachment) {
                    newAttachments.push(attachment);
                }
            }
        }

        if (newAttachments.length > 0) {
            onChange([...attachments, ...newAttachments]);
        }

        setIsUploading(false);
        e.target.value = "";
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
            />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center justify-center p-2 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{
                    backgroundColor: styles.surfaceTertiary,
                    color: attachments.length > 0 ? styles.contentPrimary : styles.contentTertiary,
                }}
                title="Add attachment"
            >
                {isUploading ? (
                    <Loader2 className="size-4 animate-spin" />
                ) : (
                    <Paperclip className="size-4" />
                )}
            </button>
        </>
    );
}
