# ChainsawRecon

**ChainsawRecon** is an autonomous, scope-aware AI penetration testing and security assessment agent. It orchestrates security tools inside an isolated Docker sandbox, builds a stateful world model of web applications and APIs, and executes hypothesis-driven experiments with concrete evidence validation.

Designed for authorized penetration testing, security audits, and defensive surface assessment, ChainsawRecon bridges high-level AI reasoning with deterministic, auditable execution.

---

## 🌟 Key Features

* **Stateful World Model & Engagement Memory:** Maintains persistent relational state (organizations, applications, services, routes, endpoints, auth contexts, technologies) across test runs rather than treating each target in isolation.
* **Hypothesis Lifecycle & Objective-Driven Work:** Moves beyond tool-centric output. Replaces raw scanner outputs with structured hypothesis tracking (`observed` $\rightarrow$ `suspected` $\rightarrow$ `evidence_required` $\rightarrow$ `experiment_planned` $\rightarrow$ `reproduced` $\rightarrow$ `validated`/`rejected`).
* **Isolated Sandbox Execution:** All command execution occurs inside a locked-down Docker container. The LLM never has host-shell access or direct system access.
* **Scope Guard & Rate Control:** Strict pre-execution scope verification for every single outbound tool request, with configurable rate limits and request spacing.
* **Multi-Modal Evidence Capture:** Imports and normalizes HTTP requests/responses, HAR browser captures, technology playbooks, and static source-code analysis into canonical, replayable evidence items.
* **Independent Validation Engine:** Findings follow an evidence ladder and must pass independent replay and differential control testing before classification.
* **Deterministic Hunt Engine (M2):** Tool-first policy steers the model to dedicated security tools over generic Python loops; endpoint-exhaustion tracking prunes dead endpoints; auth-gate awareness prevents login walls from being reported as findings; a 7-Question Gate validates every finding candidate.
* **Knowledge & Tradecraft (M3):** Per-vuln-class skill packs (IDOR, SSRF, XSS, SQLi, upload, OAuth, race, GraphQL authz) auto-load based on discovered surfaces; a report-writing skill produces submission-grade write-ups; deterministic OSV/Tavily research probes replace HTML scraping.
* **Playwright Auth Pipeline:** Deterministic Firefox login worker for simple id+password apps. Credentials are read from environment variables named in the engagement auth JSON — never written to spec files, prompts, traces, or artifacts. Supports cookie capture, operator-maintained cookie renewal, and verify-only session checks. Sessionless in-scope subdomains stay on the unauthenticated mapping lane.
* **Verified Burp MCP Adapter:** Tool catalog, wire format, and pagination verified against the live PortSwigger `mcp-server` extension (default `http://127.0.0.1:9876`). History entries get stable synthesized ids (`index-hash`) so the model can search → retrieve → replay → compare → open Repeater tabs against real captures.
* **Deterministic Worker Gate, Nuclei Action & Surface Router:** Worker action contracts are hard-blocked at dispatch (not just prompt guidance); nuclei runs as a typed, scope-checked action with JSONL evidence parsing; a fingerprinting surface router picks the specialist lane with a burned-rung fallback ladder.
* **ASM-Style Asset Staleness:** World-model assets (services, routes, technologies) carry `last_seen`; anything not re-observed within 30 days is flagged as stale in the architecture summary instead of being trusted forever.
* **Human-Readable Catalogs & Machine-Readable State:** Generates both SQLite/JSON knowledge graphs for AI reasoning and clean Markdown/TSV catalogs for manual testing and reporting.

---

## 🛠️ Architecture & How It Works

ChainsawRecon operates across four structured layers:

1. **AI Orchestration & Reasoning Layer:** The Coordinator model receives target scope, current world model state, coverage gaps, and active security objectives. It selects structured JSON actions rather than executing unverified shell commands.
2. **Worker & Strategy Layer:** Bounded execution flows handle specialized tasks (Target Mapping, Technology Analysis, API/GraphQL Surface Probing, Auth Context Evaluation, and Result Validation).
3. **Tool & Sandbox Execution Layer:** Executes approved tools (`httpx`, `katana`, `nuclei`, `ffuf`, `dalfox`, `sqlmap`, `inql`, `clairvoyance`, etc.) inside a sandboxed environment managed by a strict `ScopeGuard`.
4. **Data & Knowledge Memory Layer:** Dual-database design featuring a disposable **Run Store** (`recon.db`) for transient trial data and a persistent **Engagement Store** (`knowledge.db`) for verified cross-run intelligence and target topology.

