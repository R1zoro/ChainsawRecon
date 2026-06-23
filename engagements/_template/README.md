# Engagement Template

Copy this folder to a new local engagement folder, for example:

```powershell
Copy-Item -Recurse engagements\_template engagements\acme
```

Suggested use:

- `program/`: source-of-truth scope, rules, exclusions, and program notes
- `manual/`: your own observations, hypotheses, screenshots list, and report drafts
- `agent/`: agent-generated runs, traces, workspaces, and reports

Keep sensitive real program data out of public commits unless the program allows disclosure.
