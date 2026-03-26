# Git Sync

Git Sync enables repository synchronization for the active workspace, including:
- setup and remote configuration
- pull/push/commit orchestration
- source-control workflow with staged/unstaged changes
- per-file operations (`stage`, `unstage`, `discard`)
- inline diff previews (`HEAD` vs working tree)
- auto-sync (interval + on-change)
- merge-conflict handling flow
- authentication mode selection (`local` vs `pat`)
- Quick Sync button in sidebar

## Overview

Sync uses two layers:
- `GHSyncContext` for setup status, ahead/behind counters, and sync orchestration
- direct source-control routes (`/api/git/*`) for file-level operations shown in the Sync page

High-level flow:
1. Check setup (`git installed`, repo initialized, remote configured, auth readiness)
2. Fetch remote status (`behindCount`, `aheadCount`)
3. Run sync sequence: `commit -> pull -> push`
4. If setup is complete, switch Sync page into Source Control mode (`SyncSourceControl`)
5. Handle conflicts through dedicated endpoints and UI actions

## Authentication Modes

Workspace-level auth mode (`gitAuthMode`):
- `local`: uses local git credentials (SSH keys / credential helper)
- `pat`: requires `GITHUB_PAT` secret

Behavior:
- `local` mode can sync without PAT
- `pat` mode blocks sync readiness when PAT is missing

## Core Client State (`GHSyncContext`)

`status` tracks runtime sync state:
- `checking`, `syncing`
- `behindCount`, `aheadCount`
- `hasMergeConflict`
- `lastChecked`, `lastSynced`
- `error`

`setupStatus` tracks setup prerequisites:
- `gitInstalled`, `gitInitialized`, `hasRemote`, `hasPAT`

Derived flags:
- `isReady`: repository can sync (`initialized + remote`)
- `needsSetup`: setup incomplete for chosen auth mode

## Auto-Sync Modes

Configured from workspace settings and applied in `GHSyncContext`:
- scheduled polling: interval-based fetch/sync checks
- sync-on-change: file-change polling with debounce

Key behavior:
- On-change sync uses debounce (5s)
- Sync pauses automatically when merge conflict is active
- Auto-sync can be globally paused/resumed

## Quick Sync Button (Sidebar)

`WorkspaceSidebar` exposes a compact Quick Sync action near the Sync nav item.

Button states:
- enabled: triggers `sync()`
- disabled during active sync
- disabled when merge conflict exists
- spinner icon while syncing

Tooltip semantics:
- `Sync now`
- `Syncing...`
- `Resolve conflicts in Sync`

## Sync Page Workflow

Sync page (`/sync`) starts in setup mode and then switches into Source Control mode.

Setup mode provides:
- setup diagnostics and initialization
- auth mode toggle (`local` / `pat`)
- remote URL/branch connection flow

Source Control mode provides:
- manual Sync button with incoming/outgoing counters
- staged and unstaged file sections
- stage/unstage all
- per-file stage/unstage/discard actions
- inline diff previews for changed files
- commit box with custom message (`⌘Enter` to commit)
- recent commits list
- merge conflict UI with resolution actions
- settings panel (auth mode + auto-sync controls)

### Source Control Details

The Source Control panel (`SyncSourceControl`) keeps a detailed status model:
- `stagedFiles`, `unstagedFiles`
- `hasUncommittedChanges`
- `currentBranch`, `remoteBranch`, `remoteUrl`
- `recentCommits`
- `hasMergeConflict`

Diff preview behavior:
- compares `HEAD` blob to current working-tree file content
- marks binary files as non-previewable
- truncates large content previews
- collapses unchanged context while keeping nearby lines around changes

## Backend API (`/api/git/*`)

Setup/status routes:
- `GET /api/git/installed`
- `POST /api/git/init`
- `GET /api/git/status`
- `GET /api/git/status-detailed`
- `POST /api/git/setup-remote`

Sync orchestration routes:
- `POST /api/git/commit`
- `POST /api/git/pull`
- `POST /api/git/push`
- `POST /api/git/fetch-status`

Source-control routes:
- `POST /api/git/stage`
- `POST /api/git/unstage`
- `POST /api/git/stage-all`
- `POST /api/git/unstage-all`
- `POST /api/git/discard`
- `GET /api/git/file-diff?path=...`

Conflict routes:
- `GET /api/git/conflicts`
- `POST /api/git/resolve-conflict`
- `POST /api/git/abort-merge`
- `POST /api/git/continue-merge`
- `GET /api/git/conflict-content?path=...`

### Commit Route Behavior

`POST /api/git/commit` supports both staged commits and selective staging:
- if `files` are provided, only those files are staged before commit
- if no message is provided (legacy path), all changes are staged
- if only `message` is provided, currently staged files are committed

## Merge Conflict Flow

On pull conflict:
- backend returns conflict response (`hadConflicts`) and file list
- frontend enters conflict mode (`hasMergeConflict = true`)
- normal sync actions are paused

Resolution path:
1. choose resolution per file (ours/theirs/agent/manual)
2. optionally inspect `/api/git/conflict-content` and open "Solve with Agent"
3. mark file resolved
4. continue merge
5. clear conflict state and resume normal sync

Manual resolver path:
- each conflict row can open `/sync/resolve?path=...` for explicit review/edit

Abort path:
- `POST /api/git/abort-merge` resets merge state and exits conflict mode

Continue path:
- `POST /api/git/continue-merge` verifies all conflicts are resolved, stages files, creates merge commit, and clears merge state

## Implementation Notes

Git operations are built on `isomorphic-git`, not the system git CLI.

`local` auth mode supports credential-helper integration by calling:
- `git credential fill`
- `git credential approve`
- `git credential reject`

This allows reuse of existing macOS Keychain / SSH helper setup while staying inside isomorphic-git transport callbacks.

## Error Handling

Routes return user-friendly messages for common classes:
- auth failures
- missing remote / missing branch
- non-fast-forward push rejection
- network/host resolution failures

Frontend surfaces errors in `syncStatus.error` and blocks unsafe actions when needed.

## Related Files

- `bun-sidecar/src/contexts/GHSyncContext.tsx`
- `bun-sidecar/src/pages/sync/SyncPage.tsx`
- `bun-sidecar/src/pages/sync/SyncSourceControl.tsx`
- `bun-sidecar/src/pages/sync/SetupWizard.tsx`
- `bun-sidecar/src/pages/sync/FileChangeList.tsx`
- `bun-sidecar/src/pages/sync/InlineDiff.tsx`
- `bun-sidecar/src/pages/sync/MergeConflictBanner.tsx`
- `bun-sidecar/src/pages/sync/CommitBox.tsx`
- `bun-sidecar/src/components/WorkspaceSidebar.tsx`
- `bun-sidecar/src/server-routes/git-sync.ts`
- `bun-sidecar/src/lib/git.ts`
