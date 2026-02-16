---
name: macos-scrollbar
description: Custom themed scrollbars for macOS WKWebView apps. Use when styling scrollbars in the native macOS app, fixing scrollbar theming issues, implementing custom scroll containers that work in WKWebView, or debugging scroll position persistence issues with tabs.
---

# MacOS WKWebView Custom Scrollbars

## The Problem

WKWebView on macOS does **not** support standard CSS scrollbar styling:
- `::-webkit-scrollbar` pseudo-elements are ignored
- `scrollbar-color` and `scrollbar-width` CSS properties don't work reliably
- Native scrollbars always render with system appearance

This means CSS-based scrollbar theming that works in browsers will NOT work in the native macOS app.

## The Solution: Negative Margin Technique

Hide the native scrollbar using pure CSS layout (not pseudo-elements):

1. **Outer wrapper**: `overflow: hidden` clips the native scrollbar
2. **Inner scrollable div**: `overflow-y: scroll` + `marginRight: -20px` pushes scrollbar outside
3. **Padding compensation**: `paddingRight: 20px` ensures content isn't cut off
4. **Custom overlay**: Render a themed scrollbar as a positioned DOM element

## Usage

Use the `OverlayScrollbar` component from `@/components/OverlayScrollbar`:

```tsx
import { OverlayScrollbar } from "@/components/OverlayScrollbar";

// Basic usage
<OverlayScrollbar className="h-full">
    <div>Your scrollable content here</div>
</OverlayScrollbar>

// With scroll position persistence
const scrollRef = useTabScrollPersistence(tabId);

<OverlayScrollbar
    scrollRef={scrollRef}
    className="flex-1 h-full"
    style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
>
    <div>Content with scroll position saved</div>
</OverlayScrollbar>
```

## Component Props

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Scrollable content |
| `className` | `string` | CSS classes for outer wrapper |
| `style` | `CSSProperties` | Inline styles for outer wrapper |
| `scrollRef` | `RefObject<HTMLDivElement>` | Optional ref for scroll position access |

## Features

- **Theme-aware**: Uses `currentTheme.styles.borderDefault` for scrollbar color
- **Auto-hide**: Scrollbar fades out after 1 second of inactivity
- **Hover to show**: Scrollbar appears when hovering the container
- **Drag support**: Click and drag the thumb to scroll
- **Track click**: Click the track to jump to position
- **Resize-aware**: Updates when content or container size changes

## When to Use

Use `OverlayScrollbar` instead of native `overflow-y-auto` when:
- The scroll container needs themed scrollbars
- The component renders in the macOS WKWebView app
- You want consistent scrollbar appearance across web and native

## When NOT to Use

- Very small scroll areas (the overlay adds complexity)
- Performance-critical lists with thousands of items (consider virtualization)
- Areas where native scrollbar behavior is preferred

## Implementation Details

See the full component at: `src/components/OverlayScrollbar.tsx`

Key constants:
- `SCROLLBAR_WIDTH = 20` - Margin to hide native scrollbar (macOS scrollbar is ~15-17px)
- Thumb minimum height: 30px
- Hide delay: 1000ms after scroll stops
- Fade transition: 150ms

## Scroll Position Persistence for Tabs

When implementing scroll persistence for workspace tabs, use `useTabScrollPersistence` with `OverlayScrollbar`.

### Critical Constraint: Radix TabsContent Unmounts Inactive Tabs

Radix UI's `TabsContent` (used by shadcn `Tabs`) **unmounts** content when the tab is not active (unless `forceMount` is set). This means:
- Switching away from a tab **destroys** the component and its DOM (including scroll containers)
- Switching back **remounts** the component fresh (new refs, new state, new effects)
- You CANNOT rely on `isActive` state transitions to detect tab switches — the component always mounts fresh with `isActive=true`

This is why scroll position must be saved to a **module-level Map** (survives unmounts) rather than component state or refs.

### How It Works

`useTabScrollPersistence(tabId)` returns a ref and manages two concerns:

