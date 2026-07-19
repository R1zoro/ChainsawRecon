# Task Plan: ChainsawRecon Improvements

## Phase 1: ✅ Read all existing code (done)

## Phase 2: Install new tools in Docker sandbox
- [ ] Add feroxbuster to Dockerfile.sandbox
- [ ] Add inql to Dockerfile.sandbox
- [ ] Add additional useful tools (gau, assetfinder, dalfox, httpx-toolkit, etc.)

## Phase 3: Add new skills (bounty_agent/skills.py)
- [ ] Add graphql_introspection skill
- [ ] Add idor_tester skill
- [ ] Add auth_differential skill (enhance existing)
- [ ] Add source_map_analysis skill
- [ ] Add docs_sdk_extraction skill (enhance existing)

## Phase 4: Update tool registry (bounty_agent/tools.py)
- [ ] Add inql to _TOOL_ACTIONS
- [ ] Add feroxbuster to _TOOL_ACTIONS
- [ ] Add dalfox to _TOOL_ACTIONS
- [ ] Add gau to _TOOL_ACTIONS (already there)
- [ ] Add assetfinder to _TOOL_ACTIONS (already there)

## Phase 5: Architectural fixes
- [ ] Fix surface deduplication (host+path_pattern key, not host+path+auth_context)
- [ ] Filter out-of-scope third-party hosts from surface list
- [ ] Fix early-exit artifact generation (ensure trace/report always written)
- [ ] Mark surfaces "meaningfully tested" only when attack-specific probes ran
- [ ] Fix typo deduplication (trailing backslash variants)
- [ ] Filter 127.0.0.1 and "host" from surfaces
- [ ] Add js_analysis, sourcemap to required attack families for js surfaces