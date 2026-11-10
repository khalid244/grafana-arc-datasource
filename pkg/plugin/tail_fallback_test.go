package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

type seenReq struct{ fallback, deadline string }

func tailArc(t *testing.T, partial string) (*httptest.Server, func() []seenReq) {
	t.Helper()
	var mu sync.Mutex
	var seen []seenReq
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, seenReq{r.Header.Get("X-Arc-Tail-Fallback"), r.Header.Get("X-Arc-Tail-Deadline-Ms")})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if partial != "" {
			w.Header().Set("X-Arc-Partial", partial)
		}
		fmt.Fprint(w, `{"columns":["time","v"],"data":[[1760313600000,1.5]]}`)
	}))
	return srv, func() []seenReq { mu.Lock(); defer mu.Unlock(); return seen }
}

func tailQuery(t *testing.T, mode, split string, days int) backend.DataQuery {
	to := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	qm, _ := json.Marshal(map[string]interface{}{
		"sql":           "SELECT $__timeGroup(time, '1h') AS time, avg(v) AS v FROM m WHERE $__timeFilter(time) GROUP BY 1",
		"format":        "table",
		"rollupMode":    mode,
		"splitDuration": split,
	})
	return backend.DataQuery{
		RefID:     "A",
		Interval:  time.Hour,
		TimeRange: backend.TimeRange{From: to.AddDate(0, 0, -days), To: to},
		JSON:      qm,
	}
}

func TestTailFallbackHeaders(t *testing.T) {
	cases := []struct {
		name     string
		enabled  bool
		mode     string
		deadline int
		want     seenReq
	}{
		{"auto enabled", true, "auto", 7000, seenReq{"cube-only", "7000"}},
		{"auto disabled", false, "auto", 7000, seenReq{}},
		{"only never", true, "only", 7000, seenReq{}},
		{"off never", true, "off", 7000, seenReq{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv, seen := tailArc(t, "")
			defer srv.Close()
			d := NewArcDatasource()
			s := &ArcInstanceSettings{apiKey: "k", settings: ArcDataSourceSettings{URL: srv.URL, Timeout: 5, MaxConcurrency: 2, TailFallback: c.enabled, TailDeadlineMs: c.deadline}}
			res := d.query(context.Background(), s, tailQuery(t, c.mode, "off", 1))
			if res.Error != nil {
				t.Fatal(res.Error)
			}
			got := seen()
			if len(got) != 1 || got[0] != c.want {
				t.Fatalf("got %+v want %+v", got, c.want)
			}
		})
	}
}

func TestTailFallbackNoticeSingleAndSplit(t *testing.T) {
	const hdr = "tail-missing; from=2026-10-14T00:00:00Z; to=2026-10-14T12:00:00Z"
	for _, split := range []string{"off", "1d"} {
		t.Run("split="+split, func(t *testing.T) {
			srv, seen := tailArc(t, hdr)
			defer srv.Close()
			d := NewArcDatasource()
			s := &ArcInstanceSettings{apiKey: "k", settings: ArcDataSourceSettings{URL: srv.URL, Timeout: 5, MaxConcurrency: 2, TailFallback: true, TailDeadlineMs: 10000}}
			res := d.query(context.Background(), s, tailQuery(t, "auto", split, 3))
			if res.Error != nil {
				t.Fatal(res.Error)
			}
			if split == "1d" && len(seen()) < 2 {
				t.Fatalf("expected multiple chunks, got %d", len(seen()))
			}
			n := 0
			for _, f := range res.Frames {
				if f.Meta != nil {
					for _, no := range f.Meta.Notices {
						n++
						if no.Severity != data.NoticeSeverityWarning || no.Text == "" {
							t.Fatalf("bad notice %+v", no)
						}
						t.Log(no.Text)
					}
				}
			}
			if n != 1 {
				t.Fatalf("expected exactly 1 notice, got %d", n)
			}
		})
	}
}

