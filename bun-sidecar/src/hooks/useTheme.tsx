"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

// Type for the native macOS WebKit message handlers
interface WebKitMessageHandlers {
    setNativeTheme?: {
        postMessage: (data: { backgroundColor: string; themeName: string }) => void;
    };
    startWindowDrag?: {
        postMessage: (data: Record<string, never>) => void;
    };
    triggerAppUpdate?: {
        postMessage: (data: Record<string, never>) => void;
    };
    checkForUpdatesInBackground?: {
        postMessage: (data: Record<string, never>) => void;
    };
    calendarSync?: {
        postMessage: (data: Record<string, unknown>) => void;
    };
    reminderSync?: {
        postMessage: (data: Record<string, unknown>) => void;
    };
}

declare global {
    interface Window {
        webkit?: {
            messageHandlers?: WebKitMessageHandlers;
        };
    }
}

/**
 * Notifies the native macOS app of theme changes for title bar styling
 */
function applyDarkClass(themeName: string) {
    if (themeName === "Dark") {
        document.documentElement.classList.add("dark");
    } else {
        document.documentElement.classList.remove("dark");
    }
}

function notifyNativeTheme(backgroundColor: string, themeName: string) {
    if (window.webkit?.messageHandlers?.setNativeTheme) {
        window.webkit.messageHandlers.setNativeTheme.postMessage({
            backgroundColor,
            themeName,
        });
    }
}

/**
 * Starts native window drag operation (for custom title bar)
 * Call this on mousedown events in draggable title bar regions
 */
export function startNativeWindowDrag() {
    if (window.webkit?.messageHandlers?.startWindowDrag) {
        window.webkit.messageHandlers.startWindowDrag.postMessage({});
    }
}

export type Theme = {
    name: string;
    styles: {
        // Surface colors (backgrounds)
        surfacePrimary: string;
        surfaceSecondary: string;
        surfaceTertiary: string;
        surfaceAccent: string;
        surfaceMuted: string;

        // Content colors (text)
        contentPrimary: string;
        contentSecondary: string;
        contentTertiary: string;
        contentAccent: string;

        // Border colors
        borderDefault: string;
        borderAccent: string;

        // Semantic colors
        semanticPrimary: string;
        semanticPrimaryForeground: string;
        semanticDestructive: string;
        semanticDestructiveForeground: string;
        semanticSuccess: string;
        semanticSuccessForeground: string;

        // Design tokens
        borderRadius: string;
        shadowSm: string;
        shadowMd: string;
        shadowLg: string;
    };
};

