# Benchmark Scorecard — dvwa

**Target:** `http://localhost:3000`
**Started:** 2026-08-04T16:04:23+00:00

## Recall (Milestone 2 + 3 gates)
- Expected findings: 6
- True positives found: 0
- **Recall: 0.0%**
- Matched: none

## Precision (M4.2 adjudicator + 7-Question Gate)
- Findings recorded: 0
- False positives blocked by gates: 0

## Controls (M4.1 rate limiting)
- Rate-limit hits (429/403) observed: 0
- Total events tracked: 6

## Events
- **[m5_harness]** expected_finding:juice-reflected-xss — FAIL = 0.0 (finding_expected)
- **[m5_harness]** expected_finding:juice-idor-rest — FAIL = 0.0 (finding_expected)
- **[m5_harness]** expected_finding:juice-ssti — FAIL = 0.0 (finding_expected)
- **[m5_harness]** expected_finding:juice-sql-comment — FAIL = 0.0 (finding_expected)
- **[m5_harness]** expected_finding:juice-qs-injection — FAIL = 0.0 (finding_expected)
- **[m5_harness]** expected_finding:juice-secrets — FAIL = 0.0 (finding_expected)
