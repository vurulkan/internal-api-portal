// Package metrics is a small, dependency-free Prometheus text-format registry: just
// labelled counters and histograms, which is all the portal exports.
package metrics

import (
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// DefaultBuckets are latency buckets in seconds.
var DefaultBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30}

type collector interface {
	write(w io.Writer)
	name() string
}

type Registry struct {
	mu         sync.Mutex
	collectors []collector
}

func NewRegistry() *Registry { return &Registry{} }

func (r *Registry) register(c collector) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.collectors = append(r.collectors, c)
}

// WriteText writes every metric in the Prometheus text exposition format.
func (r *Registry) WriteText(w io.Writer) {
	r.mu.Lock()
	collectors := append([]collector{}, r.collectors...)
	r.mu.Unlock()
	sort.Slice(collectors, func(i, j int) bool { return collectors[i].name() < collectors[j].name() })
	for _, c := range collectors {
		c.write(w)
	}
}

// ─── Counter ─────────────────────────────────────────────────────────────────

type CounterVec struct {
	metric, help string
	labels       []string
	mu           sync.Mutex
	values       map[string]float64
}

func (r *Registry) NewCounterVec(name, help string, labels ...string) *CounterVec {
	c := &CounterVec{metric: name, help: help, labels: labels, values: map[string]float64{}}
	r.register(c)
	return c
}

// Inc adds 1 for the given label values (in the order the labels were declared).
func (c *CounterVec) Inc(values ...string) { c.Add(1, values...) }

func (c *CounterVec) Add(delta float64, values ...string) {
	key := labelKey(c.labels, values)
	c.mu.Lock()
	c.values[key] += delta
	c.mu.Unlock()
}

// Value returns the current value for the label values (for tests).
func (c *CounterVec) Value(values ...string) float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.values[labelKey(c.labels, values)]
}

func (c *CounterVec) name() string { return c.metric }

func (c *CounterVec) write(w io.Writer) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n", c.metric, c.help, c.metric)
	for _, key := range sortedKeys(c.values) {
		fmt.Fprintf(w, "%s%s %s\n", c.metric, key, formatFloat(c.values[key]))
	}
}

// ─── Histogram ───────────────────────────────────────────────────────────────

type histogramSeries struct {
	counts []uint64
	sum    float64
	count  uint64
}

type HistogramVec struct {
	metric, help string
	labels       []string
	buckets      []float64
	mu           sync.Mutex
	series       map[string]*histogramSeries
}

func (r *Registry) NewHistogramVec(name, help string, buckets []float64, labels ...string) *HistogramVec {
	h := &HistogramVec{metric: name, help: help, labels: labels, buckets: buckets, series: map[string]*histogramSeries{}}
	r.register(h)
	return h
}

func (h *HistogramVec) Observe(value float64, values ...string) {
	key := labelKey(h.labels, values)
	h.mu.Lock()
	defer h.mu.Unlock()
	s, ok := h.series[key]
	if !ok {
		s = &histogramSeries{counts: make([]uint64, len(h.buckets))}
		h.series[key] = s
	}
	for i, bound := range h.buckets {
		if value <= bound {
			s.counts[i]++
		}
	}
	s.sum += value
	s.count++
}

func (h *HistogramVec) name() string { return h.metric }

func (h *HistogramVec) write(w io.Writer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s histogram\n", h.metric, h.help, h.metric)
	keys := make([]string, 0, len(h.series))
	for key := range h.series {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		s := h.series[key]
		for i, bound := range h.buckets {
			fmt.Fprintf(w, "%s_bucket%s %d\n", h.metric, withLabel(key, "le", formatFloat(bound)), s.counts[i])
		}
		fmt.Fprintf(w, "%s_bucket%s %d\n", h.metric, withLabel(key, "le", "+Inf"), s.count)
		fmt.Fprintf(w, "%s_sum%s %s\n", h.metric, key, formatFloat(s.sum))
		fmt.Fprintf(w, "%s_count%s %d\n", h.metric, key, s.count)
	}
}

// ─── Label helpers ───────────────────────────────────────────────────────────

// labelKey renders {a="x",b="y"}; missing values are empty strings.
func labelKey(names, values []string) string {
	if len(names) == 0 {
		return ""
	}
	parts := make([]string, len(names))
	for i, name := range names {
		value := ""
		if i < len(values) {
			value = values[i]
		}
		parts[i] = name + `="` + escape(value) + `"`
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func withLabel(key, name, value string) string {
	label := name + `="` + value + `"`
	if key == "" {
		return "{" + label + "}"
	}
	return strings.TrimSuffix(key, "}") + "," + label + "}"
}

func escape(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, "\n", `\n`)
	return strings.ReplaceAll(value, `"`, `\"`)
}

func formatFloat(v float64) string {
	if math.IsInf(v, 1) {
		return "+Inf"
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}

func sortedKeys(m map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
