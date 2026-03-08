import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Theme } from "@/hooks/useTheme";

type BrowserStyles = Theme["styles"];

interface BrowserViewShellProps {
    styles: BrowserStyles;
    loading: boolean;
    loadingLabel: string;
    error: string | null;
    errorLabel: string;
    title: string;
    itemCount: number;
    headerIcon: ReactNode;
    action?: ReactNode;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    searchInputRef: RefObject<HTMLInputElement | null>;
    searchPlaceholder: string;
    empty: boolean;
    emptyLabel: string;
    listRef: RefObject<HTMLDivElement | null>;
    children: ReactNode;
    rootClassName?: string;
}

export function BrowserViewShell({
    styles,
    loading,
    loadingLabel,
    error,
    errorLabel,
    title,
    itemCount,
    headerIcon,
    action,
    searchQuery,
    onSearchQueryChange,
    onSearchKeyDown,
    searchInputRef,
    searchPlaceholder,
    empty,
    emptyLabel,
    listRef,
    children,
    rootClassName,
}: BrowserViewShellProps) {
    if (loading) {
        return (
            <div
                className="h-full flex items-center justify-center text-xs"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    color: styles.contentTertiary,
                }}
            >
                {loadingLabel}
            </div>
        );
    }

    if (error) {
        return (
            <div
                className="h-full flex items-center justify-center px-4 text-xs"
                style={{ backgroundColor: styles.surfacePrimary }}
            >
                <span style={{ color: styles.semanticDestructive }}>
                    {errorLabel}: {error}
                </span>
            </div>
        );
    }

    return (
        <div
            ref={listRef}
            className={`${rootClassName ?? ""} h-full min-h-0 overflow-y-auto`.trim()}
            style={{ backgroundColor: styles.surfacePrimary }}
        >
            <div className="mx-auto w-full max-w-[620px] px-3 pt-3 pb-6">
                <div className="shrink-0 flex items-center gap-1.5">
                    {headerIcon}
                    <span
                        className="text-[11px] font-medium uppercase tracking-[0.14em]"
                        style={{ color: styles.contentPrimary }}
                    >
                        {title}
                    </span>
                    <span
                        className="text-[10px]"
                        style={{ color: styles.contentTertiary }}
                    >
                        {itemCount} items
                    </span>
                    {action && <div className="ml-auto">{action}</div>}
                </div>

                <div className="shrink-0 mt-2.5">
                    <div className="relative">
                        <Search
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3"
                            style={{ color: styles.contentTertiary }}
                        />
                        <Input
                            ref={searchInputRef}
                            type="text"
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(event) => onSearchQueryChange(event.target.value)}
                            onKeyDown={onSearchKeyDown}
                            className="h-8 pl-8 text-xs bg-transparent"
                            style={{
                                borderColor: styles.borderDefault,
                                color: styles.contentPrimary,
                            }}
                        />
                    </div>
                </div>

                <div className="mt-2.5">
                    {empty ? (
                        <div
                            className="py-3 text-center text-[10px]"
                            style={{ color: styles.contentTertiary }}
                        >
                            {emptyLabel}
                        </div>
                    ) : (
                        children
                    )}
                </div>
            </div>
        </div>
    );
}

export function BrowserListCard({
    styles,
    children,
}: {
    styles: BrowserStyles;
    children: ReactNode;
}) {
    return (
        <div
            className="overflow-hidden rounded-lg border"
            style={{
                borderColor: styles.borderDefault,
                backgroundColor: styles.surfaceSecondary,
            }}
        >
            {children}
        </div>
    );
}
