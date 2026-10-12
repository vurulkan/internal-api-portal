package openapi

import (
	"encoding/json"
	"testing"
)

func TestExtractOperations(t *testing.T) {
	swagger2 := `{"swagger":"2.0","info":{"version":1.5},"paths":{
		"/pets":{"parameters":[],"get":{"operationId":"listPets","tags":["pets"]},"post":{"description":"Add a pet\nwith details"},"x-extension":{}},
		"/pets/{id}":{"delete":{"deprecated":true,"summary":"Remove a pet"},"head":"not an object"}}}`
	version, ops := ExtractOperations(json.RawMessage(swagger2))
	if version != "1.5" {
		t.Errorf("version %q", version)
	}
	want := []string{"GET /pets listPets", "POST /pets Add a pet", "DELETE /pets/{id} Remove a pet"}
	if len(ops) != len(want) {
		t.Fatalf("ops: %+v", ops)
	}
	for i, op := range ops {
		got := op.Method + " " + op.Path + " " + op.OperationID + op.Summary
		if i == 0 {
			got = op.Method + " " + op.Path + " " + op.OperationID
		}
		if got != want[i] {
			t.Errorf("op %d: %q, want %q", i, got, want[i])
		}
	}
	if !ops[2].Deprecated || ops[0].Tags[0] != "pets" {
		t.Errorf("flags: %+v", ops)
	}
	for _, bad := range []string{``, `[]`, `{"paths":"x"}`, `{"openapi":"3.0.0"}`} {
		if _, ops := ExtractOperations(json.RawMessage(bad)); len(ops) != 0 {
			t.Errorf("%q: %+v", bad, ops)
		}
	}
}