---

## 📋 Prerequisites

* **OS:** Linux, macOS, or Windows (PowerShell/WSL2)
* **Python:** 3.10 or higher
* **Docker:** Docker Desktop or Docker Engine running locally
* **Local LLM Server (Optional / Recommended):** Ollama, vLLM, LM Studio, or any OpenAI-compatible API endpoint.
* **Git**

---

## 🚀 Quick Start & Setup Guide

### 1. Clone the Repository & Setup Python Environment

```bash
git clone https://github.com/your-org/ChainsawRecon.git
cd ChainsawRecon

# Create and activate virtual environment
python -m venv .venv

# On Linux/macOS:
source .venv/bin/activate
# On Windows (PowerShell):
# .venv\Scripts\Activate.ps1

# Install dependencies in editable mode
pip install -e .
```

### 2. Build the Docker Execution Sandbox

The security tools run inside a dedicated Docker container (`testing-sandbox`). Build the image locally:

```bash
docker build --pull --no-cache -f sandbox/Dockerfile.sandbox -t testing-sandbox:latest .
```

> **Note:** The initial build installs security utilities, Go binaries, and web runtime tools (e.g., `httpx`, `katana`, `nuclei`, `ffuf`, `dalfox`, `sqlmap`, `inql`). This may take a few minutes.

Verify sandbox tool installation:

```bash
docker run --rm bounty-sandbox:latest bash -lc "command -v httpx nuclei katana inql feroxbuster dalfox"
```

### 3. Configure API Keys (`.env`)

Copy the template and add your keys. The CLI loads `.env` from the project root at startup:

```bash
cp .env.example .env
```

Add the following to `.env`:

```bash
# LLM provider (Ollama or Groq)
OLLAMA_API_KEY=ollama
# or GROQ_API_KEY=gsk_your_key_here

# Tavily search (optional, for M3.4 research skill)
# Get a free key at https://tavily.com
TAVILY_API_KEY=tvly-your-key-here
```

> **Tavily key location:** The `TAVILY_API_KEY` goes in the root `.env` file. The `research` tool action reads it via `os.environ.get("TAVILY_API_KEY")` at runtime. Without it, Tavily search returns a clear "unavailable" message and the agent falls back to the keyless OSV API.

### 4. Start Your Local LLM Provider (e.g., Ollama)

Ensure your LLM provider is running locally and serving an OpenAI-compatible API endpoint:

```bash
# Example with Ollama:
ollama serve
# Pull your preferred model (e.g., Qwen2.5-Coder, Mistral, Llama-3, etc.)
ollama pull qwen2.5-coder:14b
```

---

## 📁 Setting Up an Engagement Workspace

ChainsawRecon organizes assessment data into engagement directories.

### 1. Initialize an Engagement Directory

```powershell
# Copy template directory
Copy-Item -Recurse engagements\_template engagements\corporate-audit
```

### 2. Configure Scope and Rules

Populate the program definition files inside `engagements/corporate-audit/program/`:

* `scope.json`: Machine-readable target domains, CIDRs, and rate limits.
* `in-scope.txt`: List of authorized target URLs and hostnames.
* `out-of-scope.txt`: Excluded IP addresses or domains.
* `rules.md`: Assessment rules, testing windows, and operational constraints.
* `prompt.md`: High-level security goals or application context for the agent.
* `secrets.env`: *(Optional)* Auth tokens or test credentials. Keep git-ignored.
* `priority-targets.txt`: *(Optional)* High-value routes/APIs to assess first.

---

## 💻 Usage & CLI Reference

Run ChainsawRecon against an initialized engagement:

