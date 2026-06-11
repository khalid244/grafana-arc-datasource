import {
  DataQueryResponse,
  MetricFindValue,
  DataSourceInstanceSettings,
  CoreApp,
  ScopedVars,
  VariableWithMultiSupport,
} from '@grafana/data';
import { frameToMetricFindValue, DataSourceWithBackend, getTemplateSrv, getBackendSrv } from '@grafana/runtime';
import { ArcQuery, ArcDataSourceOptions, defaultQuery } from './types';
import { lastValueFrom } from 'rxjs';

/**
 * Arc DataSource - extends DataSourceWithBackend to automatically handle
 * all backend communication and frame parsing
 */
export class ArcDataSource extends DataSourceWithBackend<ArcQuery, ArcDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<ArcDataSourceOptions>) {
    super(instanceSettings);
  }

  /**
   * Query for template variables
   */
  async metricFindQuery(query: any, options?: any): Promise<MetricFindValue[]> {
    // Handle both string SQL and query object
    let sqlQuery: string;

    if (typeof query === 'string') {
      // Simple string query
      sqlQuery = query;
    } else if (query && typeof query === 'object') {
      // Query object - extract SQL from various possible field names
      sqlQuery = query.sql || query.query || query.rawSql || '';

      // Log to help debug
      if (!sqlQuery) {
        console.warn('metricFindQuery received object without sql:', query);
      }
    } else {
      sqlQuery = '';
    }

    const target: ArcQuery = {
      refId: 'metricFindQuery',
      sql: sqlQuery,
      format: 'table',
      rawQuery: true,
    };

    return lastValueFrom(
      super.query({
        ...(options ?? {}), // includes 'range'
        targets: [target],
      })
    ).then(this.toMetricFindValue);
  }

  toMetricFindValue(rsp: DataQueryResponse): MetricFindValue[] {
    const data = rsp.data ?? [];
    // Create MetricFindValue object for all frames
    const values = data.map((d) => frameToMetricFindValue(d)).flat();
    // Filter out duplicate elements
    return values.filter((elm, idx, self) => idx === self.findIndex((t) => t.text === elm.text));
  }

  getDefaultQuery(_: CoreApp): Partial<ArcQuery> {
    return defaultQuery;
  }

  quoteLiteral(value: string) {
    return "'" + value.replace(/'/g, "''") + "'";
  }

  interpolateVariable = (value: string | string[] | number, variable: VariableWithMultiSupport) => {
    if (typeof value === 'string') {
      if (variable?.multi || variable?.includeAll) {
        return this.quoteLiteral(value);
      } else {
        return String(value).replace(/'/g, "''");
      }
    }

    if (typeof value === 'number') {
      return value;
    }

    if (Array.isArray(value)) {
      const quotedValues = value.map((v) => this.quoteLiteral(v));
      return quotedValues.join(',');
    }

    return value;
  };

  applyTemplateVariables(query: ArcQuery, scopedVars: ScopedVars): ArcQuery {
    return {
      ...query,
      sql: getTemplateSrv().replace(query.sql, scopedVars, this.interpolateVariable),
    };
  }

  async getTables(database?: string): Promise<string[]> {
    const params = database ? `?database=${encodeURIComponent(database)}` : '';
    try {
      const res = await getBackendSrv().get(`/api/datasources/uid/${this.uid}/resources/tables${params}`);
      return (res || []).map((t: { name: string }) => t.name);
    } catch {
      return [];
    }
  }

  async getColumns(table: string, database?: string): Promise<Array<{ name: string; type: string }>> {
    const params = new URLSearchParams({ table });
    if (database) {
      params.set('database', database);
    }
    try {
      return await getBackendSrv().get(`/api/datasources/uid/${this.uid}/resources/columns?${params.toString()}`);
    } catch {
      return [];
    }
  }

  /**
   * Pre-run check: would this query be served from a rollup cube? Macros are
   * expanded server-side for the given time range and interval (the answer is
   * range- and interval-dependent: $__interval sets the bucket, and Arc's
   * hourly cubes can only serve buckets that are multiples of 1h).
   *
   * intervalMs is the panel's computed interval (request.intervalMs). Pass it
   * whenever available so the backend substitutes the REAL bucket grain for
   * $__interval; when omitted the backend falls back to a coarser
   * range-derived interval.
   */
  async explainRollup(
    sql: string,
    fromMs: number,
    toMs: number,
    intervalMs?: number
  ): Promise<{ supported: boolean; cube?: string; reason?: string }> {
    try {
      // Interpolate dashboard template variables the SAME way a real query does
      // (applyTemplateVariables → getTemplateSrv().replace). NOTE: with
      // scopedVars=undefined this does NOT resolve $__interval — that scoped
      // variable only exists during a real panel query — so $__interval reaches
      // the backend literally and is substituted there from intervalMs (or the
      // backend's range-derived fallback when intervalMs is absent).
      // $__timeFilter/$__timeGroup are arc-specific and pass through untouched
      // for server-side expansion.
      const interpolatedSql = getTemplateSrv().replace(sql, undefined, this.interpolateVariable);
      const body: { sql: string; from: number; to: number; intervalMs?: number } = {
        sql: interpolatedSql,
        from: fromMs,
        to: toMs,
      };
      if (intervalMs != null && intervalMs > 0) {
        body.intervalMs = intervalMs;
      }
      return await getBackendSrv().post(`/api/datasources/uid/${this.uid}/resources/rollup-explain`, body);
    } catch {
      return { supported: false, reason: 'rollup check unavailable' };
    }
  }
}
