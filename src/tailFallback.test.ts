import { TAIL_DEADLINE_DEFAULT_MS, TAIL_FALLBACK_DEFAULT, normalizeTailDeadline } from './tailFallback';

describe('tailFallback defaults', () => {
  it('is off by default with a 10s deadline', () => {
    expect(TAIL_FALLBACK_DEFAULT).toBe(false);
    expect(TAIL_DEADLINE_DEFAULT_MS).toBe(10000);
  });
});

describe('normalizeTailDeadline', () => {
  it.each([undefined, null, 0, -5, NaN, Infinity])('falls back to the default for %p', (v) => {
    expect(normalizeTailDeadline(v as any)).toBe(10000);
  });

  it('keeps a valid value and floors fractions', () => {
    expect(normalizeTailDeadline(7000)).toBe(7000);
    expect(normalizeTailDeadline(1500.9)).toBe(1500);
  });
});
