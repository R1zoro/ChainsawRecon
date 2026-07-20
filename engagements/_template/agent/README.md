# Agent Output

Agent-generated runs go here:

```text
agent/runs/<timestamp>-<target>/
  trace.jsonl
  report.md
  workspace/
```

Do not edit `trace.jsonl`; use it as audit evidence.

Shared engagement state is generated beside `runs/` after a run:

```text
agent/knowledge/       # machine-readable objectives, hypotheses, evidence, actions, tool manifest
agent/catalogs/        # human-friendly subdomain, endpoint, architecture, and progress files
agent/assets/          # compatibility asset inventories
```

Use `catalogs/` for manual testing. The agent reads `knowledge/` on future runs
to avoid discarding prior objectives and hypotheses.

Optional `--source-dir` and `--har-file` inputs add local source and browser
evidence to the shared world model. The generated `world-model.json`,
`technologies.json`, and `routes.json` are safe starting points for future
runs; imported browser requests are evidence only and are never replayed by
the import step.
