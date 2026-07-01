# Bounty Agent

Bounty Agent is a scope-aware bug bounty assistant inspired by the earlier CTF solver architecture. It keeps the same clean boundary:

- the LLM proposes compact JSON actions
- the agent validates scope and command safety
- tools run in a controlled workspace or container
- every action is traced
- final output is a triage/report artifact

The goal is not to blindly exploit programs. The first version helps you reduce noisy recon output into safer next steps, likely false positives, and evidence needed for a valid report.

## Quick Start

Use a conservative local run for an engagement like this:

```powershell
uv run bounty-agent `
  --engagement engagements\acme `
  --mode auto `
  --target https://example.com `
  --provider groq `
  --model groq/llama-3.3-70b-versatile `
  --max-steps 12 `
  --max-repeated-commands 2 `
  --command-delay-seconds 2 `
  --max-commands-per-minute 20 `
  --dry-run
```

If you want the agent to stay strictly in a safe dry-run loop first, keep `--dry-run` in place and remove it only after you are happy with the planned actions.

## Workflow modes

The CLI now supports three explicit workflow modes plus an automatic default:

- mapping: build a lightweight target map, save it to target-map.md, and stop once the map is complete.
- recon: use the target map and prior evidence to enumerate one target at a time with low-rate checks.
- attack: run mapping first when needed, then continue into deeper validation and exploitation-style follow-up.
- auto: choose the safest next phase based on existing evidence.

Example usage:

```powershell
uv run bounty-agent --engagement engagements\acme --mode mapping
uv run bounty-agent --engagement engagements\acme --mode recon
uv run bounty-agent --engagement engagements\acme --mode attack
```

When you provide an engagement folder without a specific `--target`, the agent will infer targets from the engagement's in-scope asset list and use them as the initial run queue.

## Engagement Folders

For real programs, use one folder per engagement:

```text
engagements/<program-name>/
  program/
    scope.json
    prompt.md
    secrets.env
    in-scope.txt
    out-of-scope.txt
    rules.md
  manual/
    notes.md
    findings.md
    report-drafts.md
  agent/
    runs/
```

Use `program/` for the bounty platform's source-of-truth rules, scope, rate limits, and the prompt you want the agent to follow. Use `manual/` for your own discoveries and rough notes. The agent writes traces, workspaces, and reports under `agent/runs/`.

Create a new local engagement from the template:

```powershell
Copy-Item -Recurse engagements\_template engagements\acme
```

Then run against that engagement:

```powershell
uv run bounty-agent `
  --engagement engagements\acme `
  --target https://example.com `
  --provider groq `
  --dry-run
```

The agent automatically loads:

```text
engagements\acme\program\scope.json
engagements\acme\program\prompt.md
```

If present, Docker runs also pass this file into the sandbox:

```text
engagements\acme\program\secrets.env
```

Example `secrets.env`:

```env
API_TOKEN=
OBLDSO=
LDSO=
```

Do not commit real secrets. Real engagement folders are ignored by Git by default.

You can override the prompt file:

```powershell
uv run bounty-agent `
  --engagement engagements\acme `
  --target https://example.com `
  --prompt prompts\my-strategy.md `
  --dry-run
```

To validate the folder and scope without calling any model:

```powershell
uv run bounty-agent `
  --engagement engagements\acme `
  --target https://example.com `
  --no-llm `
  --dry-run
```

Real engagement folders are ignored by Git by default. Only `engagements/_template` is meant to be committed.

Create a program config:

```json
{
  "program_name": "Example Program",
  "allowed_domains": ["example.com", "*.example.com"],
  "excluded_domains": ["admin.example.com"],
  "allowed_urls": ["https://example.com"],
  "notes": "Only test assets explicitly listed as in scope."
}
```

Run a dry recon session:

```bash
uv run bounty-agent --program examples/program.example.json --target https://example.com --dry-run
```

Without `uv`, the equivalent is:

```bash
python -m bounty_agent.cli --program examples/program.example.json --target https://example.com --dry-run
```

Run approved commands inside a Docker sandbox on Kali:

```bash
docker build -f sandbox/Dockerfile.sandbox -t bounty-sandbox .

uv run bounty-agent \
  --program examples/program.example.json \
  --target https://example.com \
  --runner docker \
  --docker-image bounty-sandbox \
  --execute
```

## Docker Space Management

Docker Desktop stores Linux images, containers, volumes, and build cache inside its WSL-managed disk. Kali-based images and repeated rebuilds can consume many GB quickly.

Check current Docker usage:

```powershell
docker system df
docker images
docker ps -a
```

Build the sandbox image intentionally:

