package plugin

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/apache/arrow/go/v14/arrow"
	"github.com/apache/arrow/go/v14/arrow/array"
	"github.com/apache/arrow/go/v14/arrow/ipc"
	"github.com/apache/arrow/go/v14/arrow/memory"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func jsonChunk(t *testing.T, vals ...interface{}) *data.Frame {
	t.Helper()
	rows := make([]interface{}, len(vals))
	for i, v := range vals {
		rows[i] = []interface{}{"2026-10-13T00:00:00Z", v}
	}
	f, err := JSONToDataFrame(map[string]interface{}{
		"columns": []interface{}{"time", "v"},
		"data":    rows,
	})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func floatAt(t *testing.T, f *data.Field, i int) (float64, bool) {
	t.Helper()
	v, ok := f.ConcreteAt(i)
	if !ok {
		return 0, false
	}
	return v.(float64), true
}

func TestMergeFrames_JSONAllNullFirstChunk(t *testing.T) {
	got, err := mergeFrames([]*data.Frame{
		jsonChunk(t, nil, nil),
		jsonChunk(t, 1.5, 2.5),
		jsonChunk(t, 3.5),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Rows() != 5 {
		t.Fatalf("rows = %d, want 5", got.Rows())
	}
	f := got.Fields[1]
	if f.Type() != data.FieldTypeNullableFloat64 {
		t.Fatalf("type = %s, want nullable float64", f.Type().ItemTypeString())
	}
	if _, ok := f.ConcreteAt(0); ok {
		t.Errorf("row 0 should be null")
	}
	if v, _ := floatAt(t, f, 4); v != 3.5 {
		t.Errorf("row 4 = %v, want 3.5", v)
	}
}

func TestMergeFrames_JSONAllNullMiddleAndLast(t *testing.T) {
	got, err := mergeFrames([]*data.Frame{
		jsonChunk(t, 1.0),
		jsonChunk(t, nil),
		jsonChunk(t, nil, nil),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Rows() != 4 || got.Fields[1].Type() != data.FieldTypeNullableFloat64 {
		t.Fatalf("rows=%d type=%s", got.Rows(), got.Fields[1].Type().ItemTypeString())
	}
}

func TestMergeFrames_AllChunksAllNull(t *testing.T) {
	got, err := mergeFrames([]*data.Frame{jsonChunk(t, nil), jsonChunk(t, nil, nil)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Rows() != 3 {
		t.Fatalf("rows = %d, want 3", got.Rows())
	}
}

func TestMergeFrames_WidensIntAndFloat(t *testing.T) {
	ts := []time.Time{time.Now()}
	for name, in := range map[string][]*data.Frame{
		"int first": {
			data.NewFrame("", data.NewField("time", nil, ts), data.NewField("v", nil, []int64{7})),
			data.NewFrame("", data.NewField("time", nil, ts), data.NewField("v", nil, []float64{1.5})),
		},
		"float first": {
			data.NewFrame("", data.NewField("time", nil, ts), data.NewField("v", nil, []float64{1.5})),
			data.NewFrame("", data.NewField("time", nil, ts), data.NewField("v", nil, []*int64{ptr(int64(7))})),
		},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := mergeFrames(in)
			if err != nil {
				t.Fatal(err)
			}
			if got.Rows() != 2 {
				t.Fatalf("rows = %d", got.Rows())
			}
			f := got.Fields[1]
			if f.Type().NonNullableType() != data.FieldTypeFloat64 {
				t.Fatalf("type = %s, want float64", f.Type().ItemTypeString())
			}
			sum := 0.0
			for i := 0; i < 2; i++ {
				v, _ := floatAt(t, f, i)
				sum += v
			}
			if sum != 8.5 {
				t.Errorf("sum = %v, want 8.5", sum)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

func TestMergeFrames_IncompatibleTypesError(t *testing.T) {
	ts := []time.Time{time.Now()}
	_, err := mergeFrames([]*data.Frame{
		data.NewFrame("", data.NewField("time", nil, ts), data.NewField("v", nil, []string{"a"})),
		data.NewFrame("", data.NewField("time", nil, ts), data.NewField("v", nil, []float64{1})),
		data.NewFrame("", data.NewField("time", nil, ts), data.NewField("v", nil, []float64{2})),
	})
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	for _, want := range []string{`"v"`, "chunk 1", "chunk 2", "string", "float64"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should mention %s", err, want)
		}
	}
}

func arrowChunk(t *testing.T, typ arrow.DataType, build func(b array.Builder)) *data.Frame {
	t.Helper()
	mem := memory.NewGoAllocator()
	schema := arrow.NewSchema([]arrow.Field{{Name: "v", Type: typ, Nullable: true}}, nil)
	rb := array.NewRecordBuilder(mem, schema)
	defer rb.Release()
	build(rb.Field(0))
	rec := rb.NewRecord()
	defer rec.Release()
	var buf bytes.Buffer
	w := ipc.NewWriter(&buf, ipc.WithSchema(schema))
	if err := w.Write(rec); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := ArrowToDataFrame(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestMergeFrames_ArrowTypeDriftBetweenDays(t *testing.T) {
	day1 := arrowChunk(t, arrow.PrimitiveTypes.Int64, func(b array.Builder) {
		b.(*array.Int64Builder).AppendValues([]int64{1, 2}, nil)
	})
	day2 := arrowChunk(t, arrow.PrimitiveTypes.Float64, func(b array.Builder) {
		b.(*array.Float64Builder).AppendValues([]float64{2.5}, nil)
	})
	got, err := mergeFrames([]*data.Frame{day1, day2})
	if err != nil {
		t.Fatal(err)
	}
	if got.Rows() != 3 || got.Fields[0].Type().NonNullableType() != data.FieldTypeFloat64 {
		t.Fatalf("rows=%d type=%s", got.Rows(), got.Fields[0].Type().ItemTypeString())
	}

	str := arrowChunk(t, arrow.BinaryTypes.String, func(b array.Builder) {
		b.(*array.StringBuilder).AppendValues([]string{"x"}, nil)
	})
	if _, err := mergeFrames([]*data.Frame{day1, str}); err == nil {
		t.Fatal("int64 vs string must error, not drop the chunk")
	}
}

func TestMergeFrames_ArrowAllNullNullTypeChunk(t *testing.T) {
	nullDay := arrowChunk(t, arrow.PrimitiveTypes.Float64, func(b array.Builder) {
		b.AppendNull()
		b.AppendNull()
	})
	day2 := arrowChunk(t, arrow.PrimitiveTypes.Float64, func(b array.Builder) {
		b.(*array.Float64Builder).AppendValues([]float64{2.5}, nil)
	})
	got, err := mergeFrames([]*data.Frame{nullDay, day2})
	if err != nil || got.Rows() != 3 {
		t.Fatalf("err=%v rows=%v", err, got)
	}
}