```bash
python -m bounty_agent.cli \
  --engagement engagements/corporate-audit \
  --mode attack \
  --provider ollama \
  --model ollama/qwen3.5:4b \
  --llm-base-url http://localhost:11434/v1 \
  --llm-api-key ollama \
  --runner docker \
  --docker-image testing-sandbox \
  --execute \
  --max-steps 1000 \
  --max-commands-per-minute 40
```

### Burp MCP request workflow

Burp MCP is the preferred Burp integration. The agent searches requests
captured by Burp, retrieves full request/response bodies only when needed,
creates Repeater experiments from captured templates, applies narrow patches,
and stores the complete result as an engagement artifact. It does not require
the model to reconstruct cookies, CSRF values, or browser headers manually.

Start Burp Suite with the MCP extension enabled and use the endpoint and
transport shown by that extension (default `http://127.0.0.1:9876`). The
endpoint is host-side; it normally must not be placed inside the Docker
sandbox.

PowerShell example:

```powershell
python -m bounty_agent.cli `
  --engagement engagements\Pixabay `
  --mode attack `
  --provider ollama `
  --model ollama/qwen3.5:4b `
  --llm-base-url http://localhost:11434/v1 `
  --llm-api-key ollama `
  --runner docker `
  --docker-image bounty-sandbox `
  --execute `
  --auth-file engagements\Pixabay\program\auth.json `
  --burp-mcp-url http://127.0.0.1:9876 `
  --burp-mcp-transport sse `
  --max-steps 600 `
  --max-commands-per-minute 50
```

Use `--burp-mcp-transport streamable-http` when the extension exposes an MCP
streamable HTTP endpoint instead of SSE. Add `--burp-mcp-token` only when the
extension is configured to require a bearer token. `--burp-api-url` and
`--burp-api-key` remain deprecated compatibility flags for the older REST
path; they are not needed for MCP.

At run start, ChainsawRecon performs a non-fatal MCP health and capability
preflight. The result is written to the trace. If Burp is closed or the
extension exposes insufficient capabilities, the run continues with the
remaining mapping/CLI tools and the MCP actions return an actionable error.
The exact extension tool names are discovered at runtime through `tools/list`
and mapped to the agent's stable semantic actions.

### Authentication lanes

Each run registers an engagement-level session lane in
`knowledge/sessions.db`. The database stores session identity, source, role,
status, expiry/validation metadata, and Burp rule references; it does not store
raw cookies or bearer values. Existing `--auth-file`/`--auth-context` inputs
remain supported.

Choose the acquisition mode explicitly when needed:

```powershell
--auth-mode operator-handover `
--auth-session-alias PixabayLogin `
--auth-wait-timeout 300
```

Use `recorded-login` for a Burp session-handling rule or recorded flow,
`operator-handover` when the operator authenticates in the visible browser,
`credentials` only with a configured local secret reference, and `none` for
unauthenticated mapping. The model receives only a compact lane status and
retrieves full cookies or requests through the explicitly selected Burp/auth
action when the testing hypothesis requires them.

### Playwright login pipeline (simple id+password apps)

For basic user/pass web apps, the agent can acquire and maintain the session
itself. Add a top-level `"login"` block to the engagement auth JSON:

```json
{
  "login": {
    "url": "https://app.example.com/login",
    "username_env": "CHAINSAW_AUTH_USERNAME",
    "password_env": "CHAINSAW_AUTH_PASSWORD",
    "success_url_contains": "/dashboard",
    "verify_url": "https://app.example.com/account",
    "verify_indicator": "Sign out",
    "session_alias": "main-user",
    "role": "user",
    "maintain_cookies": ["remember_me"]
  }
}
```

The block names **environment variables**, never secret values — put the
actual credentials in `.env` / `secrets.env`. The agent gains four actions:

| Action | Behaviour |
|---|---|
| `session_status` | Lists session lanes for the engagement and their state. |
| `perform_login` | Runs a deterministic Playwright Firefox login in the sandbox, captures cookies/storage, registers an `active` lane. |
| `verify_session` | Cookie-injection check of the stored cookies against `verify_url`; marks the lane `active`/`expired`. |
| `renew_session` | Marks the lane stale and re-runs the login, preserving `maintain_cookies` entries the fresh login did not re-issue. |

Optional `username_selector` / `password_selector` / `submit_selector` /
`success_selector` keys override the built-in autodetect fallbacks. A lane
only covers the cookie domains the target sets; in-scope subdomains without a
session remain on the unauthenticated mapping lane (httpx/katana/nuclei).

### Modes of Operation

| Mode | Description | Primary Focus |
|---|---|---|
| `mapping` | Asset discovery & target mapping. | Discovers hosts, routes, technologies, JS bundles, and endpoints. No intrusive testing. |
| `recon` | Active fingerprinting & surface analysis. | Low-rate surface probing, header inspection, and framework classification. |
| `attack` | Hypothesis generation & evidence-led testing. | Executes safe, structured security experiments based on discovered surfaces. |
| `auto` | Self-directed phase transition. | Automatically moves from mapping $\rightarrow$ recon $\rightarrow$ attack based on state coverage. |
| `assistant` | Operator-assisted interactive mode. | Allows explicit external search queries and operator guidance. |

### Key CLI Flags

* `--engagement <path>`: *(Required)* Path to the target engagement folder.
* `--mode <mapping|recon|attack|auto|assistant>`: Execution mode (default: `auto`).
* `--execute`: Enables live tool execution inside the sandbox container.
* `--dry-run`: Runs the planner in simulation mode without executing external commands.
* `--provider <ollama|groq|gemini|openrouter|nvidia>`: LLM provider backend type. NVIDIA uses the OpenAI-compatible hosted NIM endpoint at `https://integrate.api.nvidia.com/v1`.
* `--model <model_name>`: Model identifier specified in your provider backend.
* `--llm-base-url <url>`: API endpoint URL (e.g., `http://localhost:11434/v1`).
* `--max-steps <int>`: Global step/action budget for the session.
* `--max-commands-per-minute <int>`: Enforces rate throttling for outbound commands.
* `--har-file <path.har>`: *(Optional)* Import network traffic captures into the engagement evidence model.
* `--source-dir <path>`: *(Optional)* Import static source code directory for route and sink analysis.

