import React from 'react';
import type { IconName } from '@grafana/ui';

// Pure status-chip selector, kept out of QueryEditor.tsx (no Grafana-UI *component*
// imports — only the IconName type) so the lifecycle logic can be unit-tested
// without mounting the editor. Mirrors the rollupMode.ts split. The RollupStatus
// React component itself stays in QueryEditor.tsx; this module only decides WHICH
// chips render and WHAT text they carry.

export type RollupTone = 'success' | 'warning' | 'neutral' | 'muted';

// RollupStatusProps drives one status chip: a tinted leading icon, a terse label,
// an optional faded "(cte)" marker, and optional provenance detail / tooltip.
export interface RollupStatusProps {
  // Stable React key for the chip's ROLE ('warn' | 'provenance'), so the provenance
  // chip keeps its identity and morphs in place (Source → Rolled up) while the amber
  // warning mounts/unmounts above it — instead of the array reshuffling by index and
  // flashing when the warning appears or disappears.
  id: 'warn' | 'provenance';
  tone: RollupTone;
  icon: IconName;
  spin?: boolean;
  label: React.ReactNode;
  cube?: string;
  isCte?: boolean;
  detail?: string;
  tooltip?: React.ReactNode;
}

// Placeholder shown for the execution time before any query has run.
const NO_TIME = '—';

// fmtMs humanizes an execution time in milliseconds for the served-by badge:
// sub-second stays in ms, single-/double-digit seconds get 2 decimals, and
// anything ≥10s drops to 1 decimal. Nullish renders as an em dash.
export function fmtMs(ms: unknown): string {
  if (ms == null || typeof ms !== 'number' || !isFinite(ms)) {
    return NO_TIME;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const s = ms / 1000;
  return `${s.toFixed(s < 10 ? 2 : 1)} s`;
}

// CTE_SUFFIX matches the trailing " (cte)" marker the backend appends to a cube
// id when the query's base CTE was rewritten onto the cube. It's internal jargon,
// so we strip it from the visible label and surface it only as a subtle marker.
const CTE_SUFFIX = / \(cte\)\s*$/i;

// parseCube splits a backend cube id ("default.downloads.by_site (cte)") into the
// terse kind shown on the pill, the clean full id for the tooltip, and whether it
// was a CTE-base rewrite. The long all-dimensions cube collapses to "dim-rich".
export function parseCube(raw?: string): { kind: string; full: string; isCte: boolean } {
  if (!raw) {
    return { kind: 'a cube', full: '', isCte: false };
  }
  const isCte = CTE_SUFFIX.test(raw);
  const full = raw.replace(CTE_SUFFIX, '');
  let kind = (full.split('.').pop() || full).trim();
  if (kind.split('_').length > 4) {
    kind = 'dim-rich';
  }
  return { kind, full, isCte };
}

// wontRollUpChip builds the amber "Won't roll up · why" warning. It renders as a
// forecast before the query runs AND is kept on screen alongside the Source result
// after — so the reason and the warning colour persist instead of being replaced.
// The reason lives on THIS chip, never on the provenance chip below.
function wontRollUpChip(rollupCheck: { reason?: string }): RollupStatusProps {
  return {
    id: 'warn',
    tone: 'warning',
    icon: 'exclamation-triangle',
    label: "Won't roll up",
    detail: rollupCheck.reason || 'source scan',
    tooltip: rollupCheck.reason || 'Will run against source',
  };
}

// rollupStatusProps returns the ORDERED list of chips to render. The last chip is a
// PERSISTENT provenance chip that is ALWAYS present so it never flickers in and out:
//
//   • not run yet        → ▤ Source · —            (placeholder time)
//   • served from source → ▤ Source · <time>
//   • served from cube   → ⚡ Rolled up · cube · <time>   (morphs in place, same slot)
//
// It defaults to "Source · —" and upgrades in place once a result lands — so going
// from "not run" to "rolled up" is a single chip changing its label/time, not a chip
// appearing while another disappears.
//
// When the query is predicted NOT to roll up, an amber "⚠ Won't roll up · why"
// warning is prepended ABOVE the provenance chip (before AND after running), so the
// reason and warning colour stay on screen at the same time as the clean result. It
// is suppressed only when the query actually DID roll up (a prediction/result
// mismatch resolves to the truth).
//
// resultFresh is the crux: a `meta` block only describes the LAST executed query, so
// it must be discarded the moment the user edits the SQL — then the provenance chip
// falls back to "Source · —". The caller computes freshness by comparing the executed
// target's (uninterpolated) sql to the current editor sql.
export function rollupStatusProps(args: {
  resultFresh: boolean;
  meta: { servedBy?: string; rollupCube?: unknown; executionTime?: unknown } | null;
  rollupCheck: { supported: boolean; cube?: string; reason?: string } | null;
  rollupChecking: boolean;
}): RollupStatusProps[] {
  const { resultFresh, meta, rollupCheck, rollupChecking } = args;

  const hasResult = resultFresh && meta != null;
  const rolledUp = hasResult && meta!.servedBy === 'rollup';
  const wontRollUp = rollupCheck != null && !rollupCheck.supported;

  const chips: RollupStatusProps[] = [];

  // Amber warning — kept whenever we predict the query won't roll up, except when it
  // actually rolled up (then the prediction was wrong and there's nothing to warn).
  if (wontRollUp && !rolledUp) {
    chips.push(wontRollUpChip(rollupCheck!));
  }

  // Persistent provenance chip.
  if (rolledUp) {
    const cube = parseCube(meta!.rollupCube ? String(meta!.rollupCube) : undefined);
    chips.push({
      id: 'provenance',
      tone: 'success',
      icon: 'bolt',
      label: 'Rolled up',
      cube: cube.kind || undefined,
      isCte: cube.isCte,
      detail: fmtMs(meta!.executionTime),
      tooltip: (
        <>
          Served from cube
          <br />
          {cube.full || '—'}
          {cube.isCte && (
            <>
              <br />
              CTE base rewrite
            </>
          )}
        </>
      ),
    });
  } else if (hasResult) {
    chips.push({
      id: 'provenance',
      tone: 'neutral',
      icon: 'database',
      label: 'Source',
      detail: fmtMs(meta!.executionTime),
      tooltip: 'Served from a full source scan',
    });
  } else {
    // Not run yet — show the baseline provenance with a placeholder time.
    chips.push({
      id: 'provenance',
      tone: 'neutral',
      icon: 'database',
      label: 'Source',
      detail: NO_TIME,
      tooltip: rollupChecking
        ? 'Checking whether a cube can serve this query…'
        : 'Not run yet — will scan source unless a cube covers it',
    });
  }

  return chips;
}
