package metrics

import (
	"bytes"
	"strings"
	"testing"
)

func TestTextFormat(t *testing.T) {
	r := NewRegistry()
	c := r.NewCounterVec("x_total", "help x", "route", "code")
	c.Inc("/a", "200")
	c.Inc("/a", "200")
	c.Inc(`/b"q`, "500")
	h := r.NewHistogramVec("y_seconds", "help y", []float64{0.1, 1}, "route")
	h.Observe(0.05, "/a")
	h.Observe(0.5, "/a")

	var buf bytes.Buffer
	r.WriteText(&buf)
	out := buf.String()
	for _, want := range []string{
		"# TYPE x_total counter",
		`x_total{route="/a",code="200"} 2`,
		`x_total{route="/b\"q",code="500"} 1`,
		"# TYPE y_seconds histogram",
		`y_seconds_bucket{route="/a",le="0.1"} 1`,
		`y_seconds_bucket{route="/a",le="1"} 2`,
		`y_seconds_bucket{route="/a",le="+Inf"} 2`,
		`y_seconds_count{route="/a"} 2`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}
