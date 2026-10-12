import { of } from 'rxjs';
import { ArcDataSource } from './datasource';

const mockPost = jest.fn().mockResolvedValue({ supported: true, cube: 'by_event' });
const mockReplace = jest.fn((sql: string) => sql);
const mockQuery = jest.fn((_req: any) => of({ data: [] }));

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ post: mockPost, get: jest.fn() }),
  getTemplateSrv: () => ({ replace: mockReplace }),
  frameToMetricFindValue: jest.fn(),
  DataSourceWithBackend: class {
    uid = 'test-uid';
    query(req: any) {
      return mockQuery(req);
    }
  },
}));

describe('metricFindQuery', () => {
  const ds = new ArcDataSource({} as any);

  beforeEach(() => mockQuery.mockClear());

  it('forwards the variable query rollupMode so a dropdown can run cube-only', async () => {
    await ds.metricFindQuery({ sql: 'SELECT 1', rollupMode: 'only' }, { range: {} });
    expect(mockQuery.mock.calls[0][0].targets[0].rollupMode).toBe('only');
  });

  it('leaves rollupMode unset (auto) when the variable query does not set it', async () => {
    await ds.metricFindQuery({ sql: 'SELECT 1' });
    expect(mockQuery.mock.calls[0][0].targets[0]).not.toHaveProperty('rollupMode');
  });

  it('leaves rollupMode unset (auto) for a plain string query', async () => {
    await ds.metricFindQuery('SELECT 1');
    expect(mockQuery.mock.calls[0][0].targets[0]).not.toHaveProperty('rollupMode');
  });
});

describe('explainRollup', () => {
  const ds = new ArcDataSource({} as any);

  beforeEach(() => {
    mockPost.mockClear();
    mockReplace.mockClear();
  });

  it('includes intervalMs in the POST body when provided', async () => {
    const res = await ds.explainRollup('SELECT 1 FROM m GROUP BY $__interval', 1000, 2000, 1800000);
    expect(res).toEqual({ supported: true, cube: 'by_event' });
    expect(mockPost).toHaveBeenCalledWith('/api/datasources/uid/test-uid/resources/rollup-explain', {
      sql: 'SELECT 1 FROM m GROUP BY $__interval',
      from: 1000,
      to: 2000,
      intervalMs: 1800000,
    });
  });

  it('omits intervalMs when absent', async () => {
    await ds.explainRollup('SELECT 1', 1000, 2000);
    expect(mockPost).toHaveBeenCalledWith('/api/datasources/uid/test-uid/resources/rollup-explain', {
      sql: 'SELECT 1',
      from: 1000,
      to: 2000,
    });
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('intervalMs');
  });

  it('omits intervalMs when non-positive', async () => {
    await ds.explainRollup('SELECT 1', 1000, 2000, 0);
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('intervalMs');
  });

  it('does not pretend to resolve $__interval client-side (scopedVars=undefined)', async () => {
    await ds.explainRollup('GROUP BY $__interval', 1000, 2000, 60000);
    // The literal macro is forwarded; substitution happens server-side from intervalMs.
    expect(mockReplace).toHaveBeenCalledWith('GROUP BY $__interval', undefined, expect.any(Function));
    expect(mockPost.mock.calls[0][1].sql).toBe('GROUP BY $__interval');
  });
});

describe('interpolateVariable', () => {
  const ds = new ArcDataSource({} as any);

  it('renders an empty multi-value selection as NULL so IN (...) stays valid SQL', () => {
    expect(ds.interpolateVariable([], { multi: true, includeAll: true } as any)).toBe('NULL');
  });

  it('still quotes and joins non-empty selections', () => {
    expect(ds.interpolateVariable(["a", "it's"], { multi: true } as any)).toBe("'a','it''s'");
  });
});

describe('toMetricFindValue', () => {
  const ds = new ArcDataSource({} as any);

  it('throws when the variable query returned errors instead of yielding zero options', () => {
    expect(() => ds.toMetricFindValue({ data: [], errors: [{ message: 'Arc error (HTTP 500)' }] } as any)).toThrow(
      'Arc error (HTTP 500)'
    );
  });

  it('throws on the legacy single error field', () => {
    expect(() => ds.toMetricFindValue({ data: [], error: { message: 'boom' } } as any)).toThrow('boom');
  });

  it('returns an empty list for a successful empty result', () => {
    expect(ds.toMetricFindValue({ data: [] } as any)).toEqual([]);
  });
});