interface ThemeContextType {
    currentTheme: Theme;
    setTheme: (theme: Theme) => void;
    themes: Theme[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
    children: ReactNode;
}

const themes: Theme[] = [
    {
        name: "Light",
        styles: {
            // Surface colors from :root OKLch variables
            surfacePrimary: "oklch(0.96 0.003 270)",     // --background
            surfaceSecondary: "oklch(0.95 0.004 270 / 0.6)",  // --secondary
            surfaceTertiary: "oklch(0.88 0.005 270 / 0.6)",   // --border
            surfaceAccent: "oklch(0.92 0.005 270 / 0.6)",     // --accent
            surfaceMuted: "oklch(0.99 0.002 270 / 0.7)",      // --card

            // Content colors
            contentPrimary: "oklch(0.25 0 0)",          // --foreground
            contentSecondary: "oklch(0.45 0 0)",        // --muted-foreground
            contentTertiary: "oklch(0.50 0 0)",         // lighter text
            contentAccent: "oklch(0.50 0.18 250)",      // --primary

            // Border colors
            borderDefault: "oklch(0.88 0.005 270 / 0.6)",    // --border
            borderAccent: "oklch(0.50 0.18 250)",            // --ring (primary)

            // Semantic colors
            semanticPrimary: "oklch(0.50 0.18 250)",         // --primary
            semanticPrimaryForeground: "oklch(1 0 0)",       // white
            semanticDestructive: "oklch(0.55 0.24 27)",      // --destructive
            semanticDestructiveForeground: "oklch(1 0 0)",   // white
            semanticSuccess: "oklch(0.45 0.22 145)",         // --success
            semanticSuccessForeground: "oklch(1 0 0)",       // white

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "none",
            shadowMd: "none",
            shadowLg: "none",
        },
    },
    {
        name: "Dark",
        styles: {
            // Surface colors from .dark OKLch variables
            surfacePrimary: "oklch(0.14 0.005 270)",         // --background
            surfaceSecondary: "oklch(0.22 0.008 270 / 0.6)", // --secondary
            surfaceTertiary: "oklch(0.28 0.008 270 / 0.5)",  // --border
            surfaceAccent: "oklch(0.22 0.008 270 / 0.6)",    // --accent
            surfaceMuted: "oklch(0.18 0.005 270 / 0.7)",     // --card

            // Content colors
            contentPrimary: "oklch(0.90 0 0)",          // --foreground
            contentSecondary: "oklch(0.60 0 0)",        // --muted-foreground
            contentTertiary: "oklch(0.65 0 0)",         // lighter text
            contentAccent: "oklch(0.72 0.18 250)",      // --primary

            // Border colors
            borderDefault: "oklch(0.28 0.008 270 / 0.5)",    // --border
            borderAccent: "oklch(0.72 0.18 250)",            // --ring (primary)

            // Semantic colors
            semanticPrimary: "oklch(0.72 0.18 250)",         // --primary
            semanticPrimaryForeground: "oklch(1 0 0)",       // white
            semanticDestructive: "oklch(0.65 0.24 27)",      // --destructive
            semanticDestructiveForeground: "oklch(1 0 0)",   // white
            semanticSuccess: "oklch(0.70 0.24 145)",         // --success
            semanticSuccessForeground: "oklch(1 0 0)",       // white

            // Design tokens
            borderRadius: "0.5rem",
            shadowSm: "none",
            shadowMd: "none",
            shadowLg: "none",
        },
    },
];

export function ThemeProvider({ children }: ThemeProviderProps) {
    // Default to first theme (Light) until we load from API
    const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
        const defaultTheme = themes[0]!;
        applyDarkClass(defaultTheme.name);
        document.body.style.backgroundColor = defaultTheme.styles.surfacePrimary;
        // Apply default scrollbar theme colors
        document.documentElement.style.setProperty("--scrollbar-thumb", defaultTheme.styles.borderDefault);
        document.documentElement.style.setProperty("--scrollbar-track", "transparent");
        document.documentElement.style.setProperty("--scrollbar-thumb-hover", defaultTheme.styles.contentTertiary);
        return defaultTheme;
    });

    // Load theme from API on mount
    useEffect(() => {
        async function loadTheme() {
            try {
                const response = await fetch("/api/theme");
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.data?.themeName) {
                        const savedTheme = themes.find(t => t.name === result.data.themeName);
                        if (savedTheme) {
                            setCurrentTheme(savedTheme);
                            applyDarkClass(savedTheme.name);
                            document.body.style.backgroundColor = savedTheme.styles.surfacePrimary;
                            // Apply scrollbar theme colors
                            document.documentElement.style.setProperty("--scrollbar-thumb", savedTheme.styles.borderDefault);
                            document.documentElement.style.setProperty("--scrollbar-track", "transparent");
                            document.documentElement.style.setProperty("--scrollbar-thumb-hover", savedTheme.styles.contentTertiary);
                            // Notify native macOS app for title bar color sync
                            notifyNativeTheme(savedTheme.styles.surfaceSecondary, savedTheme.name);
                        }
                    } else {
                        // No saved theme, notify native app with default theme
                        notifyNativeTheme(themes[0]!.styles.surfaceSecondary, themes[0]!.name);
                    }
                } else {
                    // Failed to load, notify native app with default theme
                    notifyNativeTheme(themes[0]!.styles.surfaceSecondary, themes[0]!.name);
                }
            } catch (error) {
                console.error("Failed to load theme:", error);
                // On error, notify native app with default theme
                notifyNativeTheme(themes[0]!.styles.surfaceSecondary, themes[0]!.name);
            }
        }
        loadTheme();
    }, []);

    const setTheme = (theme: Theme) => {
        setCurrentTheme(theme);
        applyDarkClass(theme.name);
        // Apply the background color to the document body
        document.body.style.backgroundColor = theme.styles.surfacePrimary;
        // Apply scrollbar theme colors
        document.documentElement.style.setProperty("--scrollbar-thumb", theme.styles.borderDefault);
        document.documentElement.style.setProperty("--scrollbar-track", "transparent");
        document.documentElement.style.setProperty("--scrollbar-thumb-hover", theme.styles.contentTertiary);
        // Notify native macOS app for title bar color sync
        notifyNativeTheme(theme.styles.surfaceSecondary, theme.name);
        // Persist theme selection to API
        fetch("/api/theme", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ themeName: theme.name }),
        }).catch(error => {
            console.error("Failed to save theme:", error);
        });
    };

    const value = {
        currentTheme,
        setTheme,
        themes,
    };

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
