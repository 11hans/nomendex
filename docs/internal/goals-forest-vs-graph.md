# Goals API Shape: Forest Summary vs Graph Detail

This note explains why Goals uses two API response shapes instead of one oversized payload.

## Problem We Needed to Solve

Goals workspace V1 needs two different usage patterns:
- browser/home view that renders many goals at once
- detail view for one selected goal with full context

Using one heavy response for both would either:
- overfetch detail data for browser rows, or
- force browser to do N+1 calls (`getGoalGraph()` per goal)

## Decision

Keep two read models:

1. `POST /api/goals/graph/forest`
   - optimized for browser/home
   - returns nested goal tree + lightweight counts

2. `POST /api/goals/graph`
   - optimized for detail
   - returns one-goal graph with linked projects/todos

## Forest Contract (Browser)

Each node contains:
- goal identity + metadata (`goal`)
- hierarchy (`children`)
- progress (`computedProgress`)
- lightweight linkage counters:
  - `linkedProjectCount`
  - `linkedTodoCount`
  - `openTodoCount`
  - `doneTodoCount`

This is enough for:
- summary strip numbers
- attention heuristics
- per-row context chips

without extra detail calls.

## Graph Contract (Detail)

`/api/goals/graph` returns:
- `goal`
- `childGoals`
- `linkedProjects`
- `linkedTodos`
- `computedProgress`

This is intentionally richer and used only when the user opens one goal detail tab.

## Boundary of Responsibility

Backend responsibility:
- provide stable structural/relational data
- compute canonical counts and progress

Frontend responsibility:
- product heuristics (`needsAttention`, stale windows, UI grouping/search)

This keeps product policy easy to iterate without repeatedly changing backend contracts.

## Compatibility Rule

Forest extension is additive:
- existing fields (`goal`, `children`, `linkedProjects`, `computedProgress`) remain unchanged
- new counts can be adopted incrementally by clients

## Relevant Source Files

- `bun-sidecar/src/features/goals/fx.ts`
- `bun-sidecar/src/server-routes/goals-routes.ts`
- `bun-sidecar/src/features/goals/goals-view-model.ts`
- `bun-sidecar/src/features/goals/goals-browser-view.tsx`
- `bun-sidecar/src/features/goals/goal-detail-view.tsx`

