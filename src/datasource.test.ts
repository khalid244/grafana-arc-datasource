import { ArcDataSource } from './datasource';

const mockPost = jest.fn().mockResolvedValue({ supported: true, cube: 'by_event' });
const mockReplace = jest.fn((sql: string) => sql);

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ post: mockPost, get: jest.fn() }),
  getTemplateSrv: () => ({ replace: mockReplace }),
  frameToMetricFindValue: jest.fn(),
  DataSourceWithBackend: class {
    uid = 'test-uid';
  },
}));

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