```powershell
docker build -f sandbox/Dockerfile.sandbox -t bounty-sandbox .
```

After changing `sandbox/Dockerfile.sandbox`, rebuild the same tag. Docker may keep old intermediate layers in build cache, so inspect usage after rebuild:

```powershell
docker system df
```

Safe cleanup after agent runs:

```powershell
docker container prune
docker builder prune
```

More aggressive cleanup, still usually safe if you only want to remove unused Docker data:

```powershell
docker system prune
```

Heavy cleanup: removes unused images too. This may remove images you will need to download/build again later:

```powershell
docker system prune -a
```

Volume cleanup: only run this if you are sure you do not need Docker volumes from other projects:

```powershell
docker volume prune
```

One command to reset this project's sandbox image only:

```powershell
docker rm -f $(docker ps -aq --filter ancestor=bounty-sandbox)
docker rmi bounty-sandbox
docker builder prune
```

If PowerShell complains about `$(...)` because there are no containers, remove the image directly:

```powershell
docker rmi bounty-sandbox
docker builder prune
```

Recommended habit:

- Run `docker system df` before and after big rebuilds.
- Use `docker builder prune` after several Dockerfile experiments.
- Use `docker system prune -a` only when you are comfortable rebuilding/downloading unused images.
- Avoid `docker volume prune` unless you know other Docker projects do not store important data in volumes.

Use an OpenAI-compatible local model endpoint, such as Ollama on your Windows host:

```bash
uv run bounty-agent \
  --program examples/program.example.json \
  --target https://example.com \
  --model ollama/qwen2.5-coder:7b \
  --llm-base-url http://WINDOWS_HOST_IP:11434/v1 \
  --llm-api-key ollama
```

Use Groq:

```powershell
# .env
GROQ_API_KEY=gsk_your_key_here
```

Then run:

```powershell
$env:UV_CACHE_DIR = Join-Path $env:TEMP 'bounty-agent-uv-cache'

uv run bounty-agent `
  --program examples/program.example.json `
  --target https://example.com `
  --provider groq `
  --model groq/llama-3.3-70b-versatile
```

Groq uses `https://api.groq.com/openai/v1` as the OpenAI-compatible base URL.

Artifacts are written to:

```text
engagements/<program-name>/agent/runs/<timestamp>-<target>/
  trace.jsonl
  report.md
  workspace/
```

## JSON Action Protocol

The model must respond with one JSON object:

```json
{"action":"bash","command":"httpx -json -u https://example.com","timeout_seconds":60}
```

Supported actions:

- `use_skill`
- `bash`
- `search`
- `read_file`
- `write_file`
- `list_files`
- `record_finding`
- `finish`

Commands are checked against target scope before execution.

## Agent Skills

The agent includes built-in playbooks that the model can request during a run:

- `public_research`
- `surface_discovery`
- `fingerprint`
- `scanner_triage`
- `verification_script`
- `finding_triage`

Example:

```json
{"action":"use_skill","name":"public_research","objective":"find public clues for API authorization bugs","context":"baseline headers collected"}
```

The returned skill text is a workflow contract: allowed tools, steps, artifacts, validation checks, and stop conditions. The model still has to execute the steps with normal actions such as `search`, `bash`, `write_file`, and `record_finding`. This is intentional; it keeps the agent auditable and prevents a vague prompt from turning into repeated commands or weak findings.

## Safety Model

- Program scope is loaded before any command runs.
- Commands that reference out-of-scope hosts are blocked.
- `--execute` is required before commands run.
- `--runner docker` starts one long-lived container for the run, mounts the run workspace at `/workspace`, and executes tool calls with `docker exec`.
- The Docker sandbox uses Docker's default bridge network. In normal Docker Desktop setups, the container can reach the internet unless Docker Desktop, Windows firewall, VPN policy, DNS, or your network blocks it. The agent still scope-checks `bash` commands before execution, while the separate `search` action can query public research sources.
- Rate limits can be configured in `program/scope.json` with `rate_limits.delay_seconds` and `rate_limits.max_commands_per_minute`.
- The built-in limiter delays between agent tool calls. For scanners such as `nuclei`, `ffuf`, `httpx`, or `katana`, still use their own rate/concurrency flags according to the program policy.
- `--allow-all-hosts` disables host scope blocking for commands, but it does not disable command safety checks, duplicate-command blocking, rate guards, or destructive-command blocking.
- Prefer accurate `program/scope.json` entries over `--allow-all-hosts` for real bounty programs. Use `--allow-all-hosts` only for your own lab/student target or when you intentionally want public research/search domains to be reachable.
