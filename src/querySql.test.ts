import { querySql, withSql } from './querySql';

describe('querySql', () => {
  it('reads sql when present', () => {
    expect(querySql({ sql: 'SELECT 1' })).toBe('SELECT 1');
  });

  it('falls back to rawSql for panels migrated from SQL datasources', () => {
    expect(querySql({ rawSql: 'SELECT 2' })).toBe('SELECT 2');
    expect(querySql({ sql: '', rawSql: 'SELECT 2' })).toBe('SELECT 2');
  });

  it('prefers sql over rawSql, matching the backend', () => {
    expect(querySql({ sql: 'SELECT 1', rawSql: 'SELECT 2' })).toBe('SELECT 1');
  });

  it('returns an empty string when neither is set', () => {
    expect(querySql({})).toBe('');
  });
});

describe('withSql', () => {
  it('writes sql, clears rawSql and keeps the other fields', () => {
    const q = { refId: 'A', sql: '', rawSql: 'SELECT old', database: 'posthog', rollupMode: 'only' as const };
    expect(withSql(q, 'SELECT new')).toEqual({
      refId: 'A',
      sql: 'SELECT new',
      rawSql: undefined,
      database: 'posthog',
      rollupMode: 'only',
    });
  });
});

