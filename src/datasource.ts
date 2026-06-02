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
   * expanded server-side for the given time range (the answer is range-dependent:
   * a query rolls up at 30d but not at 6h, because $__interval sets the bucket).
   */
  async explainRollup(
    sql: string,
    fromMs: number,
    toMs: number
  ): Promise<{ supported: boolean; cube?: string; reason?: string }> {
    try {
      // Interpolate template variables the SAME way a real query does
      // (applyTemplateVariables → getTemplateSrv().replace). Critically this
      // resolves $__interval to Grafana's panel interval — so the prediction uses
      // the bucket grain the query will ACTUALLY run at. Without this the backend
      // falls back to its own coarser calculateInterval(range) and wrongly predicts
      // "will roll up" for a sub-hour $__interval (e.g. 30m), which the hourly cube
      // can't serve. $__timeFilter/$__timeGroup are arc-specific and pass through
      // untouched for server-side expansion.
      const interpolatedSql = getTemplateSrv().replace(sql, undefined, this.interpolateVariable);
      return await getBackendSrv().post(`/api/datasources/uid/${this.uid}/resources/rollup-explain`, {
        sql: interpolatedSql,
        from: fromMs,
        to: toMs,
      });
    } catch {
      return { supported: false, reason: 'rollup check unavailable' };
    }
  }
}
