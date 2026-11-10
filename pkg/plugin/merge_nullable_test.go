package plugin

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func TestMergeFrames_NullableAndNonNullableChunks(t *testing.T) {
	t1 := time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)
	t2 := t1.Add(24 * time.Hour)
	t3 := t2.Add(24 * time.Hour)

	v := 1.5
	withNull := data.NewFrame("",
		data.NewField("time", nil, []time.Time{t1, t2}),
		data.NewField("value", nil, []*float64{&v, nil}),
	)
	plain := data.NewFrame("",
		data.NewField("time", nil, []time.Time{t3}),
		data.NewField("value", nil, []float64{4.0}),
	)

	for name, frames := range map[string][]*data.Frame{
		"nullable first":     {withNull, plain},
		"non-nullable first": {plain, withNull},
	} {
		t.Run(name, func(t *testing.T) {
			// frames are mutated by the merge; rebuild per case
			wn := data.NewFrame("",
				data.NewField("time", nil, []time.Time{t1, t2}),
				data.NewField("value", nil, []*float64{&v, nil}),
			)
			pl := data.NewFrame("",
				data.NewField("time", nil, []time.Time{t3}),
				data.NewField("value", nil, []float64{4.0}),
			)
			in := []*data.Frame{wn, pl}
			if frames[0] == plain {
				in = []*data.Frame{pl, wn}
			}
			got, err := mergeFrames(in)
			if err != nil {
				t.Fatal(err)
			}
			if got.Rows() != 3 {
				t.Fatalf("expected 3 rows, got %d", got.Rows())
			}
			f := got.Fields[1]
			if !f.Nullable() {
				t.Fatalf("merged value field must be nullable")
			}
			nulls := 0
			for i := 0; i < f.Len(); i++ {
				if _, ok := f.ConcreteAt(i); !ok {
					nulls++
				}
			}
			if nulls != 1 {
				t.Fatalf("expected exactly 1 NULL, got %d", nulls)
			}
		})
	}
}

func TestQuery_PanicIsRecoveredIntoErrorResponse(t *testing.T) {
	d := NewArcDatasource()
	// nil settings makes queryInner dereference nil -> panic
	q := backend.DataQuery{
		RefID:     "A",
		TimeRange: backend.TimeRange{From: time.Now().Add(-time.Hour), To: time.Now()},
		JSON:      json.RawMessage(`{"sql":"SELECT 1","database":"x"}`),
	}
	res := d.query(context.Background(), nil, q)
	if res.Error == nil {
		t.Fatalf("expected an error response from a recovered panic")
	}
}

func TestMergeFrames_EmptyChunkDoesNotMakeColumnsNullable(t *testing.T) {
	t1 := time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)
	rows := func(ts ...time.Time) *data.Frame {
		vals := make([]float64, len(ts))
		return data.NewFrame("",
			data.NewField("time", nil, ts),
			data.NewField("value", nil, vals),
		)
	}
	for name, in := range map[string][]*data.Frame{
		"empty first":  {rows(), rows(t1), rows(t1.Add(time.Hour))},
		"empty middle": {rows(t1), rows(), rows(t1.Add(time.Hour))},
		"empty last":   {rows(t1), rows(t1.Add(time.Hour)), rows()},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := mergeFrames(in)
			if err != nil {
				t.Fatal(err)
			}
			if got.Rows() != 2 {
				t.Fatalf("expected 2 rows, got %d", got.Rows())
			}
			for _, f := range got.Fields {
				if f.Nullable() {
					t.Errorf("column %q is nullable; an empty chunk must not change the schema (type %s)", f.Name, f.Type())
				}
			}
		})
	}
}
