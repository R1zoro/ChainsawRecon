# ChainsawRecon Upgrade Plan

> Consolidated roadmap merging the 9-phase research plan and the 14-point Opera-autopsy fixes.
> Each milestone is a checklist; items are checked off as implemented. After each milestone, README + architecture.md are updated and a commit is made.

---

## Milestone 1 — Data Hygiene & Memory Correction
**Goal:** Stop the documented Opera pollution (80 garbage "services"), fix duplicate growth, and enable correction of wrong curated info.

- [x] **M1.1 Host/surface sanitation** — apply `_is_noise_host` + token filters inside `WorldModel.ensure_topology` and both surface builders so `python3 verify_x.py`, `ffuf`, `for t in...`, `auth-context.txt` can never become hosts.
- [x] **M1.2 Memory merge/correct** — same surface fingerprint → `UPDATE` auth_context/tech/confidence instead of INSERT; add `last_seen` + `confidence` so stale facts down-weight and never grow folders unboundedly.
- [x] **M1.3 Cleaner mode** — `--clean` pass: one low-rate top-level probe per curated asset → diff vs. stored state → `cleaner-report.md` (confirmed-live / changed / dead / out-of-scope). Read-only by default; `--clean --apply` merges corrections.
- [x] **M1.4 Curated-memory guard** — phase-one exports sanity-check before writing (no tool-name hosts in architecture.md / world-model.json).

---

## Milestone 2 — Deterministic Hunt Engine
**Goal:** Fix python-everything, garbage findings, and single-endpoint stickiness.

- [x] **M2.1 Tool-first policy** — `recommended_tool_for_surface()` maps surface type → deterministic tool; `is_bulk_python_scan()` bans the "100-endpoint python curl loop" anti-pattern; model writes Python only to verify a single tool signal.
- [x] **M2.2 Endpoint-exhaustion & rotation** — `EndpointExhaustionTracker` counts negative outcomes per (host,path); after 3 repeated 403/404/auth-gate → inject `ENDPOINT EXHAUSTED` and prune from active queue; wired into `ToolRegistry._record_recon_state` and agent target loop.
- [x] **M2.3 Auth-gate awareness** — `AuthGateClassifier` classifies login-wall/sign_in_required as `auth_gate`, never `interesting`; wired into `ToolRegistry._record_surface_outcome`.
- [x] **M2.4 Evidence ladder hardening — 7-Question Gate** — `_classify_finding_rung` replaced with `evaluate_finding_7q()` implementing the structured 7-question gate.

---

## Milestone 3 — Knowledge & Tradecraft
**Goal:** Give the model the answer patterns (the 4k-star lesson).

- [x] **M3.1 Tradecraft skill packs** — added `ssrf_tester`, `xss_tester`, `sqli_tester`, `file_upload_tester`, `oauth_tester`, `race_tester` to `skills.py` (IDOR/JWT/session already existed).
- [x] **M3.2 GraphQL tradecraft pack** — added `graphql_authz` skill: field-level authz, batching, mutation-authz, introspection leakage.
- [x] **M3.3 Report-writing skill** — added `report_writing` skill: VRT-aware severity, impact-first framing, POE completeness, platform templates.
- [x] **M3.4 Search & CVE skill** — new `research.py`: OSV API (keyless, deterministic) + Tavily JSON; wired as `research` tool action in `tools.py`. Never scrapes HTML.
- [x] **M3.5 Recon-aware auto-selection** — `_build_auto_skill_prompt()` in `agent.py` maps discovered surfaces → skill packs and injects them into `_prepare_llm_messages`; no `use_skill` call needed.

---

## Milestone 4 — Controls & Validation
- [x] **M4.1 Rate-limit boundary probing + dynamic maintenance** — new `controls.py`: `RateLimitProbe` probes X/X+1/X+2 once; `DynamicRateLimiter` maintains below the real limit and halves on each 429/403 hit; wired into `CommandRateLimiter` + `_bash` rate-limit detection. `rate_limits` block in `scope.json` already supported.
- [x] **M4.2 Cross-model validation** — `GeminiAdjudicator` (controls.py) re-runs the 7-Question Gate on each finding candidate via Gemini API; wired into `ToolRegistry._record_finding`. Requires `GEMINI_API_KEY`.
- [x] **M4.3 Auto-register cleanup** — `CleanupRegistry` + `atexit` hook (controls.py); agent registers runner/store close callbacks in reverse order; runs on SIGINT/crash/exit.

---

## Milestone 5 — Evidence Capture & Platform Integration
- [ ] **M5.1 Burp proxy capture** — host-side Burp; sandbox routes via `http://host.docker.internal:8080`; every request lands in Burp history passively; optional MCP bridge for replay.
- [ ] **M5.2 Evaluation harness** — vulnerable-lab benchmark (Juice Shop / DVWA) + scorecard so every milestone's improvement is measurable.

---

## Sequencing rationale
- **M1 first** — everything downstream (memory, reports, world model) is built on polluted data; fix the plumbing before the behavior.
- **M2 second** — directly attacks "python-everything + garbage findings + endpoint stickiness."
- **M3 third** — gives the model the tradecraft the 4k-star projects rely on; M2.4's gate needs rich skill context.
- **M4/M5** — hardening + platform tier, partially parallel with M3.

## Defaults assumed
- Cleaning mode: read-only report by default; `--apply` opt-in for auto-corrections.
- Opera rate limits: add conservative `rate_limits` block (e.g., 10 req/min); M4.1 discovers true boundary.
- OSV API: free, no key. Tavily: free `TAVILY_API_KEY` in `.env`. Gemini: free-tier key for M4.2.