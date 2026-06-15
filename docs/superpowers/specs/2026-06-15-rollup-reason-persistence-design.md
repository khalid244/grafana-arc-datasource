# Durable rollup reason on the query-editor status chip

Date: 2026-06-15
Status: Approved (design) — pending implementation
Scope: frontend-only (`src/`), no Go backend or Arc server changes

## Problem

In the Arc datasource QueryEditor, the rollup status banner explains *why* a query
won't be served from a cube — e.g. `Won't roll up · time bucket is under 1h …`.
That explanation is the **pre-run prediction** state (`rollupStatusProps`). It renders
only while `resultFresh === false`. The instant a result lands for the current SQL,
`resultFresh` flips true and the banner upgrades to the **post-run result**
`Source · 12 ms`, which **drops the reason entirely**.

Consequences:

- The reason appears to "flash for a split second" on every run / refresh / time-range
  change, because the prediction is briefly visible, then the result replaces it.
- More importantly, **once a query has run there is no way to see why it hit source.**
  The diagnostic lives only in the ephemeral prediction; the post-run chip knows it hit
  `source` (`meta.servedBy`) but carries no reason. The backend query response only
  returns `servedBy`/`rollupCube` (`pkg/plugin/query.go`); the reason exists only on the
  separate `/api/v1/query/explain` endpoint used for the prediction.

## Goal

Keep the "why it won't roll up" reason **readable after the query runs**, not just
before. Removing the flash falls out of this for free: if the reason is present in both
the prediction and the result, it stays continuously on screen as the chip morphs.

Non-goals: a larger persistent "diagnostics panel"; backend/Arc changes; changing the
rollup decision logic itself.

## Approach — frontend-only reason fusion

`rollupStatusProps` already receives both inputs it needs:

- `rollupCheck` — the prediction `{ supported, cube, reason }`, computed by Arc's real
  explain router and refreshed as SQL / time range / interval change.
- `meta` — post-run provenance `{ servedBy, rollupCube, executionTime }`.

Today the post-run *source* branch ignores `rollupCheck`. The change: in that branch,
when a matching prediction reason exists, render it inline on the `Source` chip.

**Safety:** `rollupCheck` is derived from the current `query.sql` (effect dependency),
and `resultFresh` already requires `executedTarget.sql === query.sql`. So whenever both
are present they describe the *same* query — the prediction reason is the right reason
for that source result.

### Guards (edge cases)

1. `rollupCheck` is null (explain failed / mid-debounce) → plain `Source · time`
   (unchanged behavior).
2. `rollupCheck.supported === true` but the result was `source` (predicted-cube /
   ran-source mismatch) → plain `Source`, **no** reason. Never show a "will roll up"
   reason next to a source result.
3. Result was `rollup` → unchanged `Rolled up · cube · time` (reason not relevant).
4. **Off** mode → `rollupCheck` is already forced null upstream (the prediction is
   suppressed when the user chose Off), so the source chip stays plain. Correct: "off"
   means source was chosen deliberately; there is no "why no cube" to explain.

### Presentation — full reason inline

The reason renders inline on the chip (the banner is already a full-width, wrapping
left-accent bar, and the prediction already shows its reason inline). This keeps the
reason in the same place across the transition:

```
Prediction (before run):
│ ⦿  Won't roll up · time bucket is under 1h; widen range or set Min interval ≥ 1h

Result (after run):
│ ▤  Source · time bucket is under 1h; widen range or set Min interval ≥ 1h · 12 ms
```

Label and tone morph (amber → neutral) and the execution time appears, but the reason
text stays put — so there is no information flash.

### Why the flash disappears

Because the reason is now rendered in both the prediction and the result, nothing
vanishes during the prediction→result transition. Residual label/tone flicker on a
same-SQL *refresh* (Loading briefly reverts to the prediction) is out of scope for v1;
an optional follow-up ("hold the last source result while a same-SQL reload is in
flight") can smooth it later without speculative coupling to Grafana loading-series
internals.

## Components

- **New `src/rollupStatus.ts`** — extract the currently-inline `rollupStatusProps`
  (and its `RollupStatusProps`/tone types and the `parseCube`/`fmtMs` helpers it needs)
  into a pure module with no Grafana-UI imports, mirroring the existing `rollupMode.ts`
  pattern. Add the reason-fusion logic + guards here. Export it.
- **`src/QueryEditor.tsx`** — import the extracted selector instead of the inline copy;
  the `RollupStatus` React component (which already supports `detail` + `tooltip`) stays
  in the editor. No behavior change beyond consuming the new selector.
- **New `src/rollupStatus.test.ts`** — Jest unit tests (Jest is already wired since
  v1.3.2).

## Testing

Unit tests for `rollupStatusProps`:

- source result + prediction `supported:false` with a reason → chip carries the reason.
- source result + `rollupCheck` null → plain `Source`, no reason.
- source result + prediction `supported:true` (mismatch) → plain `Source`, no reason.
- rollup result → `Rolled up`, prediction reason ignored.
- prediction-only (no fresh result) → unchanged prediction chip.
- off-mode source result (rollupCheck null) → plain `Source`.

Manual check in Grafana: run a sub-hour-bucketed query → confirm the `Source` chip shows
the reason after the run and that it no longer "flashes" away.

## Out of scope / future

- Backend-authoritative reason (Arc emits the literal router reason via a response
  header, threaded through `query.go`) — a later upgrade to the same chip for ground
  truth instead of a (near-identical) prediction.
- "Hold last source result during same-SQL reload" de-thrash refinement.
