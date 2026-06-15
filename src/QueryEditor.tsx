import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, LoadingState, QueryEditorProps, SelectableValue } from '@grafana/data';
import { CodeEditor, Collapse, Icon, InlineField, Input, RadioButtonGroup, Select, Tooltip, useStyles2 } from '@grafana/ui';
import { ArcDataSource } from './datasource';
import { ArcDataSourceOptions, ArcQuery } from './types';
import { effectiveRollupMode } from './rollupMode';
import { rollupStatusProps, type RollupStatusProps } from './rollupStatus';

type Props = QueryEditorProps<ArcDataSource, ArcQuery, ArcDataSourceOptions>;

const FORMAT_OPTIONS = [
  { label: 'Time series', value: 'time_series' },
  { label: 'Table', value: 'table' },
];

const SPLIT_OPTIONS = [
  { label: 'Auto', value: 'auto' },
  { label: 'Off', value: 'off' },
  { label: '1 hour', value: '1h' },
  { label: '6 hours', value: '6h' },
  { label: '12 hours', value: '12h' },
  { label: '1 day', value: '1d' },
  { label: '3 days', value: '3d' },
  { label: '7 days', value: '7d' },
];

const ROLLUP_OPTIONS: Array<SelectableValue<'auto' | 'only' | 'off'>> = [
  { label: 'Auto', value: 'auto' },
  { label: 'Rollup only', value: 'only' },
  { label: 'Off', value: 'off' },
];

// effectiveRollupMode / isLegacyRollupOff mirror the backend's tolerant decoding
// (pkg/plugin/datasource.go optBool + ArcQuery.rollupMode) so a legacy panel saved
// with rollup: "off" (string) DISPLAYS "Off" instead of "Auto". Kept in a pure
// module (no Grafana UI imports) so they can be unit-tested standalone.
// (imported above from ./rollupMode)

const MIN_EDITOR_HEIGHT = 100;
const MAX_EDITOR_HEIGHT = 600;
const DEFAULT_EDITOR_HEIGHT = 200;

// Use string values directly to avoid runtime dependency on CodeEditorSuggestionItemKind enum
// which may not be exported in all Grafana versions
const MACRO_SUGGESTIONS: any[] = [
  { label: '$__timeFilter', kind: 'method', insertText: '$__timeFilter(time)', detail: 'Time range filter' },
  { label: '$__timeGroup', kind: 'method', insertText: "$__timeGroup(time, '$__interval')", detail: 'Time bucket' },
  { label: '$__timeFrom', kind: 'method', insertText: '$__timeFrom()', detail: 'Start of time range' },
  { label: '$__timeTo', kind: 'method', insertText: '$__timeTo()', detail: 'End of time range' },
  { label: '$__interval', kind: 'text', detail: 'Auto interval' },
];

// labelFor returns the human label for a Select option value, falling back
// to the raw value when no match. Used by the Options summary line.
function labelFor<T extends string | undefined>(opts: Array<SelectableValue<T>>, val: T): string {
  const m = opts.find((o) => o.value === val);
  return m?.label ?? String(val ?? '');
}

