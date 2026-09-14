package app

import (
	"encoding/json"
	"errors"
	"strings"
)

// diagnosticsCommand projects an allowlist, never arbitrary provider/job payloads.
// In particular child_launch.result can contain command output and must not leak.
func (a *Application) diagnosticsCommand(args string) (string, error) {
	if args != "" && strings.ToLower(strings.TrimSpace(args)) != "durable" {
		return "", errors.New("usage: /diagnostics [durable]")
	}
	entries, err := a.Session.Branch()
	if err != nil {
		return "", err
	}
	const scanLimit = 10000
	const recordLimit = 100
	scanned := len(entries)
	limited := scanned > scanLimit
	if limited {
		entries = entries[scanned-scanLimit:]
		scanned = scanLimit
	}
	records := []map[string]any{}
	accepted := 0
	for _, e := range entries {
		var r map[string]any
		switch e.CustomType {
		case "provider_attempt":
			var p struct {
				Failed bool `json:"failed"`
			}
			if json.Unmarshal(e.Data, &p) != nil {
				continue
			}
			outcome := "success"
			if p.Failed {
				outcome = "failed"
			}
			r = map[string]any{"version": 1, "generated": e.Timestamp, "component": "provider", "code": "provider_attempt_observed", "outcome": outcome}
		case "child_launch":
			r = map[string]any{"version": 1, "generated": e.Timestamp, "component": "jobs", "code": "JOBS_TASK_CHILD_LINKED", "outcome": "success"}
		default:
			continue
		}
		accepted++
		records = append(records, r)
		if len(records) > recordLimit {
			records = records[1:]
		}
	}
	output := map[string]any{"records": records, "accepted": accepted, "dropped": accepted - len(records), "invalid": 0, "deduplicated": 0, "budgetDropped": 0, "writeFailures": 0, "scope": "active branch provider and child lifecycle records", "runningJobs": a.Runtime.Running()}
	if strings.TrimSpace(args) != "" {
		output["durable"] = records
		output["durableScan"] = map[string]any{"scanned": scanned, "scanLimit": scanLimit, "scanLimited": limited}
	}
	b, err := json.MarshalIndent(output, "", "  ")
	return string(b), err
}
