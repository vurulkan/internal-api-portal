package password

import "testing"

func TestPolicy(t *testing.T) {
	p := NewPolicy(12)
	cases := map[string]bool{
		"":                      false,
		"short-1":               false,
		"alice-is-great-1":      false, // contains the username
		"baseball1234":          true,  // 12 chars; not on the list
		"correct horse battery": true,
		"contortionist":         false, // common
		"qwertyuiopasdfg":       true,
	}
	for pw, ok := range cases {
		if got := p.Problem(pw, "alice") == ""; got != ok {
			t.Errorf("Problem(%q) accepted=%v, want %v (%s)", pw, got, ok, p.Problem(pw, "alice"))
		}
	}
	if NewPolicy(3).MinLength != FloorLength {
		t.Error("minimum below the floor was not clamped")
	}
	if NewPolicy(8).Problem("password1", "") == "" {
		t.Error("common password accepted at min length 8")
	}
}

func TestGenerate(t *testing.T) {
	a, _ := Generate(20)
	b, _ := Generate(20)
	if len(a) != 20 || a == b {
		t.Fatalf("Generate: %q %q", a, b)
	}
	if NewPolicy(16).Problem(a, "admin") != "" {
		t.Fatalf("generated password fails the policy: %q", a)
	}
}
