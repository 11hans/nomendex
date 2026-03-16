# Git Sync

Git Sync enables repository synchronization for the active workspace, including:
- setup and remote configuration
- pull/push/commit orchestration
- auto-sync (interval + on-change)
- merge-conflict handling flow
- authentication mode selection (`local` vs `pat`)
- Quick Sync button in sidebar

## Overview

Sync is implemented as a frontend state machine (`GHSyncContext`) over backend git routes (`/api/git/*`).

High-level flow:
1. Check setup (`git installed`, repo initialized, remote configured, auth readiness)
2. Fetch remote status (`behindCount`, `aheadCount`)
3. Run sync sequence: `commit -> pull -> push`
4. Handle conflicts through dedicated endpoints and UI actions

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

Sync page (`/sync`) provides:
- setup diagnostics and initialization
- auth mode toggle (`local` / `pat`)
- auto-sync controls (`enabled`, `paused`, `syncOnChanges`, interval)
- conflict list and conflict actions
- manual Sync button with incoming/outgoing counters

## Backend API (`/api/git/*`)

Primary routes:
- `GET /api/git/installed`
- `POST /api/git/init`
- `GET /api/git/status`
- `POST /api/git/setup-remote`
- `POST /api/git/commit`
- `POST /api/git/pull`
- `POST /api/git/push`
- `POST /api/git/fetch-status`

Conflict routes:
- `GET /api/git/conflicts`
- `POST /api/git/resolve-conflict`
- `POST /api/git/abort-merge`
- `POST /api/git/continue-merge`

## Merge Conflict Flow

On pull conflict:
- backend returns conflict response (`hadConflicts`) and file list
- frontend enters conflict mode (`hasMergeConflict = true`)
- normal sync actions are paused

Resolution path:
1. choose resolution per file (ours/theirs/agent/manual)
2. mark file resolved
3. continue merge
4. clear conflict state and resume normal sync

Abort path:
- abort merge endpoint resets merge state and exits conflict mode

## Error Handling

Routes return user-friendly messages for common classes:
- auth failures
- missing remote / missing branch
- non-fast-forward push rejection
- network/host resolution failures

Frontend surfaces errors in `syncStatus.error` and blocks unsafe actions when needed.

## Related Files

- `bun-sidecar/src/contexts/GHSyncContext.tsx`
- `bun-sidecar/src/pages/SyncPage.tsx`
- `bun-sidecar/src/components/WorkspaceSidebar.tsx`
- `bun-sidecar/src/server-routes/git-sync.ts`
- `bun-sidecar/src/lib/git.ts`
