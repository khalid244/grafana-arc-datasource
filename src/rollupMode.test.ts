import { effectiveRollupMode, isLegacyRollupOff } from './rollupMode';
import { ArcQuery } from './types';

// q builds a minimal ArcQuery for decoding tests; `rollup`/`rollupMode` are cast
// loosely because legacy persisted panels stored shapes the current type forbids
// (e.g. rollup as a string), which is exactly what the tolerant decode must handle.
function q(fields: Partial<Record<'rollup' | 'rollupMode', unknown>>): ArcQuery {
  return { refId: 'A', sql: 'SELECT 1', ...(fields as any) } as ArcQuery;
}

describe('isLegacyRollupOff (mirrors backend optBool decode)', () => {
  it('boolean false → off', () => {
    expect(isLegacyRollupOff(false)).toBe(true);
  });

  it.each(['off', 'false', 'OFF', 'False', '  off  '])('string %p → off', (v) => {
    expect(isLegacyRollupOff(v)).toBe(true);
  });

  it.each([true, undefined, null, 'on', 'true', 'auto', 'garbage', 0, 1, {}])(
    'non-off value %p → not off',
    (v) => {
      expect(isLegacyRollupOff(v)).toBe(false);
    }
  );
});

describe('effectiveRollupMode', () => {
  it('rollupMode field wins when present', () => {
    expect(effectiveRollupMode(q({ rollupMode: 'only', rollup: false }))).toBe('only');
    expect(effectiveRollupMode(q({ rollupMode: 'off' }))).toBe('off');
    expect(effectiveRollupMode(q({ rollupMode: 'auto', rollup: false }))).toBe('auto');
  });

  it('legacy boolean rollup:false → off', () => {
    expect(effectiveRollupMode(q({ rollup: false }))).toBe('off');
  });

  it('legacy string rollup:"off" → off (the bug)', () => {
    expect(effectiveRollupMode(q({ rollup: 'off' }))).toBe('off');
  });

  it('legacy string rollup:"false" → off', () => {
    expect(effectiveRollupMode(q({ rollup: 'false' }))).toBe('off');
  });

  it('rollup:true / undefined / unrelated string → auto', () => {
    expect(effectiveRollupMode(q({ rollup: true }))).toBe('auto');
    expect(effectiveRollupMode(q({}))).toBe('auto');
    expect(effectiveRollupMode(q({ rollup: 'on' }))).toBe('auto');
  });
});
