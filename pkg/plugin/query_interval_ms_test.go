package plugin

import (
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// $__interval_ms must expand to the interval in milliseconds. Before the fix
// the $__interval ReplaceAll consumed its prefix and left "<interval>_ms"
// (e.g. "1h_ms" or "10 minutes_ms"), which is invalid SQL.
func TestApplyMacros_IntervalMs(t *testing.T) {
	tr3d := backend.TimeRange{
		From: time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 21, 0, 0, 0, 0, time.UTC),
	}
	cases := []struct {
		name     string
		interval time.Duration
		want     string
	}{
		{"explicit 1h", time.Hour, "SELECT 3600000, '1h'"},
		{"explicit 90s", 90 * time.Second, "SELECT 90000, '90s'"},
		{"fallback 3d range = 10 minutes", 0, "SELECT 600000, '10 minutes'"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ApplyMacros("SELECT $__interval_ms, '$__interval'", tr3d, c.interval)
			if got != c.want {
				t.Errorf("ApplyMacros = %q, want %q", got, c.want)
			}
		})
	}
}

func TestApplyMacrosWithSplit_IntervalMs(t *testing.T) {
	orig := backend.TimeRange{
		From: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 21, 0, 0, 0, 0, time.UTC), // 20d → "1 hour"
	}
	chunk := backend.TimeRange{From: orig.From, To: orig.From.Add(24 * time.Hour)}
	if got, want := ApplyMacrosWithSplit("x = $__interval_ms", chunk, orig, 0), "x = 3600000"; got != want {
		t.Errorf("fallback: got %q, want %q", got, want)
	}
	if got, want := ApplyMacrosWithSplit("x = $__interval_ms", chunk, orig, 5*time.Minute), "x = 300000"; got != want {
		t.Errorf("explicit: got %q, want %q", got, want)
	}
}
