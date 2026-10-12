//go:build race

package api

// raceEnabled: the race detector slows queries down ~40x, so timing budgets are only logged.
const raceEnabled = true
