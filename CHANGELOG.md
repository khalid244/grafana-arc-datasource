# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.4] - 2026-06-11

### Changed
- **The status chip's execution time is now the end-to-end wall clock of the query** — from the moment the plugin receives it to frames ready, covering Arc round-trips, chunk fan-out, merge, and long-to-wide conversion. Previously the value was Arc's self-reported per-query time (single queries) or the **sum** of per-chunk durations (split queries) — chunks run concurrently, so the sum read several times larger than the actual wait (e.g. "7s" on a query that landed in under 2s). `mergeChunkMeta` no longer aggregates `executionTime`; a single `stampExecutionTime` pass owns the value for both split and non-split paths. Provenance merging is also more robust: the first chunk that actually *reports* `servedBy` wins, instead of the first chunk that merely has a custom meta map.

## [1.3.3] - 2026-06-11

### Fixed
- **Split queries now report an execution time in the editor status chip.** When a long time range is split into parallel chunks, the merge step rebuilt the frame's `custom` meta but copied only `servedBy`/`rollupCube` — `executionTime` was dropped, so the chip showed `Source —` with no duration. The merge now carries `executionTime` as the **sum** of every chunk's per-chunk duration (total backend work, int64 ms — chunks run concurrently so this is not wall-clock), keeping the same meta shape as the non-split path so the frontend renders it identically. Chunks that lack the field are tolerated, and the key is omitted entirely when no chunk reported one.
- **Legacy panels saved with `rollup: "off"` (string) no longer display "Auto" in the editor.** The backend already decodes the legacy `rollup` hint tolerantly (string `"off"`/`"false"` → off), so such panels *executed* with rollups off but the editor's strict boolean check (`rollup === false`) showed "Auto" — a mismatch between what ran and what was displayed. `effectiveRollupMode` now mirrors the backend decode: `rollupMode` wins when present, else a `rollup` of boolean `false` or the strings `'off'`/`'false'` (case-insensitive) resolves to "Off". The same tolerant decode also gates the pre-run rollup-explain call, so a string-`"off"` panel skips the check too.
- **The rollup hint chip no longer mispredicts when rollups are off.** With the effective mode resolved to off, the editor now skips the `rollup-explain` call and shows a neutral "Rollup disabled for this query" chip instead of a misleading "Will roll up …" prediction (or no chip at all). A fresh post-run result still wins, so a query run with rollups off continues to show `Source · <time>`.

### Added
- Backend tests for the split-merge `executionTime` sum (`mergeChunkMeta`) and frontend tests for the tolerant `rollup` decoding (`effectiveRollupMode`/`isLegacyRollupOff`).

## [1.3.2] - 2026-06-11

### Fixed
- **`$__interval` now honors the interval Grafana actually computed for the query instead of a hardcoded range table.** The backend substituted `$__interval` purely from the time-range width (>7d → `1 hour`, 24h–7d → `10 minutes`, 6–24h → `1 minute`, else `10 seconds`), ignoring the user's interval selection/panel min-interval. For any range ≤7d this forced a sub-hour bucket onto Arc's rollup router, which rejected it with "time bucket is finer than the hourly cube" — even when the user had explicitly set a 1h interval (hourly cubes require `bucket_seconds % 3600 == 0`). The backend now threads `DataQuery.Interval` through `ApplyMacros`/`ApplyMacrosWithSplit` (single, split-chunk, alerting, and explore paths) and substitutes a canonical duration (`1h`, `30m`, `90s`); the range table remains only as a fallback when no interval is supplied.
- The pre-run rollup check (`rollup-explain` resource) now sends the panel's computed `intervalMs` and the backend uses it when expanding `$__interval`, so the "will this roll up?" prediction matches the bucket grain the query actually runs at. Also corrected `explainRollup`'s doc comment: `getTemplateSrv().replace` without scopedVars does **not** resolve `$__interval` client-side — the macro is forwarded literally and substituted server-side.
- `intervalToSeconds` now parses arbitrary durations (`2h`, `90m`, `1h0m0s`, Grafana units like `1d`/`1w`, and verbose forms like `45 minutes`) instead of silently defaulting any unknown string to 3600s; unparseable inputs still default to 3600s but log a warning.

### Added
- Frontend Jest wiring (`jest` config block in `package.json`) and a first unit test covering the `explainRollup` request body — `npm run test:ci` previously passed trivially with no tests.

## [1.3.1] - 2026-06-08

### Fixed
- **Rollup hint sent as a JSON string no longer fails the whole query.** Legacy/persisted dashboards — and alert/report/public-dashboard payloads that bypass frontend query migration — could store the legacy `rollup` field as a string (`"true"`/`"false"`) instead of a bool. The backend rejected it at unmarshal time (`failed to unmarshal query: json: cannot unmarshal string into Go struct field ArcQuery.rollup of type bool`), which short-circuited before the rollup→source decision and broke the panel/alert entirely instead of falling back to source. The `rollup` field now tolerantly decodes bool, stringified bool, or unparseable values (the latter degrade to `auto`), since a malformed optimization hint must never fail a query.

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

[Unreleased]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.3.4...HEAD
[1.3.4]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.2.3...v1.3.0
[1.2.3]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.2.0...v1.2.2
[1.2.0]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/basekick-labs/grafana-arc-datasource/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/basekick-labs/grafana-arc-datasource/releases/tag/v1.0.0