// RollupStatus is the unified status chip for both the pre-run prediction
// ("will this query roll up?") and the post-run provenance ("was it served from a
// cube?"). One coherent pill across all five states: a tinted leading icon, a terse
// label, an optional faded "(cte)" marker, and provenance detail in the tooltip.
// The state-selection logic + helpers live in ./rollupStatus (pure, unit-tested).
function RollupStatus({ tone, icon, spin, label, cube, isCte, detail, tooltip }: RollupStatusProps) {
  const styles = useStyles2(getRollupStatusStyles);
  const chip = (
    <span className={`${styles.chip} ${styles[tone]}`}>
      <Icon name={icon} size="sm" className={spin ? styles.spin : undefined} />
      <span className={styles.label}>{label}</span>
      {cube != null && <span className={styles.cube}>{cube}</span>}
      {isCte && <span className={styles.cte}>cte</span>}
      {detail != null && <span className={styles.detail}>{detail}</span>}
    </span>
  );
  return tooltip ? (
    <Tooltip content={<>{tooltip}</>} placement="top">
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

const getRollupStatusStyles = (theme: GrafanaTheme2) => ({
  // Full-width left-accent banner (Alert/selection-bar style): a 3px colored
  // left border + a uniform faint surface tint, carrying the tone color only on
  // the left bar and the text. Not a pill — `display: flex` so it spans the
  // editor width, with no all-around border.
  chip: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    marginTop: theme.spacing(0.75),
    marginBottom: theme.spacing(1.5),
    padding: theme.spacing(0.75, 1.25),
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    borderLeft: '3px solid',
    background: theme.colors.background.secondary,
    flexWrap: 'wrap',
    cursor: 'default',
  }),
  // Tone classes set only the left-accent color and the tinted text; the faint
  // background tint is uniform across all states (set on `chip`).
  success: css({
    color: theme.colors.success.text,
    borderLeftColor: theme.colors.success.text,
  }),
  warning: css({
    color: theme.colors.warning.text,
    borderLeftColor: theme.colors.warning.text,
  }),
  neutral: css({
    color: theme.colors.text.secondary,
    borderLeftColor: theme.colors.text.secondary,
  }),
  muted: css({
    color: theme.colors.text.secondary,
    borderLeftColor: theme.colors.text.secondary,
  }),
  label: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  // The terse cube kind, set apart from the label with the muted code font.
  cube: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    color: theme.colors.text.primary,
  }),
  // The "(cte)" rewrite marker, demoted to a faded uppercase micro-tag.
  cte: css({
    fontSize: '10px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: theme.colors.text.disabled,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0, 0.5),
    lineHeight: 1.4,
  }),
  // Detail (e.g. the execution time), separated by a thin divider. Inherits the
  // chip's tone colour so the time matches the rest of the banner — green when
  // rolled up, neutral for source, amber next to a "won't roll up" reason.
  detail: css({
    color: 'inherit',
    paddingLeft: theme.spacing(0.75),
    marginLeft: theme.spacing(0.25),
    borderLeft: `1px solid ${theme.colors.border.weak}`,
  }),
  spin: css({
    animation: 'rollup-status-spin 1s linear infinite',
    '@keyframes rollup-status-spin': {
      from: { transform: 'rotate(0deg)' },
      to: { transform: 'rotate(360deg)' },
    },
  }),
});

// getStyles is the theme-tokened sibling of getRollupStatusStyles for the rest of
// the render. Every value maps 1:1 to what the previous hardcoded inline styles
// resolved to in the default (dark) theme, so the editor is pixel-identical but
// now auto-adapts to light/dark and rides the spacing grid (8px = spacing(1)).
const getStyles = (theme: GrafanaTheme2) => ({
  // Format row above the SQL editor — a plain block (matches legacy); the single
  // InlineField carries its own inline layout, so no flex/gap wrapper is needed.
  formatRow: css({
    marginBottom: theme.spacing(1),
  }),
  // Column wrapper around the editor + indicator + options. NOTE: intentionally
  // NO `display: flex` here (matches the original) — adding it would reflow.
  column: css({
    flexDirection: 'column',
    alignItems: 'flex-start',
  }),
  // Drag handle below the editor for vertical resize.
  resizeHandle: css({
    height: theme.spacing(0.5),
    cursor: 'row-resize',
    background: 'transparent',
  }),
  // Collapse header: "Options" label + inline summary when collapsed.
  collapseLabel: css({
    display: 'inline-flex',
    gap: theme.spacing(2),
    alignItems: 'center',
  }),
  optionsLabel: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  // The muted collapsed summary (Splitting/Database/Rollups).
  summary: css({
    display: 'inline-flex',
    gap: theme.spacing(2),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontWeight: 'normal',
  }),
  // The current value inside each summary item.
  summaryValue: css({
    color: theme.colors.text.primary,
  }),
  // Expanded Options body row holding the three InlineFields.
  optionsBody: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5, 2),
    alignItems: 'center',
    paddingTop: theme.spacing(0.5),
  }),
  // Macros footer block under the Options collapse.
  macros: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(1),
  }),
  macrosHelp: css({
    marginBottom: theme.spacing(0.5),
  }),
  // The dim monospace example query line.
  macrosExample: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.disabled,
  }),
});