**Saving** (scroll listener):
- Attaches a scroll event listener to save `scrollTop` to a module-level `Map<string, number>`
- The listener is **disabled** during the restoration window to prevent overwriting the saved position with `scrollTop=0` from the fresh mount

**Restoring** (settling window):
- On mount, reads the saved position from the Map
- Tries to restore immediately, on the next animation frame, and on every DOM mutation/resize
- Keeps retrying for a **1.5-second settling window** to handle async content (e.g., chat history loading via API)
- After the window closes, stops restoring and re-enables the scroll save listener

### Usage

```tsx
const scrollRef = useTabScrollPersistence(tabId);

<OverlayScrollbar scrollRef={scrollRef} className="flex-1">
    {/* content */}
</OverlayScrollbar>
```

**Do NOT pass an `isActive` parameter.** The hook only takes `tabId`. Since Radix unmounts inactive tabs, `isActive` transition detection is impossible (dead code).

### Critical Rule: Keep OverlayScrollbar Mounted

**The ref must be attached to a mounted element when `useTabScrollPersistence`'s effect runs.**

If you conditionally render a different tree during loading, the ref won't be set and restoration will fail:

```tsx
// BAD - OverlayScrollbar unmounts during loading, ref is null when effect runs
if (isLoading) {
    return <Loader />;  // Different tree, no OverlayScrollbar!
}

return (
    <OverlayScrollbar scrollRef={scrollRef}>
        {/* content */}
    </OverlayScrollbar>
);
```

```tsx
// GOOD - OverlayScrollbar stays mounted, ref is always set
return (
    <OverlayScrollbar scrollRef={scrollRef} className="flex-1">
        {isLoading ? (
            <div className="flex h-full items-center justify-center">
                <Loader />
            </div>
        ) : (
            {/* actual content */}
        )}
    </OverlayScrollbar>
);
```

### Common Pitfalls

| Pitfall | Why It Breaks | Fix |
|---------|---------------|-----|
| Saving scroll during restoration | Fresh mount fires scroll events with `scrollTop=0`, overwriting saved position | `isRestoringRef` guard blocks saves during settling window |
| Single-shot restoration (`hasRestoredRef`) | Restores once before async content renders, then stops | Settling window keeps retrying for 1.5s |
| `isActive` transition detection | Component unmounts/remounts, so `wasActiveRef` always starts fresh — transition is never detected | Don't use `isActive`; rely on mount-time restoration |
| Rendering OverlayScrollbar conditionally | `scrollRef.current` is null when the restoration effect runs | Always keep OverlayScrollbar in the tree; swap children instead |

### Debugging

The hook has a `DEBUG` flag at the top of `useTabScrollPersistence.ts`. Set it to `true` to see `[ScrollPersistence]` logs in the console showing:
- Mount: saved position and container dimensions
- Each restoration attempt and whether it succeeded
- When the settling window closes and the final scroll position

### Checklist for Scroll Persistence

- [ ] Use `OverlayScrollbar` (not native `overflow-y-auto`) for the scroll container
- [ ] Pass `scrollRef` from `useTabScrollPersistence(tabId)` to `OverlayScrollbar`
- [ ] Keep `OverlayScrollbar` in the component tree during ALL render states (loading, error, etc.)
- [ ] Render loading/error states as CHILDREN of `OverlayScrollbar`, not as alternative returns
- [ ] Do NOT pass an `isActive` parameter to the hook

### Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useTabScrollPersistence.ts` | Hook that saves/restores scroll position per tab |
| `src/components/OverlayScrollbar.tsx` | Custom scrollbar with `scrollRef` prop |
| `src/features/notes/note-view.tsx` | Reference implementation |
| `src/features/chat/chat-view.tsx` | Chat implementation with async history loading |

## References

- [CSS Negative Margin Technique](https://www.codestudy.net/blog/hide-scroll-bar-but-while-still-being-able-to-scroll/)
- [WKWebView Scrollbar Limitations - Apache JIRA](https://issues.apache.org/jira/browse/CB-10123)
- [Apple Developer Forums - WKWebView Scroll](https://developer.apple.com/forums/thread/134112)
