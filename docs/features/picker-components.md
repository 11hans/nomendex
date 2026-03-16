# Picker Components

Shared, reusable picker components extracted from the task editor for consistent UI across all todo-related views.

## Overview

Previously, `TaskCardEditor` contained inline implementations of status, priority, project, tags, date, and attachment pickers — totaling hundreds of lines of popover logic, keyboard navigation, and state management. These were extracted into standalone components in a `pickers/` directory and are now shared between `TaskCardEditor`, `CreateTodoDialog`, and `InboxListView`.

## Components

| Component | Icon | Description |
|-----------|------|-------------|
| `StatusPicker` | ○ | Popover with 4 status options, keyboard navigation (↑↓ Enter Esc) |
| `PriorityPicker` | 🚩 | Flag icon with color-coded popover, 4 levels |
| `ProjectPicker` | 📁 | Select from existing projects (no inline create/search) |
| `TagsPicker` | 🏷️ | Input to add tags + suggestion chips from existing tags |
| `DateTimePicker` | 📅 | Range calendar + quick presets + shorthand time parsing |
| `AttachmentPicker` | 📎 | File input trigger with upload handling |

### Interfaces

Each picker follows a controlled component pattern (`value` + `onChange`):

```typescript
// StatusPicker
interface StatusPickerProps {
    value: StatusValue;  // "todo" | "in_progress" | "done" | "later"
    onChange: (status: StatusValue) => void;
}

// PriorityPicker
interface PriorityPickerProps {
    value: PriorityValue | undefined;  // "high" | "medium" | "low" | "none"
    onChange: (priority: PriorityValue) => void;
}

// ProjectPicker
interface ProjectPickerProps {
    value: string | undefined;
    onChange: (project: string) => void;
    availableProjects: string[];
    disabled?: boolean;
}

// TagsPicker
interface TagsPickerProps {
    value: string[];
    onChange: (tags: string[]) => void;
    availableTags: string[];
}

// DateTimePicker
interface DateTimePickerProps {
    dueDate?: string;
    startDate?: string;
    onChange: (dates: { dueDate?: string; startDate?: string }) => void;
    compact?: boolean;  // Used for inline editing on TodoCard
}

// AttachmentPicker
interface AttachmentPickerProps {
    attachments: Attachment[];
    onChange: (attachments: Attachment[]) => void;
}
```

## DateTimePicker Details

The most complex picker, handling multiple date/time scenarios:

| Feature | Description |
|---------|-------------|
| Quick presets | `Today`, `Tomorrow`, `Next week` shortcuts |
| Calendar | Day selection via `Calendar` component |
| Text input | Type date in natural format (parsed by `parseDateFromInput`) |
| Due time | Optional `<input type="time">` for deadline hour |
| Start time | Optional time for range start |
| Time range | "Add end time" button to create `startDate → dueDate` range |
| Clear | Remove individual times or clear all dates |
| Compact mode | Smaller trigger button for inline use on `TodoCard` |
| Due-date color | trigger color changes for overdue/today/normal |

### Time Shorthand Parsing

`DateTimePicker` accepts shorthand time inputs and normalizes them:
- `9` -> `09:00`
- `930` -> `09:30`
- `1000` -> `10:00`
- `10:30` -> `10:30`

### Compact Mode (Inline Date Editing)

When `compact={true}`, the picker renders a compact date pill directly on the `TodoCard`. Clicking it opens the full calendar popover for inline editing without opening the task editor dialog.

## Keyboard Navigation

`StatusPicker` provides keyboard navigation:

- **↑↓** — move highlight between options
- **Enter / Space** — select highlighted option
- **Escape** — close popover, return focus to trigger
- Focus is managed via `useRef` to ensure proper return after selection

`ProjectPicker` is intentionally simplified to click-select from existing projects (no inline free-text create flow in picker UI).

## Calendar Week Start

The shared `Calendar` UI now accepts `weekStartsOn` (default `1`, Monday-first).  
Pickers using this component can align week start behavior with locale or workspace conventions.

## File Structure

```
bun-sidecar/src/features/todos/pickers/
├── index.ts               # Barrel exports for all pickers
├── StatusPicker.tsx        # Status selection with keyboard nav
├── PriorityPicker.tsx      # Priority flag with colored options
├── ProjectPicker.tsx       # Existing-project selector (no inline create/search)
├── TagsPicker.tsx           # Tag input with suggestion chips
├── DateTimePicker.tsx       # Calendar + presets + shorthand time parsing + range
└── AttachmentPicker.tsx     # File upload trigger

Consumers:
├── TaskCardEditor.tsx       # Uses all 6 pickers (was inline before)
├── CreateTodoDialog.tsx     # Uses ProjectPicker, TagsPicker, etc.
├── TodoCard.tsx              # Uses DateTimePicker in compact mode
└── inbox-view.tsx           # Uses TaskCardEditor (inherits pickers)
```
