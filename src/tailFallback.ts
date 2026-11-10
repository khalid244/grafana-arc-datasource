// Defaults mirror the backend (getSettings in pkg/plugin/datasource.go).
export const TAIL_FALLBACK_DEFAULT = false;
export const TAIL_DEADLINE_DEFAULT_MS = 10000;

// A blank or non-positive deadline snaps back to the default on blur, the same
// way the other numeric config fields do.
export function normalizeTailDeadline(value: number | undefined | null): number {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 1) {
    return TAIL_DEADLINE_DEFAULT_MS;
  }
  return Math.floor(value);
}
