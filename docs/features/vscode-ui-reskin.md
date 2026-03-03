# VS Code UI Reskin

Complete visual overhaul of the app to match the Visual Studio Code aesthetic — flat surfaces, icon-only Activity Bar, and a custom macOS title bar.

## Overview

The UI has been reskinned from a rounded, shadowed design to a flat, zero-radius VS Code style. Key changes:

- **Activity Bar** — vertical icon-only sidebar replacing the labeled menu
- **Flat UI** — `border-radius: 0` and no box shadows on all interactive elements
- **Custom Title Bar** — 30px draggable area with double-click-to-zoom
- **Compact File Tree** — tighter row spacing, surface-colored background

## Activity Bar

The sidebar has been restructured from a labeled menu into a VS Code-style Activity Bar:

```
Before:                    After:
┌──────────────┐           ┌────┐
│ Workspace    │           │ 📥 │ ← Inbox
│ · Notes      │           │ 📝 │ ← Notes
│ · Todos      │           │ ✅ │ ← Todos
│ · Agents     │           │ 🤖 │ ← Agents
│ · Chat       │           │ 💬 │ ← Chat
│              │           │    │
│              │           │    │
│ v1.2.3       │           │ ⚙️ │ ← Settings
└──────────────┘           └────┘
```

### Active Indicator

The active item is marked with a **left accent border** (2px vertical bar) instead of a background highlight:

```typescript
{isActive && (
    <div
        className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-sm"
        style={{ backgroundColor: currentTheme.styles.borderAccent }}
    />
)}
```

### Separate Active States

Inbox and Todos have independent active states despite sharing the same plugin. The active state checks both `pluginId` and `viewId`:

```typescript
const activePluginId = activeTab?.pluginInstance?.plugin?.id ?? null;
const activeViewId = activeTab?.pluginInstance?.viewId ?? null;

// Inbox: pluginId === "todos" && viewId === "inbox"
// Todos: pluginId === "todos" && viewId !== "inbox"
```

### Hidden Tooltips

Tooltips on Activity Bar icons are intentionally hidden (commented out) as they were deemed unnecessary for the icon-only layout.

## Flat UI

All interactive elements have been flattened to match VS Code:

| Element | Change |
|---------|--------|
| Buttons | `border-radius: 0` |
| Inputs | `border-radius: 0` |
| Dialogs | `border-radius: 0`, no shadow |
| Context menus | `border-radius: 0` |
| Dropdown menus | `border-radius: 0` |
| Tabs | `border-radius: 0`, flat bottom border |
| Scrollbars | Thin, VS Code-style overlay scrollbars |
| Cards | No shadow, no radius |

These overrides are applied globally in `input.css` using component-level CSS targeting shadcn/ui class names.

## Custom Title Bar

The macOS title bar is a 30px draggable area at the top of the window:

```typescript
export const TITLE_BAR_HEIGHT = 30;

<div
    className="w-full flex-shrink-0"
    style={{ height: `${TITLE_BAR_HEIGHT}px`, WebkitAppRegion: "drag" }}
/>
```

### Layout Structure

```
┌─────────────────────────────────────────┐
│           Title Bar (30px, draggable)    │ ← macOS traffic lights here
├────┬────────────────────────────────────┤
│    │                                    │
│ AB │     Main Content (tabs + views)    │
│    │                                    │
└────┴────────────────────────────────────┘
```

The sidebar starts below the title bar, avoiding overlap with the traffic light buttons:

```typescript
style={{
    top: `${TITLE_BAR_HEIGHT}px`,
    height: `calc(100svh - ${TITLE_BAR_HEIGHT}px)`,
}}
```

### Double-Click to Zoom

Double-clicking the title bar calls `window.zoom(nil)` in Swift, matching native macOS behavior.

## File Tree Styling

The notes file tree received visual adjustments:

- Background color changed to `surfaceSecondary`
- Row height reduced (`py-1` from `py-1.5`)
- Removed `rounded-md` from rows
- Removed `hover:bg-muted` from action buttons
- Selected note uses `surfaceAccent` background with accent border

## File Structure

```
bun-sidecar/src/components/
├── Layout.tsx              # Title bar height (30px), layout structure
├── WorkspaceSidebar.tsx     # Activity Bar with icon-only items
├── Workspace.tsx            # Tab bar adjustments

bun-sidecar/src/components/ui/
├── tabs.tsx                 # Flat tab styling
├── context-menu.tsx         # Zero-radius context menus
├── dropdown-menu.tsx        # Zero-radius dropdowns
├── sidebar.tsx              # Sidebar width and structure

bun-sidecar/src/
├── input.css                # Global flat UI overrides

bun-sidecar/src/features/notes/
├── NotesFileTree.tsx         # Compact rows, updated selection styles
├── browser-view.tsx          # Surface color on file tree panel

mac-app/macos-host/Sources/
└── WebViewWindowController.swift  # Double-click-to-zoom, title bar drag
```
