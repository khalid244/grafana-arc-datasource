package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// A $__timeGroup bucket that does not tile the split chunk is aggregated once
// per chunk it spans and merged back as several partial rows sharing one
// timestamp. Upstream (1caaac7, #18) saw a 1d bucket over a 4-day range return
// 16 rows instead of 5: auto-split picks 6h chunks for a 1–7d span.
//
// The fake Arc returns one row per request, so request count == merged row
// count, which is exactly the corruption.
func runSplitQuery(t *testing.T, sql string, span time.Duration, interval time.Duration) (requests int32, rows int) {
	t.Helper()
	var n int32
	arc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&n, 1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"columns":["time","value"],"data":[["2026-02-18T00:00:00Z",1]],"rows":1}`)
	}))
	defer arc.Close()

	d := NewArcDatasource()
	settings := &ArcInstanceSettings{
		settings: ArcDataSourceSettings{URL: arc.URL, MaxConcurrency: 4},
		apiKey:   "test",
	}
	qjson, _ := json.Marshal(map[string]interface{}{"sql": sql, "format": "table"})
	from := time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC)
	resp := d.queryInner(context.Background(), settings, backend.DataQuery{
		RefID:     "A",
		JSON:      qjson,
		TimeRange: backend.TimeRange{From: from, To: from.Add(span)},
		Interval:  interval,
	})
	if resp.Error != nil {
		t.Fatalf("query error: %v", resp.Error)
	}
	for _, f := range resp.Frames {
		rows += f.Rows()
	}
	return atomic.LoadInt32(&n), rows
}

const splitBucketSQL = "SELECT %s AS time, COUNT(*) AS value FROM m WHERE $__timeFilter(time) GROUP BY 1"

func TestSplit_BucketWiderThanChunk_RunsUnsplit(t *testing.T) {
	sql := fmt.Sprintf(splitBucketSQL, "$__timeGroup(time, '1d')")
	reqs, rows := runSplitQuery(t, sql, 4*24*time.Hour, 0)
	if reqs != 1 || rows != 1 {
		t.Fatalf("1d bucket over 4d (6h chunks): got %d requests / %d rows, want 1 / 1 (unsplit)", reqs, rows)
	}
}

func TestSplit_BucketFromIntervalMacro_RunsUnsplit(t *testing.T) {
	// The common dashboard form: the bucket is '$__interval', resolved from
	// the panel's interval, so the guard must resolve it before measuring.
	sql := fmt.Sprintf(splitBucketSQL, "$__timeGroup(time, '$__interval')")
	reqs, _ := runSplitQuery(t, sql, 4*24*time.Hour, 24*time.Hour)
	if reqs != 1 {
		t.Fatalf("$__interval=1d over 4d: got %d requests, want 1 (unsplit)", reqs)
	}
}

func TestSplit_BucketNotDividingChunk_RunsUnsplit(t *testing.T) {
	// 4h buckets straddle the 6h chunk edges (00-04, 04-08 spans 06:00).
	sql := fmt.Sprintf(splitBucketSQL, "$__timeGroup(time, '4h')")
	reqs, _ := runSplitQuery(t, sql, 4*24*time.Hour, 0)
	if reqs != 1 {
		t.Fatalf("4h bucket with 6h chunks: got %d requests, want 1 (unsplit)", reqs)
	}
}

func TestSplit_BucketTilesChunk_StillSplits(t *testing.T) {
	sql := fmt.Sprintf(splitBucketSQL, "$__timeGroup(time, '1h')")
	reqs, _ := runSplitQuery(t, sql, 4*24*time.Hour, 0)
	if reqs != 16 {
		t.Fatalf("1h bucket over 4d: got %d requests, want 16 (split into 6h chunks)", reqs)
	}
	sql = fmt.Sprintf(splitBucketSQL, "$__timeGroup(time, '$__interval')")
	reqs, _ = runSplitQuery(t, sql, 4*24*time.Hour, 0) // fallback: 10 minutes
	if reqs != 16 {
		t.Fatalf("fallback 10m bucket over 4d: got %d requests, want 16", reqs)
	}
}

func TestTimeGroupBucketsTileChunk(t *testing.T) {
	cases := []struct {
		sql      string
		interval time.Duration
		chunk    time.Duration
		want     bool
	}{
		{"SELECT 1", 0, 6 * time.Hour, true},
		{"$__timeGroup(time, '1h')", 0, 6 * time.Hour, true},
		{"$__timeGroup(time, '6h')", 0, 6 * time.Hour, true},
		{"$__timeGroup(time, '1d')", 0, 6 * time.Hour, false},
		{"$__timeGroup(time, '1d')", 0, 7 * 24 * time.Hour, true},
		{"$__timeGroup(time, '4h')", 0, 6 * time.Hour, false},
		{"$__timeGroup(time, \"30m\")", 0, time.Hour, true},
		{"$__timeGroup(a, '1h'), $__timeGroup(b, '1d')", 0, 6 * time.Hour, false},
		{"$__timeGroup(time, '$__interval')", 2 * time.Hour, 6 * time.Hour, true},
		{"$__timeGroup(time, '$__interval')", 12 * time.Hour, 6 * time.Hour, false},
		{"$__timeGroup(time)", 0, 6 * time.Hour, true}, // malformed: never expands
	}
	for _, c := range cases {
		rng := 4 * 24 * time.Hour
		if got := timeGroupBucketsTileChunk(c.sql, c.interval, rng, c.chunk); got != c.want {
			t.Errorf("timeGroupBucketsTileChunk(%q, interval=%v, chunk=%v) = %v, want %v",
				c.sql, c.interval, c.chunk, got, c.want)
		}
	}
}
