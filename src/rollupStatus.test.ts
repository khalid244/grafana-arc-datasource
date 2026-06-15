import { rollupStatusProps, parseCube, fmtMs } from './rollupStatus';

const REASON = 'time bucket is under 1h — rollup cubes are hourly; widen the range or set Min interval ≥ 1h';

describe('rollupStatusProps — persistent provenance chip', () => {
  it('shows a baseline "Source · —" when nothing has run yet', () => {
    const chips = rollupStatusProps({
      resultFresh: false,
      meta: null,
      rollupCheck: null,
      rollupChecking: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Source');
    expect(chips[0].tone).toBe('neutral');
    expect(chips[0].detail).toBe('—');
  });

  it('still shows "Source · —" while the rollup check is in flight (no flicker out)', () => {
    const chips = rollupStatusProps({
      resultFresh: false,
      meta: null,
      rollupCheck: null,
      rollupChecking: true,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Source');
    expect(chips[0].detail).toBe('—');
  });

  it('upgrades the SAME slot to "Source · <time>" on a source result', () => {
    const chips = rollupStatusProps({
      resultFresh: true,
      meta: { servedBy: 'source', executionTime: 12 },
      rollupCheck: null,
      rollupChecking: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Source');
    expect(chips[0].detail).toBe('12 ms');
  });

  it('morphs the provenance chip to "Rolled up · cube · <time>" when served from a cube', () => {
    const chips = rollupStatusProps({
      resultFresh: true,
      meta: { servedBy: 'rollup', rollupCube: 'default.downloads.by_site', executionTime: 8 },
      rollupCheck: null,
      rollupChecking: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Rolled up');
    expect(chips[0].tone).toBe('success');
    expect(chips[0].cube).toBe('by_site');
    expect(chips[0].detail).toBe('8 ms');
  });

  it('reverts to "Source · —" when the result is stale (SQL edited after running)', () => {
    const chips = rollupStatusProps({
      resultFresh: false,
      meta: { servedBy: 'rollup', rollupCube: 'default.downloads.by_site', executionTime: 8 },
      rollupCheck: null,
      rollupChecking: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Source');
    expect(chips[0].detail).toBe('—');
  });
});

describe('rollupStatusProps — amber "Won\'t roll up" warning alongside the provenance chip', () => {
  it('prepends the warning before running: [Won\'t roll up, Source · —]', () => {
    const chips = rollupStatusProps({
      resultFresh: false,
      meta: null,
      rollupCheck: { supported: false, reason: REASON },
      rollupChecking: false,
    });
    expect(chips).toHaveLength(2);
    expect(chips[0].label).toBe("Won't roll up");
    expect(chips[0].tone).toBe('warning');
    expect(chips[0].detail).toBe(REASON);
    expect(chips[1].label).toBe('Source');
    expect(chips[1].detail).toBe('—');
  });

  it('keeps the warning after a source run: [Won\'t roll up, Source · <time>]', () => {
    const chips = rollupStatusProps({
      resultFresh: true,
      meta: { servedBy: 'source', executionTime: 12 },
      rollupCheck: { supported: false, reason: REASON },
      rollupChecking: false,
    });
    expect(chips).toHaveLength(2);
    expect(chips[0].label).toBe("Won't roll up");
    expect(chips[0].detail).toBe(REASON);
    expect(chips[1].label).toBe('Source');
    expect(chips[1].detail).toBe('12 ms');
  });

  it('suppresses the warning when the query actually rolled up (prediction was wrong)', () => {
    const chips = rollupStatusProps({
      resultFresh: true,
      meta: { servedBy: 'rollup', rollupCube: 'default.downloads.coarse', executionTime: 8 },
      rollupCheck: { supported: false, reason: REASON },
      rollupChecking: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Rolled up');
  });

  it('does not warn when the prediction says it WILL roll up (just the Source baseline pre-run)', () => {
    const chips = rollupStatusProps({
      resultFresh: false,
      meta: null,
      rollupCheck: { supported: true, cube: 'default.downloads.by_site' },
      rollupChecking: false,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe('Source');
    expect(chips[0].detail).toBe('—');
  });
});

describe('helpers', () => {
  it('fmtMs humanizes ms / s / nullish', () => {
    expect(fmtMs(12)).toBe('12 ms');
    expect(fmtMs(1500)).toBe('1.50 s');
    expect(fmtMs(12345)).toBe('12.3 s');
    expect(fmtMs(undefined)).toBe('—');
  });

  it('parseCube strips the (cte) marker and collapses dim-rich cubes', () => {
    expect(parseCube('default.downloads.by_site').kind).toBe('by_site');
    expect(parseCube('default.downloads.by_a_b_c_d_e').kind).toBe('dim-rich');
    const cte = parseCube('default.downloads.by_site (cte)');
    expect(cte.isCte).toBe(true);
    expect(cte.full).toBe('default.downloads.by_site');
  });
});