func TestTailFallbackNoNoticeWithoutHeader(t *testing.T) {
	srv, _ := tailArc(t, "")
	defer srv.Close()
	d := NewArcDatasource()
	s := &ArcInstanceSettings{apiKey: "k", settings: ArcDataSourceSettings{URL: srv.URL, Timeout: 5, MaxConcurrency: 2, TailFallback: true}}
	res := d.query(context.Background(), s, tailQuery(t, "auto", "1d", 3))
	for _, f := range res.Frames {
		if f.Meta != nil && len(f.Meta.Notices) > 0 {
			t.Fatalf("unexpected notice")
		}
	}
}

func TestParseArcPartial(t *testing.T) {
	f, to, ok := parseArcPartial("tail-missing; from=2026-10-14T00:00:00Z; to=2026-10-14T12:00:00Z")
	if !ok || f != "2026-10-14T00:00:00Z" || to != "2026-10-14T12:00:00Z" {
		t.Fatal(f, to, ok)
	}
	for _, bad := range []string{"", "other; from=a; to=b", "tail-missing; from=a", "tail-missing; from=garbage; to=2026-10-14T12:00:00Z", "tail-missing; from=2026-10-14T00:00:00Z; to=soon"} {
		if _, _, ok := parseArcPartial(bad); ok {
			t.Fatalf("should reject %q", bad)
		}
	}
}

func partialFrame(from, to string) *data.Frame {
	return &data.Frame{Meta: &data.FrameMeta{Custom: map[string]interface{}{partialFromKey: from, partialToKey: to}}}
}

func TestMergeChunkMeta_PartialUnionComparesTimes(t *testing.T) {
	// As strings "...:00Z" > "...:00.5Z" is false ('Z' > '.'), but the instants order the other way.
	frames := []*data.Frame{
		partialFrame("2026-10-14T00:00:00.5Z", "2026-10-14T06:00:00.5Z"),
		partialFrame("2026-10-14T00:00:00Z", "2026-10-14T06:00:00Z"),
	}
	c := mergeChunkMeta(frames, 2)
	if c[partialFromKey] != "2026-10-14T00:00:00Z" {
		t.Errorf("from = %v, want the earlier instant 2026-10-14T00:00:00Z", c[partialFromKey])
	}
	if c[partialToKey] != "2026-10-14T06:00:00.5Z" {
		t.Errorf("to = %v, want the later instant 2026-10-14T06:00:00.5Z", c[partialToKey])
	}
	if _, ok := c[partialSpansKey]; ok {
		t.Errorf("overlapping windows must not be reported as separate spans")
	}
}

func TestMergeChunkMeta_DisjointPartialSpans(t *testing.T) {
	frames := []*data.Frame{
		partialFrame("2026-10-14T00:00:00Z", "2026-10-14T06:00:00Z"),
		partialFrame("2026-10-16T00:00:00Z", "2026-10-16T06:00:00Z"),
	}
	merged := &data.Frame{Meta: &data.FrameMeta{Custom: mergeChunkMeta(frames, 2)}}
	spans := partialSpansMeta(merged)
	if len(spans) != 2 {
		t.Fatalf("spans = %v, want 2 separate windows", spans)
	}
	out := data.Frames{{}}
	pf, pt, _ := partialFromMeta(merged)
	addPartialNotice(out, pf, pt, spans)
	text := out[0].Meta.Notices[0].Text
	if !strings.Contains(text, "2 separate windows") || !strings.Contains(text, "2026-10-14T00:00:00Z to 2026-10-14T06:00:00Z") || !strings.Contains(text, "2026-10-16T00:00:00Z to 2026-10-16T06:00:00Z") {
		t.Errorf("notice does not name the separate windows: %s", text)
	}
	if strings.Contains(text, "from 2026-10-14T00:00:00Z to 2026-10-16T06:00:00Z") {
		t.Errorf("notice overstates the missing span: %s", text)
	}
}
