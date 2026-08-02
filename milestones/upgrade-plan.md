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

- [ ] **M2.1 Tool-first policy** — surface-type → deterministic tool mapping (GraphQL→inql/clairvoyance, SQLi→sqlmap, XSS→dalfox, params→arjun, CVE→nuclei, subdomains→subfinder). Model writes Python only to verify a tool signal; bulk-python "100-endpoint" pattern banned.
- [ ] **M2.2 Endpoint-exhaustion & rotation** — `EndpointExhaustionTracker` counts new evidence per (host,path); N steps of repeated 403/404/auth-gate → inject `ENDPOINT EXHAUSTED` and reprioritize queue.
- [ ] **M2.3 Auth-gate awareness** — `sign_in_required`/login-wall classified as `auth_gate`, never `interesting`; pivot to authenticated surfaces only if auth.txt exists.
- [ ] **M2.4 Evidence ladder hardening — 7-Question Gate** — replace heuristic `_classify_finding_rung` with structured gate (in-scope, reproducible, real impact, not auth-gate, business relevance, VRT severity, evidence complete).

---

## Milestone 3 — Knowledge & Tradecraft
**Goal:** Give the model the answer patterns (the 4k-star lesson).

- [ ] **M3.1 Tradecraft skill packs** — per-vuln-class packs (IDOR, SSRF, XSS, SQLi, file-upload, OAuth, JWT, race) with detection patterns, payloads, bypass tables, chain templates. Auto-load by discovered surface topic.
- [ ] **M3.2 GraphQL tradecraft pack** — introspection templates, field-level authz checks, batching, mutation-authz payloads from disclosed reports.
- [ ] **M3.3 Report-writing skill** — H1/Bugcrowd/Intigriti templates, VRT-aware severity, impact-first framing, POE completeness. `engagement-report.md` becomes submission-grade.
- [ ] **M3.4 Search & CVE skill** — OSV API (deterministic, no key) for (product, ecosystem, version) → CVEs; Tavily JSON for general research. Never scrape HTML.
- [ ] **M3.5 Recon-aware auto-selection** — reuse `_required_attack_families_for_surface`: discovered GraphQL → auto-inject GraphQL skill + tool list, no `use_skill` call needed.

---

## Milestone 4 — Controls & Validation
- [ ] **M4.1 Rate-limit boundary probing + dynamic maintenance** — probe X/X+1/X+2 once, record real limit as a fact, `CommandRateLimiter` maintains below it; rate-limit hits tracked as a first-class category. Add `rate_limits` block to Opera scope.json.
- [ ] **M4.2 Cross-model validation** — Ollama primary + Gemini API adjudicator runs the 7-Question Gate on each finding candidate.
- [ ] **M4.3 Auto-register cleanup** — reverse-order cleanup registry on SIGINT/crash/exit.

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