import { ArcQuery } from './types';

// Rollup-mode decoding, kept in a pure module (no Grafana UI imports) so it can be
// unit-tested without mounting the editor. Mirrors the backend's tolerant decoding
// in pkg/plugin/datasource.go (optBool + ArcQuery.rollupMode): a malformed/legacy
// rollup hint must resolve the SAME way the backend executes it, so the editor
// never DISPLAYS "Auto" for a panel the backend actually runs with rollups off.

// isLegacyRollupOff mirrors the backend optBool decode for the legacy `rollup`
// hint: boolean false, or the stringified 'off'/'false' (case-insensitive — old
// panels persisted the hint as a string), means rollups were turned off. Other
// values (true, undefined, 'on', garbage) are NOT off. Kept narrow to the two
// "off" string forms the bug describes; the backend additionally maps '0'/'no'
// but those were never written by this editor.
export function isLegacyRollupOff(rollup: unknown): boolean {
  if (rollup === false) {
    return true;
  }
  if (typeof rollup === 'string') {
    const v = rollup.trim().toLowerCase();
    return v === 'off' || v === 'false';
  }
  return false;
}

// effectiveRollupMode resolves the selector value, migrating the legacy `rollup`
// field for queries saved before the 3-way selector. The new rollupMode field
// wins when present; otherwise a legacy `rollup` that decodes to off → 'off';
// anything else → 'auto'.
export function effectiveRollupMode(q: ArcQuery): 'auto' | 'only' | 'off' {
  if (q.rollupMode === 'auto' || q.rollupMode === 'only' || q.rollupMode === 'off') {
    return q.rollupMode;
  }
  return isLegacyRollupOff(q.rollup) ? 'off' : 'auto';
}
