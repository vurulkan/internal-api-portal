// Package password holds the password policy applied wherever a password is set
// (create, change, admin reset, bootstrap).
package password

import (
	"crypto/rand"
	_ "embed"
	"fmt"
	"math/big"
	"strings"
)

//go:embed common.txt
var commonList string

var common = func() map[string]struct{} {
	set := map[string]struct{}{}
	for _, line := range strings.Split(commonList, "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "#") {
			set[line] = struct{}{}
		}
	}
	return set
}()

// MaxLength bounds input to the hash function; far above any real password.
const MaxLength = 128

// FloorLength is the smallest PASSWORD_MIN_LENGTH accepted.
const FloorLength = 8

type Policy struct {
	MinLength int
}

// NewPolicy clamps the configured minimum to [FloorLength, MaxLength].
func NewPolicy(minLength int) Policy {
	if minLength < FloorLength {
		minLength = FloorLength
	}
	if minLength > MaxLength {
		minLength = MaxLength
	}
	return Policy{MinLength: minLength}
}

// Problem returns why the password is refused, or "" when it is acceptable.
// Passwords are taken as typed (no trimming).
func (p Policy) Problem(pw, username string) string {
	n := len([]rune(pw))
	switch {
	case strings.TrimSpace(pw) == "":
		return "password is required"
	case n < p.MinLength:
		return fmt.Sprintf("password must be at least %d characters", p.MinLength)
	case n > MaxLength:
		return fmt.Sprintf("password must be at most %d characters", MaxLength)
	}
	lower := strings.ToLower(pw)
	if u := strings.ToLower(strings.TrimSpace(username)); len(u) >= 3 && strings.Contains(lower, u) {
		return "password must not contain the username"
	}
	if _, ok := common[lower]; ok {
		return "this password is on a list of commonly used passwords; choose another"
	}
	return ""
}

const generatedAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

// Generate returns a random password of length characters from an alphabet without
// look-alike characters (for temporary and bootstrap passwords).
func Generate(length int) (string, error) {
	var b strings.Builder
	max := big.NewInt(int64(len(generatedAlphabet)))
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(generatedAlphabet[n.Int64()])
	}
	return b.String(), nil
}
