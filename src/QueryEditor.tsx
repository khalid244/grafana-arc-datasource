import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { CodeEditor, InlineField, Input, RadioButtonGroup, Select } from '@grafana/ui';
import { ArcDataSource } from './datasource';
import { ArcDataSourceOptions, ArcQuery } from './types';

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

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<Array<{ name: string; type: string }>>([]);
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

  // Count non-default options so the Options button can display a badge
  // when the user has changed something — visible without expanding.
  const format = query.format || 'time_series';
  const split = query.splitDuration || 'auto';
  const db = query.database || '';
  const dirtyCount =
    (format !== 'time_series' ? 1 : 0) +
    (split !== 'auto' ? 1 : 0) +
    (db !== '' ? 1 : 0);

  return (
    <div className="gf-form-group">
      {/* Top row: Format on the left, Options ▾ button on the right. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <InlineField label="Format" tooltip="Choose how to format the query results">
          <RadioButtonGroup options={FORMAT_OPTIONS} value={format} onChange={onFormatChange} />
        </InlineField>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setOptionsOpen((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: optionsOpen ? 'rgba(255,136,51,0.12)' : 'transparent',
            color: optionsOpen ? '#ff8833' : 'inherit',
            border: `1px solid ${optionsOpen ? '#ff8833' : 'rgba(204, 204, 220, 0.15)'}`,
            borderRadius: 3,
            fontSize: 12,
            cursor: 'pointer',
            userSelect: 'none',
            height: 30,
          }}
          aria-expanded={optionsOpen}
        >
          <span>Options</span>
          {dirtyCount > 0 && (
            <span
              style={{
                background: '#ff8833',
                color: '#fff',
                borderRadius: 9,
                padding: '1px 7px',
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              {dirtyCount}
            </span>
          )}
          <span style={{ fontSize: 10, transform: optionsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
        </button>
      </div>

      {/* Inline expanded panel — shown only when Options toggle is open. */}
      {optionsOpen && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 16px',
            alignItems: 'center',
            padding: '8px 12px',
            marginBottom: 8,
            background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(204, 204, 220, 0.15)',
            borderRadius: 3,
          }}
        >
          <InlineField
            label="Splitting"
            tooltip="Parallel time-range chunking for faster results. Applies to: time-bucketed ($__timeGroup) and raw queries. Auto-skipped for: GROUP BY, DISTINCT, COUNT/SUM/AVG without $__timeGroup, LIMIT, and no $__timeFilter."
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
        </div>
      )}

      <div style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
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
        <div
          onMouseDown={onResizeMouseDown}
          style={{
            height: '6px',
            cursor: 'row-resize',
            background: 'transparent',
            borderBottom: '2px solid rgba(128, 128, 128, 0.3)',
            marginBottom: '4px',
          }}
        />
        <div style={{ fontSize: '12px', color: '#6e6e6e' }}>
          <div style={{ marginBottom: '4px' }}>
            <strong>Macros:</strong> $__timeFilter(column), $__timeFrom(), $__timeTo(), $__interval, $__timeGroup(column, interval) &mdash; <strong>Cmd/Ctrl+Enter</strong> to run
          </div>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '11px', color: '#888' }}>
            Example: SELECT $__timeGroup(time, &apos;$__interval&apos;) AS time, host, AVG(value) FROM metrics WHERE $__timeFilter(time) GROUP BY 1, host ORDER BY 1
          </div>
        </div>
      </div>
    </div>
  );
}