export function QueryEditor({ query, onChange, onRunQuery, datasource, data, range }: Props) {
  const styles = useStyles2(getStyles);
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<Array<{ name: string; type: string }>>([]);
  // Pre-run rollup check: "will this query be served from a cube?" — computed
  // server-side (the real router) and refreshed as the SQL or time range changes.
  const [rollupCheck, setRollupCheck] = useState<{ supported: boolean; cube?: string; reason?: string } | null>(null);
  const [rollupChecking, setRollupChecking] = useState(false);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // CodeEditor captures callbacks on mount and never re-binds them. Read the
  // latest query through a ref so edits don't clobber sibling fields (database,
  // splitDuration, format) with stale values.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // Migrate rawSql from Postgres/MySQL/MSSQL/ClickHouse datasources
  useEffect(() => {
    if (!query.sql && query.rawSql) {
      onChange({ ...query, sql: query.rawSql, rawSql: undefined });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch tables for autocomplete
  useEffect(() => {
    datasource.getTables(query.database).then(setTables).catch(() => {});
  }, [datasource, query.database]);

  // Fetch columns when SQL references a table
  useEffect(() => {
    const match = query.sql?.match(/\bFROM\s+(?:(\w+)\.)?(\w+)/i);
    if (match) {
      const table = match[2];
      const db = match[1] || query.database;
      datasource.getColumns(table, db).then(setColumns).catch(() => {});
    }
  }, [datasource, query.sql, query.database]);

  // Pre-run rollup check, debounced. Uses the panel's current time range because
  // the answer is range-dependent ($__interval picks the bucket grain). Disabled
  // when the rollup toggle is off (the query will deliberately hit source).
  const fromMs = range?.from?.valueOf?.() ?? data?.timeRange?.from?.valueOf?.();
  const toMs = range?.to?.valueOf?.() ?? data?.timeRange?.to?.valueOf?.();
  // Grafana's actual computed bucket interval for the panel (ms) — the definitive
  // grain the query runs at, independent of how $__interval resolves in the editor.
  const intervalMs = data?.request?.intervalMs;
  useEffect(() => {
    const sql = query.sql;
    // Use the same tolerant decoding as the displayed mode so a legacy panel saved
    // with rollup: "off" (string) skips the explain call too — not just the strict
    // boolean false. When off, the query deliberately hits source, so there's
    // nothing to predict. Decode only the two fields this effect depends on (kept in
    // the dependency array below) so the explain doesn't re-fire on unrelated edits.
    const rollupOff =
      effectiveRollupMode({ rollup: query.rollup, rollupMode: query.rollupMode } as ArcQuery) === 'off';
    if (!sql || !sql.trim() || rollupOff || fromMs == null || toMs == null) {
      setRollupCheck(null);
      return;
    }
    // Rollup cubes are HOURLY: a sub-hour bucket can never be served. Short-circuit
    // to a clear warning using the real interval, so the badge never shows "Will roll
    // up" at <1h (the server's $__interval fallback could otherwise predict 1h).
    const timeBucketed = /\$__interval|\$__timeGroup/i.test(sql);
    if (timeBucketed && intervalMs != null && intervalMs > 0 && intervalMs < 3600000) {
      setRollupChecking(false);
      setRollupCheck({
        supported: false,
        reason: 'time bucket is under 1h — rollup cubes are hourly; widen the range or set the panel Min interval to ≥ 1h',
      });
      return;
    }
    setRollupChecking(true);
    const t = setTimeout(() => {
      // Forward the panel's real interval so the backend expands $__interval to
      // the bucket grain the query will actually run at (getTemplateSrv().replace
      // cannot resolve $__interval outside a real panel query).
      datasource
        .explainRollup(sql, fromMs, toMs, intervalMs != null && intervalMs > 0 ? intervalMs : undefined)
        .then(setRollupCheck)
        .catch(() => setRollupCheck(null))
        .finally(() => setRollupChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [datasource, query.sql, query.rollup, query.rollupMode, query.database, fromMs, toMs, intervalMs]);

  const onSQLEdit = useCallback((value: string) => {
    onChange({ ...queryRef.current, sql: value });
  }, [onChange]);

  // onChange queues a React state update; onRunQuery runs synchronously and
  // would read the stale query if invoked in the same tick. Defer the run
  // so the state update propagates first — without this, blurring the
  // editor after typing executes the previous SQL.
  const runAfterChange = useCallback(() => {
    queueMicrotask(onRunQuery);
  }, [onRunQuery]);

  const onSQLBlur = useCallback((value: string) => {
    onChange({ ...queryRef.current, sql: value });
    runAfterChange();
  }, [onChange, runAfterChange]);

  const onRunQueryFromEditor = useCallback((value: string) => {
    onChange({ ...queryRef.current, sql: value });
    runAfterChange();
  }, [onChange, runAfterChange]);

  const onFormatChange = (value: string) => {
    onChange({ ...query, format: value as 'time_series' | 'table' });
    runAfterChange();
  };

  const onSplitChange = (option: SelectableValue<string>) => {
    onChange({ ...query, splitDuration: option?.value || 'auto' });
    runAfterChange();
  };

  const onRollupModeChange = (option: SelectableValue<'auto' | 'only' | 'off'>) => {
    const mode = option?.value || 'auto';
    // Write rollupMode and clear the legacy boolean so the two never disagree.
    onChange({ ...query, rollupMode: mode, rollup: undefined });
    onRunQuery();
  };

  const onDatabaseChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, database: event.target.value });
  };

  const onDatabaseBlur = () => {
    runAfterChange();
  };

  const onEditorDidMount = useCallback((editor: any, monaco: any) => {
    editor.addAction({
      id: 'run-query',
      label: 'Run Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const value = editor.getValue();
        onChange({ ...queryRef.current, sql: value });
        runAfterChange();
      },
    });
  }, [onChange, runAfterChange]);

  const getSuggestions = useCallback(() => [
    ...MACRO_SUGGESTIONS,
    ...tables.map((t) => ({ label: t, kind: 'field', detail: 'Table' })),
    ...columns.map((c) => ({ label: c.name, kind: 'property', detail: c.type })),
  ], [tables, columns]);

  // Resize handle
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startHeight: editorHeight };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) {
        return;
      }
      const delta = moveEvent.clientY - resizeRef.current.startY;
      const newHeight = Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, resizeRef.current.startHeight + delta));
      setEditorHeight(newHeight);
    };

    const onMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [editorHeight]);

  const format = query.format || 'time_series';
  const split = query.splitDuration || 'auto';
  const db = query.database || '';
  // rollup defaults to on — only an explicit `false` disables it.
  const rollupMode = effectiveRollupMode(query);

  // Provenance from the last executed query. `meta` describes the LAST run only.
  const meta: any = data?.series?.[0]?.meta?.custom;

  // Staleness signal: compare the executed query's sql to the current editor sql.
  // Grafana's DataSourceWithBackend keeps the ORIGINAL (uninterpolated) targets on
  // request.targets and only runs applyTemplateVariables on the copy sent to the
  // backend — so target.sql here is the raw editor sql, directly comparable to
  // query.sql (both pre-interpolation).
  const executedTarget = data?.request?.targets?.find((t) => t.refId === query.refId) as
    | { sql?: string }
    | undefined;
  const currentSql = (query.sql ?? '').trim();

  // A result is "fresh now" only when the run is Done AND its SQL still matches the
  // editor. But clicking out of the editor RE-RUNS the same query, and during the
  // Loading phase there's no Done result — which would blink the provenance chip back
  // to "Source · —" and then to the result again. To avoid that flash, remember the
  // last fresh result and keep showing it while the SAME SQL reloads; only an actual
  // SQL edit drops us to the "—" baseline (a genuinely different query).
  const freshNow =
    data?.state === LoadingState.Done && meta != null && (executedTarget?.sql ?? '').trim() === currentSql;
  // Remember the last fresh result so a re-run of the SAME query (clicking out of the
  // editor ALWAYS re-runs) keeps showing the result through the Loading phase instead
  // of blinking to "Source · —" and back. Updated synchronously during render (an
  // idempotent cache write — no effect lag); only an actual SQL edit (sql no longer
  // matches) drops us back to the "—" baseline.
  const lastResultRef = useRef<{ sql: string; meta: any } | null>(null);
  if (freshNow) {
    lastResultRef.current = { sql: currentSql, meta };
  }
  const heldMeta =
    lastResultRef.current && lastResultRef.current.sql === currentSql ? lastResultRef.current.meta : null;
  // Show the live result when fresh, else the held result for the same SQL (reload),
  // else nothing (SQL changed → "Source · —").
  const effectiveMeta = freshNow ? meta : heldMeta;
  const resultFresh = effectiveMeta != null;

  // One lifecycle-aware indicator: result when fresh, else prediction/checking.
  // In Off mode we suppress the pre-run prediction/checking (rolling up isn't an
  // option), but STILL surface the post-run result — so a query run with rollups
  // off shows "Source · <time>" rather than no provenance at all.
  const rollupOff = rollupMode === 'off';
  // An ORDERED list of chips. The last is a PERSISTENT provenance chip (always
  // present, defaults to "Source · —") that upgrades in place to "Source · <time>"
  // or "Rolled up · cube · <time>" once a result lands. A source scan predicted not
  // to roll up also gets the amber "Won't roll up · why" warning above it. In Off
  // mode the prediction is suppressed (rollupCheck null) so only the Source
  // provenance chip shows. See rollupStatusProps.
  const statusChips = rollupStatusProps({
    resultFresh,
    meta: effectiveMeta,
    rollupCheck: rollupOff ? null : rollupCheck,
    rollupChecking: rollupOff ? false : rollupChecking,
  });
  // Only describe a query that actually has SQL — an empty editor shows no chip.
  const showStatus = !!query.sql && query.sql.trim().length > 0;

  return (
    <div className="gf-form-group">
      {/* Format on top — kept close to the SQL. Rollup toggle now lives in Options. */}
      <div className={styles.formatRow}>
        <InlineField label="Format" tooltip="Choose how to format the query results">
          <RadioButtonGroup options={FORMAT_OPTIONS} value={format} onChange={onFormatChange} />
        </InlineField>
      </div>

      <div className={styles.column}>
        <CodeEditor
          language="sql"
          value={query.sql || ''}
          onChange={onSQLEdit}
          onBlur={onSQLBlur}
          onSave={onRunQueryFromEditor}
          onEditorDidMount={onEditorDidMount}
          height={`${editorHeight}px`}
          showMiniMap={false}
          showLineNumbers={true}
          getSuggestions={getSuggestions}
          monacoOptions={{ wordWrap: 'on', scrollBeyondLastLine: false }}
        />
        <div onMouseDown={onResizeMouseDown} className={styles.resizeHandle} />

        {/* Rollup indicator(s). A PERSISTENT provenance chip is always shown for a
            non-empty query: "▤ Source · —" before running, morphing IN PLACE to
            "▤ Source · 12 ms" or "⚡ Rolled up · cube · 12 ms" once a result lands —
            so it never appears/disappears, just updates. When the query is predicted
            not to roll up, an amber "⚠ Won't roll up · why" warning sits above it
            (kept across the run). See rollupStatusProps. */}
        {showStatus &&
          statusChips.map((p) => <RollupStatus key={p.id} {...p} />)}

        {/* Options — Loki-style Collapse directly under the query, above the
            Macros help. Plain panel colors, inline summary of current values
            when collapsed, full-width expanded. Pattern lifted from Grafana's
            own Prometheus/Loki QueryOptionGroup. */}
        <Collapse
          collapsible
          isOpen={optionsOpen}
          onToggle={setOptionsOpen}
          label={
            <span className={styles.collapseLabel}>
              <span className={styles.optionsLabel}>Options</span>
              {!optionsOpen && (
                <span className={styles.summary}>
                  <span>Splitting: <span className={styles.summaryValue}>{labelFor(SPLIT_OPTIONS, split)}</span></span>
                  <span>Database: <span className={styles.summaryValue}>{db || 'default'}</span></span>
                  <span>Rollups: <span className={styles.summaryValue}>{labelFor(ROLLUP_OPTIONS, rollupMode)}</span></span>
                </span>
              )}
            </span>
          }
        >
          <div className={styles.optionsBody}>
            <InlineField
              label="Splitting"
              tooltip="Parallel time-range chunking for faster results. Applies to time-bucketed ($__timeGroup) and raw queries. Auto-skipped for: GROUP BY, DISTINCT, COUNT/SUM/AVG without $__timeGroup, LIMIT, and no $__timeFilter."
            >
              <Select options={SPLIT_OPTIONS} value={split} onChange={onSplitChange} width={16} />
            </InlineField>
            <InlineField
              label="Database"
              tooltip="Override the default database for this query. Leave empty to use the datasource default."
            >
              <Input
                value={query.database || ''}
                onChange={onDatabaseChange}
                onBlur={onDatabaseBlur}
                placeholder="default"
                width={16}
              />
            </InlineField>
            <InlineField
              label="Rollups"
              tooltip="Auto — serve from a pre-aggregated rollup cube when one covers the query, otherwise run against source. Rollup only — force the cube; errors if no cube covers the query. Off — always a full source scan, never use cubes."
            >
              <Select
                options={ROLLUP_OPTIONS}
                value={rollupMode}
                onChange={onRollupModeChange}
                width={18}
              />
            </InlineField>
          </div>
        </Collapse>

        <div className={styles.macros}>
          <div className={styles.macrosHelp}>
            <strong>Macros:</strong> $__timeFilter(column), $__timeFrom(), $__timeTo(), $__interval, $__timeGroup(column, interval) &mdash; <strong>Cmd/Ctrl+Enter</strong> to run
          </div>
          <div className={styles.macrosExample}>
            Example: SELECT $__timeGroup(time, &apos;$__interval&apos;) AS time, host, AVG(value) FROM metrics WHERE $__timeFilter(time) GROUP BY 1, host ORDER BY 1
          </div>
        </div>
      </div>
    </div>
  );
}
