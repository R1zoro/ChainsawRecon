# ChainsawRecon

ChainsawRecon is a scope-aware, local-LLM bug-bounty reconnaissance and validation agent. It runs approved security tooling inside a Docker sandbox, keeps an auditable trace of every model decision and command, and turns useful observations into durable engagement knowledge.

It is designed to assist authorized testing only. The program scope and rules in an engagement are the source of truth.

## What It Does

- Starts from an engagement rather than a single URL, so all declared in-scope assets can enter a shared target queue.
- Moves through mapping, recon, and attack work while retaining evidence and coverage state across targets.
- Uses a local OpenAI-compatible model server such as Ollama; the model proposes compact JSON actions and never receives host-shell access.
- Executes approved tools in one Docker sandbox per run with scope checks, command-rate limits, and artifact validation.
- Maintains two layers of memory: a disposable run database and a curated engagement database promoted after the run.
- Writes compact reports, a validation queue, and reusable asset catalogs for both future runs and manual testing.
- Supports API, GraphQL, JavaScript, source-map, authentication-surface, and conventional web reconnaissance workflows.

Read the detailed system description in [architecture.md](architecture.md).

## Prerequisites

- Python 3.10+
- Docker Desktop running
- Ollama running locally, with a compatible model already pulled
- An authorized engagement folder created from `engagements/_template`

Build or rebuild the Docker image whenever `sandbox/Dockerfile.sandbox` changes:

```powershell
docker build --pull --no-cache -f sandbox/Dockerfile.sandbox -t bounty-sandbox:latest .
```

The default `--docker-image bounty-sandbox` resolves to the same `:latest` tag, so no CLI change is required. The first build can take a while because Kali packages, Go tools, and Python tools are installed from upstream sources.

Optionally confirm that the key commands are present after the build:

```powershell
docker run --rm bounty-sandbox:latest bash -lc "command -v httpx nuclei katana inql clairvoyance grapeql feroxbuster dalfox"
```

Some optional Python packages are intentionally non-fatal in the Dockerfile because upstream package/CLI names can change. A missing command in this check means that tool should not be selected until the image recipe is adjusted and rebuilt.

## Create an Engagement

```powershell
Copy-Item -Recurse engagements\_template engagements\acme
```

Populate the engagement before executing anything:

```text
engagements/acme/
  program/
    scope.json          # machine-readable scope and rate limits
    in-scope.txt        # optional additional in-scope assets
    out-of-scope.txt    # exclusions
    rules.md            # program rules and constraints
    prompt.md           # concise program-specific testing context
    secrets.env         # optional local-only auth material; do not commit
    priority-targets.txt # optional endpoints to deep-test first
  manual/               # operator notes and report drafts
  agent/                # generated database, asset catalog, reports, and runs
```

Keep credentials, cookies, reports, and target data out of public commits unless the program explicitly permits disclosure.

## Run the Agent

Your current command shape remains valid. `--target` is optional and should normally be omitted when the engagement already contains scope and seed assets.

```powershell
python -m bounty_agent.cli `
  --engagement engagements\<engagement-name> `
  --mode attack `
  --provider ollama `
  --model ollama/chrisdiochavez/ANINOGPT-PILIPINAS-ATAKE:latestv3 `
  --llm-base-url http://localhost:11434/v1 `
  --llm-api-key ollama `
  --runner docker `
  --docker-image bounty-sandbox `
  --execute `
  --max-steps 1500 `
  --max-commands-per-minute 40
```

For a safe planning pass, replace `--execute` with `--dry-run`. Do not use both.

### Modes

| Mode | Use |
|---|---|
| `mapping` | Build or refresh the asset and surface map. No broad attack work. |
| `recon` | Perform low-rate discovery and fingerprinting against mapped targets. |
| `attack` | Runs mapping preflight when necessary, then performs evidence-led verification. |
| `auto` | Selects a safe next phase from existing mapping and engagement memory. |
| `assistant` | Operator-led helper mode. Internet search is allowed only here and only when explicitly requested. |

Autonomous mapping, recon, attack, and auto modes do not use web/GitHub/public-vulnerability searches. They rely on program-provided scope, observed responses, local tools, and stored engagement evidence.

## How a Run Works

