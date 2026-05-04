import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCommandDialog } from "@/components/CommandDialogProvider";
import { useTheme } from "@/hooks/useTheme";

interface DeleteFolderDialogProps {
    folderName: string;
    onDelete: () => Promise<void>;
}

export function DeleteFolderDialog({ folderName, onDelete }: DeleteFolderDialogProps) {
    const [isDeleting, setIsDeleting] = React.useState(false);
    const { closeDialog } = useCommandDialog();
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await onDelete();
            closeDialog();
        } catch (error) {
            console.error("Failed to delete folder:", error);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="-m-3 flex flex-col">
            <div
                className="px-6 py-3 flex items-center justify-between"
                style={{
                    backgroundColor: styles.surfaceSecondary,
                    borderBottom: `1px solid ${styles.borderDefault}`,
                }}
            >
                <span
                    className="text-xs font-medium uppercase tracking-[0.08em]"
                    style={{ color: styles.contentPrimary }}
                >
                    Delete Folder
                </span>
                <span className="text-caption" style={{ color: styles.contentTertiary }}>
                    Permanent action
                </span>
            </div>

            <div className="px-6 pt-5 pb-5">
                <div className="flex items-start gap-3">
                    <div
                        className="p-2 rounded-full shrink-0"
                        style={{ backgroundColor: `${styles.semanticDestructive}20` }}
                    >
                        <AlertTriangle size={20} style={{ color: styles.semanticDestructive }} />
                    </div>
                    <div className="min-w-0">
                        <h2
                            className="text-lg font-semibold"
                            style={{ color: styles.contentPrimary }}
                        >
                            Delete Folder
                        </h2>
                        <p
                            className="text-sm mt-1 break-words"
                            style={{ color: styles.contentSecondary }}
                        >
                            Are you sure you want to delete <strong>{folderName}</strong> and
                            all its contents? This action cannot be undone.
                        </p>
                    </div>
                </div>
            </div>

            <div
                className="px-6 py-3 flex items-center justify-end gap-2"
                style={{
                    backgroundColor: styles.surfaceSecondary,
                    borderTop: `1px solid ${styles.borderDefault}`,
                }}
            >
                <Button
                    onClick={closeDialog}
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    autoFocus
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    variant="destructive"
                    size="sm"
                    className="h-8 px-3 text-xs"
                >
                    {isDeleting ? "Deleting..." : "Delete Folder"}
                </Button>
            </div>
        </div>
    );
}