---

## 🔒 Safety Controls & Execution Boundary

1. **Docker Isolation:** Tools run inside a container with dropped capabilities, non-root execution, and CPU/RAM limits.
2. **ScopeGuard Enforcement:** Every domain or IP target is verified against `scope.json` before any action executes.
3. **No Unsanitised Shell Access:** The LLM issues strict JSON-formatted actions (`run_tool`, `write_file`, `http_request`, `finish`), which are parsed and validated deterministically before execution.
4. **Evidence Ladder:** A raw tool hit never creates a finding directly. It generates an `observation`, which creates a `hypothesis`, requiring an `experiment`, raw `evidence`, and independent `reproduction`.
5. **WAF & Failure Awareness:** Cloudflare or rate-limiting responses trigger automatic back-off, evidence preservation, and task deferral rather than noisy brute-force attempts.

---

## 📊 Artifacts & Outputs

After execution, all session records are saved under `engagements/<name>/agent/`:

```text
engagements/<name>/agent/
├── knowledge.db              # Curated cross-run persistent relational database
├── engagement-report.md      # Comprehensive executive & technical report
├── catalogs/                 # Operational human-readable catalogs
│   ├── architecture.md       # Target topology, services, and tech stack map
│   ├── routes.json           # Discovered application endpoints and HTTP methods
│   ├── technologies.json     # Detected software stacks & component playbooks
│   └── world-model.json      # Exported machine-readable knowledge graph
└── runs/<timestamp>/         # Execution artifacts per session
    ├── trace.jsonl           # Complete audit log of every LLM decision & command
    ├── report.md             # Per-run technical summary
    ├── session.state.json    # Run status, metrics, and step accounting
    └── workspace/            # Raw tool outputs, evidence items, and HTTP logs
```

---

## 📜 License & Compliance

ChainsawRecon is designed exclusively for authorized security testing, defensive posture assessment, and educational research. Users are responsible for obtaining explicit authorization from asset owners before initiating any security assessment.
