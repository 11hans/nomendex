/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

// Disable micromark debug logging immediately.
// On some WKWebView setups, localStorage access can throw SecurityError during bootstrap.
try {
    if (typeof window !== "undefined" && window.localStorage) {
        const debug = window.localStorage.getItem("debug");
        if (debug?.includes("micromark")) {
            window.localStorage.setItem("debug", debug.replace(/micromark[^,]*,?/g, "").replace(/^,+|,+$/g, ""));
        }
    }
} catch {
    // Non-fatal: keep booting even if storage is unavailable.
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const elem = document.getElementById("root")!;
const app = (
    <StrictMode>
        <App />
    </StrictMode>
);

if (import.meta.hot) {
    // With hot module reloading, `import.meta.hot.data` is persisted.
    const root = (import.meta.hot.data.root ??= createRoot(elem));
    root.render(app);
} else {
    // The hot module reloading API is not available in production.
    createRoot(elem).render(app);
}
