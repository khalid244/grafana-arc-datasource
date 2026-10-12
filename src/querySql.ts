import { ArcQuery } from './types';

// Panels store their SQL in one of two fields: native Arc panels use `sql`;
// panels migrated from Postgres/MySQL/MSSQL/ClickHouse use `rawSql` (some carry
// both, identical). The backend runs `sql` and falls back to `rawSql`
// (pkg/plugin/datasource.go), so everything in the frontend reads the same way —
// otherwise a rawSql-only panel shows an empty editor while it still returns data.

// querySql returns the SQL the backend would execute for this query.
export function querySql(q: Partial<Pick<ArcQuery, 'sql' | 'rawSql'>>): string {
  return q.sql || q.rawSql || '';
}

// withSql stores an edit in `sql` and drops `rawSql`, so the two fields can't
// drift apart (a stale `rawSql` would otherwise linger beside the edited `sql`).
export function withSql<T extends Partial<ArcQuery>>(q: T, sql: string): T {
  return { ...q, sql, rawSql: undefined };
}
