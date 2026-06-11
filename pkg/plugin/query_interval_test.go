package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// --- $__interval substitution: the panel's REAL interval must win ---
//
// Prod-verified bug: ApplyMacros substituted $__interval from a hardcoded
// range table (range ≤7d → sub-hour buckets), ignoring the interval the user
// selected in Grafana. Arc's rollup cubes are HOURLY (bucket_seconds % 3600
// must be 0), so a user who set a 1h interval at a 3d range still got
// "10 minutes" and a "time bucket is finer than the hourly cube" error.

// extractIntervalToken pulls the substituted token out of "GROUP BY <token>".
func extractIntervalToken(t *testing.T, sql string) string {
	t.Helper()
	const prefix = "GROUP BY "
	idx := strings.Index(sql, prefix)
	if idx == -1 {
		t.Fatalf("expected %q in: %s", prefix, sql)
	}
	return strings.TrimSpace(sql[idx+len(prefix):])
}

func TestApplyMacros_ExplicitInterval_RoundTripsThroughIntervalToSeconds(t *testing.T) {
	tr := backend.TimeRange{
		From: time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 21, 0, 0, 0, 0, time.UTC), // 3d range → table would say "10 minutes"
	}
	cases := []struct {
		interval time.Duration
		wantSecs int
	}{
		{30 * time.Minute, 1800},
		{time.Hour, 3600},
		{90 * time.Second, 90},
		{10 * time.Minute, 600},
		{24 * time.Hour, 86400},
	}
	for _, c := range cases {
		result := ApplyMacros("GROUP BY $__interval", tr, c.interval)
		token := extractIntervalToken(t, result)
		if got := intervalToSeconds(token); got != c.wantSecs {
			t.Errorf("interval %v: substituted token %q resolves to %d seconds, want %d (sql: %s)",
				c.interval, token, got, c.wantSecs, result)
		}
	}
}

func TestApplyMacros_ZeroInterval_FallsBackToRangeTable(t *testing.T) {
	// Pin the legacy behavior: with no interval supplied the hardcoded
	// range table still decides.
	cases := []struct {
		hours    int
		expected string
	}{
		{2, "10 seconds"},  // < 6h
		{12, "1 minute"},   // > 6h, < 24h
		{48, "10 minutes"}, // > 24h, < 7d
		{200, "1 hour"},    // > 7d
	}
	for _, c := range cases {
		tr := backend.TimeRange{
			From: time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC),
			To:   time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC).Add(time.Duration(c.hours) * time.Hour),
		}
		result := ApplyMacros("GROUP BY $__interval", tr, 0)
		if !strings.Contains(result, c.expected) {
			t.Errorf("for %dh range with interval=0, expected %q in: %s", c.hours, c.expected, result)
		}
	}
}

func TestApplyMacrosWithSplit_ExplicitInterval_OverridesRangeTable(t *testing.T) {
	chunk := backend.TimeRange{
		From: time.Date(2026, 2, 18, 6, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 18, 12, 0, 0, 0, time.UTC),
	}
	originalRange := backend.TimeRange{
		From: time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC), // 3d → table would say "10 minutes"
	}

	sql := "WHERE $__timeFilter(time) GROUP BY $__interval"
	result := ApplyMacrosWithSplit(sql, chunk, originalRange, time.Hour)

	// Time filter still uses chunk boundaries
	if !strings.Contains(result, "2026-02-18T06:00:00Z") {
		t.Errorf("expected chunk From in filter: %s", result)
	}
	token := extractIntervalToken(t, result)
	if got := intervalToSeconds(token); got != 3600 {
		t.Errorf("substituted token %q resolves to %d seconds, want 3600 (sql: %s)", token, got, result)
	}
}

func TestApplyMacrosWithSplit_ZeroInterval_FallsBackToOriginalRangeTable(t *testing.T) {
	chunk := backend.TimeRange{
		From: time.Date(2026, 2, 18, 6, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 18, 12, 0, 0, 0, time.UTC),
	}
	originalRange := backend.TimeRange{
		From: time.Date(2026, 2, 10, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC), // 8d (> 7d) → "1 hour"
	}
	result := ApplyMacrosWithSplit("GROUP BY $__interval", chunk, originalRange, 0)
	if !strings.Contains(result, "1 hour") {
		t.Errorf("expected '1 hour' from 8d original range with interval=0: %s", result)
	}
}

// --- $__timeGroup(time, '$__interval') end-to-end ---

func TestApplyMacros_TimeGroupWithIntervalMacro_1h(t *testing.T) {
	tr := backend.TimeRange{
		From: time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 21, 0, 0, 0, 0, time.UTC), // 3d → table would say 600s
	}
	sql := "SELECT $__timeGroup(time, '$__interval') AS t, count(*) FROM m GROUP BY t"
	result := ApplyMacros(sql, tr, time.Hour)

	if strings.Contains(result, "$__timeGroup") || strings.Contains(result, "$__interval") {
		t.Fatalf("macros not fully expanded: %s", result)
	}
	if !strings.Contains(result, "// 3600) * 3600") {
		t.Errorf("expected 3600s epoch bucketing for interval=1h, got: %s", result)
	}
}

