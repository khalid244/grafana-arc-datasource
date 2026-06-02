# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-06-02

### Added
- Three-way **Rollups** mode selector (Auto / Rollup only / Off), replacing the on/off switch; per-mode detail moved to the field info icon. **Rollup only** forces cube serving and returns an error if no cube covers the query (`X-Arc-Rollup-Only` header); **Off** forces a full source scan (`X-Arc-No-Rollup`); **Auto** uses a cube when one covers, else source.

### Changed
- Redesigned the rollup status indicator into a single lifecycle-aware banner that shows the pre-run prediction (`Will roll up · <cube>`) and upgrades to the post-run result (`Rolled up · <cube> · <time>` / `Source · <time>`), reverting to a prediction the moment the SQL is edited.
- Moved the QueryEditor and Variable query editor off hardcoded colors onto Grafana theme tokens and the spacing grid (now adapts to light/dark themes).
- Polished the datasource config page: labels no longer wrap, toggles are vertically centered, the Arrow-protocol hint moved into its tooltip, numeric inputs can be cleared and re-typed without snapping back, and theme tokens for light/dark — merged and adapted from upstream (`4d80df6`).
- Build: reproducible (`-trimpath`) and smaller binaries, dynamic plugin version read, and parallel cross-platform builds — Magefile from upstream (`18aca96`).

### Fixed
- The pre-run "will roll up" prediction now uses the query's actual `$__interval` (it previously fell back to a coarser server-side interval and over-predicted rollup), and a client-side guard prevents it from claiming a sub-hour query will roll up — the hourly cubes cannot serve buckets finer than 1h.
- The `Source` provenance now shows after running with Rollups set to Off (it was hidden entirely in Off mode).

## [1.2.3] - 2026-05-19

### Fixed
- Fix QueryEditor running the previous SQL when the editor loses focus. `onChange` queued a React state update while `onRunQuery` fired in the same tick, so the parent query state hadn't propagated yet. Deferred the run via `queueMicrotask` across blur, save, Cmd/Ctrl+Enter, and the Format/Splitting/Database controls.

## [1.2.2] - 2026-04-30

### Fixed
- Fix Database/Format/Splitting fields being reset when typing in the SQL editor. Grafana's `CodeEditor` captures its callback props on mount and never re-binds them, so `onChange`/`onBlur`/`onSave` always saw the original `query` from the closure — wiping any sibling field changes made afterward. Read the latest query through a ref instead.

## [1.2.0] - 2026-03-04

### Added
- Monaco SQL editor: replaced plain TextArea with CodeEditor (syntax highlighting, bracket matching, line numbers)
- Keyboard shortcut: Cmd/Ctrl+Enter to run query directly from editor
- Resizable editor: drag bottom edge to resize (100–600px)
- Autocomplete: macro suggestions ($__timeFilter, $__timeGroup, etc.), table names, and column names with types
- Backend schema API: /tables and /columns resource endpoints for autocomplete data
- Variable query editor also upgraded to Monaco

## [1.1.0] - 2026-02-20

### Fixed
- Fix LongToWide null-fill bloat: `FillModeNull` expanded hourly data into per-second null-filled rows (604K rows / 59MB for a 7-day query). Pass `nil` instead to only include timestamps present in source data.
- Fix `$__timeGroup` precision: DuckDB's `date_trunc` retains nanosecond residuals on `TIMESTAMP_NS` columns, causing `GROUP BY` to produce per-second rows. Replaced with epoch-based integer math (`epoch_ns // interval`).
- Fix `$__timeFilter` hardcoded to `time` column: now dynamically extracts the column name from the macro argument.
- Fix error messages: surface Arc errors directly in UI instead of generic "query failed" messages. Add user-friendly messages for timeouts, connection refused, and EOF errors while preserving the original error chain.

### Added
- Query splitting: break large time ranges into parallel chunks executed concurrently. Configurable via query editor dropdown (Auto, Off, 1h, 6h, 12h, 1d, 3d, 7d). Auto mode picks chunk size based on the time range.
- Smart split-skipping: automatically bypasses splitting for LIMIT queries, aggregations without `$__timeGroup`, queries without `$__timeFilter`, UNION queries, and window functions.
- Per-query database override: specify a different database per query panel, overriding the datasource default.
- Auto-migrate `rawSql` from Postgres/MySQL/MSSQL/ClickHouse datasources when switching to Arc.
- Auto-add `ORDER BY time ASC` for time series queries without one.
- Configurable max concurrency for query splitting (default 4) via datasource settings.
- 40 unit tests covering query splitting, macros, frame merging, and aggregation detection.

## [1.0.0] - 2025-10-22

### Added
- Initial release of Arc Grafana datasource plugin
- Apache Arrow protocol support for high-performance data transfer
- Backend plugin (Go) for secure credential storage
- Frontend UI components (TypeScript/React):
  - ConfigEditor for datasource settings
  - QueryEditor with SQL text area
  - VariableQueryEditor for template variables
- Grafana macro support:
  - `$__timeFilter(column)` - Automatic time range filtering
  - `$__timeFrom()` / `$__timeTo()` - Time boundaries
  - `$__interval` - Auto-calculated interval
  - `$__timeGroup(column, interval)` - Time bucketing
- Multi-database query support
- Health check endpoint
- Comprehensive documentation (README, ARCHITECTURE)
- Build system with webpack and mage
- Support for all Arrow data types (INT64, FLOAT64, STRING, TIMESTAMP, BOOL)

### Performance
- 7.36x faster queries compared to JSON for large datasets (100K+ rows)
- 43% smaller network payloads
- Zero-copy Arrow deserialization
- Tested with Arc's 2.43M records/sec write performance

### Security
- Encrypted API key storage using Grafana secrets
- Backend-only credential access
- HTTPS support

[Unreleased]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.2.2...HEAD
[1.2.2]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.2.0...v1.2.2
[1.2.0]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/basekick-labs/grafana-arc-datasource/releases/tag/v1.0.0
