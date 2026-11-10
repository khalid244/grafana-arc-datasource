import { DataQuery, DataSourceJsonData } from '@grafana/data';

/**
 * Arc datasource configuration options
 */
export interface ArcDataSourceOptions extends DataSourceJsonData {
  url?: string;
  database?: string;
  timeout?: number;
  useArrow?: boolean;
  maxConcurrency?: number;
  tailFallback?: boolean; // ask Arc to return cube-only data when today's raw tail is too slow (auto rollup mode only)
  tailDeadlineMs?: number; // tail read budget before Arc degrades to cube-only
}

/**
 * Secure configuration (API key stored encrypted)
 */
export interface ArcSecureJsonData {
  apiKey?: string;
}

/**
 * Arc query model
 */
export interface ArcQuery extends DataQuery {
  sql: string;
  format?: 'time_series' | 'table';
  rawQuery?: boolean;
  rawSql?: string; // Postgres/MySQL/MSSQL/ClickHouse compatibility
  splitDuration?: string; // "off", "1h", "6h", "12h", "1d", "3d", "7d"
  database?: string; // Per-query database override (empty = use datasource default)
  rollup?: boolean; // LEGACY (pre-rollupMode): undefined/true = auto, false = off. Migrated to rollupMode.
  rollupMode?: 'auto' | 'only' | 'off'; // auto = cube when covered else source; only = strict cube (error if uncovered); off = force source
}

/**
 * Default values
 */
export const defaultQuery: Partial<ArcQuery> = {
  sql: 'SELECT * FROM cpu WHERE $__timeFilter(time) LIMIT 100',
  format: 'time_series',
  rawQuery: true,
};