func TestApplyMacros_TimeGroupWithIntervalMacro_10m(t *testing.T) {
	tr := backend.TimeRange{
		From: time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 18, 2, 0, 0, 0, time.UTC), // 2h → table would say 10s
	}
	sql := "SELECT $__timeGroup(time, '$__interval') AS t, count(*) FROM m GROUP BY t"
	result := ApplyMacros(sql, tr, 10*time.Minute)

	if !strings.Contains(result, "// 600) * 600") {
		t.Errorf("expected 600s epoch bucketing for interval=10m, got: %s", result)
	}
}

// --- intervalToSeconds: arbitrary durations ---

func TestIntervalToSeconds_ArbitraryDurations(t *testing.T) {
	cases := []struct {
		input    string
		expected int
	}{
		{"2h", 7200},         // time.ParseDuration / gtime
		{"90m", 5400},        // time.ParseDuration / gtime
		{"45 minutes", 2700}, // verbose form
		{"45 minute", 2700},  // verbose singular
		{"2 hours", 7200},    // verbose form
		{"3 days", 259200},   // verbose form
		{"1h0m0s", 3600},     // canonical Go duration string
		{"90s", 90},          // plain seconds
		{"1w", 604800},       // grafana gtime unit
		{"2d", 172800},       // grafana gtime unit
		{"garbage", 3600},    // unparseable → default
		{"", 3600},           // empty → default
	}
	for _, c := range cases {
		if got := intervalToSeconds(c.input); got != c.expected {
			t.Errorf("intervalToSeconds(%q): expected %d, got %d", c.input, c.expected, got)
		}
	}
}

// --- rollup-explain resource: intervalMs in the body must be honored ---

func TestHandleRollupExplain_IntervalMsHonored(t *testing.T) {
	var gotSQL string
	arc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SQL string `json:"sql"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotSQL = body.SQL
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"supported":true,"cube":"by_event"}`)
	}))
	defer arc.Close()

	d := NewArcDatasource()
	settings := &ArcInstanceSettings{
		settings: ArcDataSourceSettings{URL: arc.URL},
		apiKey:   "test",
	}

	from := time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC)
	to := from.Add(2 * time.Hour) // 2h range → table fallback would say "10 seconds"
	reqBody, _ := json.Marshal(map[string]interface{}{
		"sql":        "SELECT 1 FROM m GROUP BY $__interval",
		"from":       from.UnixMilli(),
		"to":         to.UnixMilli(),
		"intervalMs": int64(30 * 60 * 1000), // 30m
	})

	var sent []byte
	sender := callResourceSenderFunc(func(resp *backend.CallResourceResponse) error {
		sent = resp.Body
		return nil
	})
	err := d.handleRollupExplain(context.Background(), &backend.CallResourceRequest{Body: reqBody}, settings, sender)
	if err != nil {
		t.Fatalf("handleRollupExplain returned error: %v", err)
	}
	if !strings.Contains(string(sent), `"supported":true`) {
		t.Fatalf("expected explain response relayed, got: %s", sent)
	}

	token := extractIntervalToken(t, gotSQL)
	if got := intervalToSeconds(token); got != 1800 {
		t.Errorf("expanded $__interval %q resolves to %d seconds, want 1800 (sql sent to arc: %s)",
			token, got, gotSQL)
	}
}

func TestHandleRollupExplain_NoIntervalMs_FallsBackToRangeTable(t *testing.T) {
	var gotSQL string
	arc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SQL string `json:"sql"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotSQL = body.SQL
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"supported":false}`)
	}))
	defer arc.Close()

	d := NewArcDatasource()
	settings := &ArcInstanceSettings{
		settings: ArcDataSourceSettings{URL: arc.URL},
		apiKey:   "test",
	}

	from := time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC)
	to := from.Add(2 * time.Hour) // 2h range → "10 seconds"
	reqBody, _ := json.Marshal(map[string]interface{}{
		"sql":  "SELECT 1 FROM m GROUP BY $__interval",
		"from": from.UnixMilli(),
		"to":   to.UnixMilli(),
	})

	sender := callResourceSenderFunc(func(resp *backend.CallResourceResponse) error { return nil })
	if err := d.handleRollupExplain(context.Background(), &backend.CallResourceRequest{Body: reqBody}, settings, sender); err != nil {
		t.Fatalf("handleRollupExplain returned error: %v", err)
	}
	if !strings.Contains(gotSQL, "10 seconds") {
		t.Errorf("expected range-table fallback '10 seconds' without intervalMs, got: %s", gotSQL)
	}
}

// callResourceSenderFunc adapts a func to backend.CallResourceResponseSender.
type callResourceSenderFunc func(*backend.CallResourceResponse) error

func (f callResourceSenderFunc) Send(resp *backend.CallResourceResponse) error { return f(resp) }