1. The CLI loads program scope, exclusions, saved mapping state, and the target queue.
2. The agent opens one run database and the engagement knowledge database.
3. It starts one long-lived Docker sandbox for the run.
4. Deterministic, low-rate startup checks collect baseline information before model-directed work.
5. The model receives a compact retrieval context, current target, coverage gaps, and only the highest-value prior facts.
6. The model emits one JSON action. The agent validates scope, rate limits, repeats, command safety, and artifact quality before executing it.
7. Results become trace events, run facts, surface records, and test-coverage records. New high-value in-scope targets can join the same run queue.
8. On completion, promotable facts are curated into engagement memory and the reports/catalogs are regenerated.

The global `--max-steps` budget is shared across the entire queue. A target change does not grant a new budget. As the remaining budget becomes small, the agent should focus on highest-value coverage, validation, and reporting rather than open-ended queue expansion.

## Outputs

Each run lives under `engagements/<name>/agent/runs/<timestamp>-<seed>/`:

```text
trace.jsonl             # append-only audit log of model responses and tool results
session.state.json      # run status, global progress, queue, and artifact locations
mapping-state.json      # durable structured target map
report.md               # concise run report
validation-queue.json   # hypotheses needing confirmation or reproduction
priority-followups.md   # operator-oriented next actions
interesting-leads.md    # non-validated leads, kept separate from findings
auth-surfaces.md        # authentication-relevant surfaces
workspace/              # validated scripts, evidence, and tool outputs
recon.db                # disposable run-local database
```

The engagement directory accumulates curated memory and reusable catalogs:

```text
agent/knowledge.db           # curated cross-run recon memory
agent/engagement-report.md   # consolidated readable engagement picture
agent/assets/
  all-surfaces.txt
  live-hosts.txt
  urls.txt
  api-endpoints.txt
  graphql-endpoints.txt
  js-bundles.txt
  source-maps.txt
  docs-sdk-endpoints.txt
  auth-surfaces.txt
  test-progress.tsv
```

The run database may contain incomplete or noisy observations. Only promotable facts move into `knowledge.db`; raw research queries are excluded. `test-progress.tsv` is especially useful for selecting a manual follow-up surface without redoing already-covered checks.

## Tooling

The Docker image includes a practical set of discovery, API/GraphQL, and validation tools, including `httpx`, `katana`, `nuclei`, `subfinder`, `dnsx`, `naabu`, `ffuf`, `feroxbuster`, `gobuster`, `dirsearch`, `sqlmap`, `dalfox`, `wafw00f`, `inql`, `clairvoyance`, `grapeql`, `arjun`, `graphql-cop`, `gau`, `waybackurls`, `assetfinder`, and `trufflehog` where available.

Tool availability is checked at run startup. A tool being named in the repository does not guarantee its upstream package installed successfully; use the post-build check above if a specific tool matters to an engagement.

## Authentication

The agent can use operator-supplied authentication context, but autonomous modes do not create accounts or run arbitrary login automation. Prefer a local, uncommitted auth file or Docker env file with the minimum necessary cookies/headers. The agent can record observed authentication surfaces and compare authenticated versus unauthenticated responses when valid context is supplied.

Never place fresh session tokens in a committed `prompt.md`, README, trace, or public issue.

## Safety and Scope

- `--execute` is required before commands run; otherwise actions are traced as dry-run plans.
- Every tool request is scope-checked before it reaches Docker.
- The sandbox is the execution boundary; the model cannot directly execute commands on the host.
- Rate limits and command spacing are configurable in the engagement scope and CLI.
- Repeated commands and malformed actions are controlled to prevent low-value loops.
- WAF/Cloudflare-like blocking is treated as a signal to slow down, preserve evidence, and defer rather than to bypass protections.
- Findings follow a ladder: signal -> hypothesis -> reproduced -> validated. A scanner result alone is not a confirmed vulnerability.

## Development Notes

- Use `rg` for code searches and exclude `runs/`, `__pycache__/`, virtual environments, caches, and large traces unless a specific investigation needs a small excerpt.
- Preserve traces as audit data. Improve reports and structured stores rather than rewriting historical trace files.
- Rebuild `bounty-sandbox` after changing the Dockerfile. Rebuild is unnecessary after Python-only agent changes.
- Review [architecture.md](architecture.md) before making workflow changes: queue, memory, evidence, and reporting are deliberately separate concerns.

## License and Responsible Use

Use ChainsawRecon only against systems for which you have explicit authorization and within the applicable program rules.
