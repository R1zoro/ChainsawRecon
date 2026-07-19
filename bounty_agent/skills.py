from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentSkill:
    name: str
    purpose: str
    when_to_use: str
    allowed_tools: tuple[str, ...]
    steps: tuple[str, ...]
    artifacts: tuple[str, ...]
    validation: tuple[str, ...]
    stop_conditions: tuple[str, ...]

    def compact(self) -> str:
        return (
            f"- {self.name}: {self.purpose}\n"
            f"  Use when: {self.when_to_use}\n"
            f"  Tools: {', '.join(self.allowed_tools)}"
        )

    def full(self) -> str:
        sections = [
            f"Skill: {self.name}",
            f"Purpose: {self.purpose}",
            f"When to use: {self.when_to_use}",
            "Allowed tools: " + ", ".join(self.allowed_tools),
            "Steps:\n" + "\n".join(f"{index}. {step}" for index, step in enumerate(self.steps, start=1)),
            "Artifacts:\n" + "\n".join(f"- {artifact}" for artifact in self.artifacts),
            "Validation:\n" + "\n".join(f"- {item}" for item in self.validation),
            "Stop conditions:\n" + "\n".join(f"- {item}" for item in self.stop_conditions),
        ]
        return "\n\n".join(sections)


BUILTIN_SKILLS: dict[str, AgentSkill] = {
    "target_mapping": AgentSkill(
        name="target_mapping",
        purpose="Create a small target map before enumeration or vulnerability hunting.",
        when_to_use="At the start of every run, before crawlers, scanners, or brute-force style enumeration.",
        allowed_tools=("bash:curl", "read_file", "write_file", "list_files"),
        steps=(
            "Read the program scope, prompt, and rules already provided in the system context.",
            "Identify the root target, allowed domains, excluded domains, allowed URLs, and credentials available through environment variables.",
            "Fetch only low-impact baseline resources: headers, robots.txt, sitemap.xml, and obvious app/API landing pages.",
            "Separate surfaces into marketing site, application, API, docs, auth/account, static assets, and unknown.",
            "Write a target-map.md file with assets, known paths, auth state, exclusions, rate-limit notes, and planned next enumeration commands.",
        ),
        artifacts=("target-map.md",),
        validation=(
            "The target map exists before broad enumeration or scanners.",
            "The map distinguishes in-scope assets from excluded or unknown assets.",
            "The next enumeration step is chosen from the mapped surfaces, not from a single repeated endpoint.",
        ),
        stop_conditions=(
            "The target is out of scope.",
            "Baseline requests are blocked or network access fails; document the failure in target-map.md.",
        ),
    ),
    "public_research": AgentSkill(
        name="public_research",
        purpose="Build outside-in context from public sources before probing deeper.",
        when_to_use="At the beginning of every engagement and whenever a product, framework, endpoint, or error string is observed.",
        allowed_tools=("search", "bash:curl for public pages", "read_file", "write_file"),
        steps=(
            "Start from observed technologies, SDK names, frameworks, docs generators, headers, GraphQL, API gateways, JS bundles, or auth products rather than only the company name.",
            "Search GitHub for exact technologies, SDK examples, leaked endpoint names, operation names, public issues, and example API paths.",
            "Search Medium or bug bounty writeups for the observed technology plus the relevant bug class such as GraphQL authz, IDOR, XSS, SSRF, upload abuse, or cache poisoning.",
            "Search Stack Overflow for exact framework errors, route names, schema behavior, SDK usage, or API behavior seen in responses.",
            "Search CVE Details and Snyk for named products, packages, docs generators, frontend libraries, gateways, WAFs, or GraphQL stacks that were actually observed.",
            "Write short notes to a workspace file with useful terms, endpoints, technologies, and false-positive warnings.",
        ),
        artifacts=("research-notes.md", "search result URLs with one-line relevance notes"),
        validation=(
            "At least four distinct searches were performed.",
            "At least three source families are covered: GitHub, Medium, Stack Overflow, CVE Details, Snyk.",
            "Notes identify next probes or explain why public leads were not relevant.",
        ),
        stop_conditions=(
            "Search engines block all results after retrying a different engine.",
            "The next step is obvious and low-risk enough to move into discovery or verification.",
        ),
    ),
    "surface_discovery": AgentSkill(
        name="surface_discovery",
        purpose="Find in-scope hosts, paths, parameters, and application surfaces without noisy brute force.",
        when_to_use="After baseline curl checks or when the model is stuck on one endpoint.",
        allowed_tools=("katana", "subfinder", "waybackurls", "gau", "assetfinder", "amass", "ffuf", "gobuster", "dirsearch"),
        steps=(
            "Enumerate known in-scope hosts from scope files, sitemaps, robots, certificate transparency, or passive tools.",
            "Crawl the target with low rate and low concurrency.",
            "Collect historical URLs only for allowed hosts and deduplicate them.",
            "Optionally run a tiny directory or parameter check with explicit rate, thread, or delay controls.",
            "Save candidates to workspace files and prioritize by authentication boundary, tenant/account identifiers, upload/import/export, redirects, and API routes.",
        ),
        artifacts=("hosts.txt", "urls.txt", "interesting-surfaces.md"),
        validation=(
            "All saved hosts are in allowed scope.",
            "Commands include explicit low-rate or low-concurrency flags where applicable.",
            "At least three distinct in-scope hosts or application surfaces are considered before finishing.",
        ),
        stop_conditions=(
            "The program scope has only one reachable host and no additional surfaces are discovered.",
            "Rate limits or scope rules make further enumeration unsafe.",
        ),
    ),
    "docs_sdk_analysis": AgentSkill(
        name="docs_sdk_analysis",
        purpose="Turn documentation and SDK pages into concrete application and API test paths.",
        when_to_use="When docs, SDK pages, sample snippets, import/export guides, auth guides, or code examples are discovered.",
        allowed_tools=("read_file", "write_file", "search", "bash:curl", "bash:python3"),
        steps=(
            "Extract SDK names, client/server examples, sample endpoints, auth headers, environment keys, callback paths, and example object identifiers.",
            "Map documentation snippets back to real in-scope hosts such as app, api, graphql, relay, stream, or observability surfaces.",
            "Prioritize snippets that show auth headers, API versions, file import/export, webhook callbacks, GraphQL operations, or tenant/project/environment identifiers.",
            "Save a concise notes file with doc-derived surfaces, copied sample paths, and exact next validation ideas.",
            "Write a small Python script that replays the most promising documented API call against the real target and compares documented vs actual behavior.",
        ),
        artifacts=("docs-sdk-notes.md", "doc-derived-endpoints.txt", "verify_doc_endpoint.py"),
        validation=(
            "The notes identify at least one real follow-up endpoint, header, operation, or object pattern from documentation.",
            "Docs findings are mapped to in-scope application or API surfaces rather than left as generic reading notes.",
            "At least one documented endpoint is replayed against the real target with a verification script.",
        ),
        stop_conditions=("No meaningful docs or SDK content is reachable within scope.",),
    ),
    "graphql_introspection": AgentSkill(
        name="graphql_introspection",
        purpose="Extract GraphQL schema, mutations, subscriptions, and operation details from discovered GraphQL endpoints.",
        when_to_use="When a GraphQL endpoint is discovered (e.g., /graphql, /api/v2/graphql, /graph).",
        allowed_tools=("inql", "clairvoyance", "grapeql", "read_file", "write_file", "bash:curl", "bash:python3"),
        steps=(
            "Send a POST request with a standard introspection query to the GraphQL endpoint and capture the full schema response.",
            "If introspection is blocked, try alternative fields like __schema, __type, and __typename with specific type names.",
            "Extract all query types, mutation types, subscription types, and their arguments/return types from the schema.",
            "Identify mutations that modify state (create, update, delete, upload, import, transfer) — these are high-value targets.",
            "Look for deprecated fields, debug fields, admin fields, and fields that accept raw IDs without authorization checks.",
            "Save the schema to workspace evidence file. Write a Python script that sends a bounded test mutation or query against the most promising operation.",
            "Record the identified GraphQL engine and select follow-up tests from observed schema behavior; internet research is assistant-only.",
        ),
        artifacts=("graphql-schema.txt", "graphql-operations.md", "verify_graphql.py"),
        validation=(
            "The schema or at least partial type information was extracted or a clear block reason was documented.",
            "At least one mutation or sensitive query was identified and tested with a bounded probe.",
            "Search results for the GraphQL engine's known vulnerabilities are saved.",
        ),
        stop_conditions=("GraphQL endpoint is completely blocked or returns 404 on all probe variants after three attempts.",),
    ),
    "idor_tester": AgentSkill(
        name="idor_tester",
        purpose="Test API and application endpoints for Insecure Direct Object Reference (IDOR) by swapping identifiers across auth contexts.",
        when_to_use="When an API endpoint, GraphQL field, or web page uses an identifier parameter (tenant ID, user ID, object ID, account number, flag key, etc.).",
        allowed_tools=("read_file", "write_file", "bash:curl", "bash:python3"),
        steps=(
            "Identify the parameter that acts as an object or tenant identifier from the surface or previous responses (e.g., flag key, project ID, user UUID, account number, tenant slug).",
            "Capture the baseline unauthenticated response for the endpoint.",
            "Capture the authenticated response with a valid token/cookie for your own test identifier.",
            "Swap the identifier with a different plausible value (increment, decrement, related UUID format, another tenant's flag, 'admin', '00000000-0000-0000-0000-000000000000', etc.).",
            "Compare the swapped-identifier response against the baseline: same data = IDOR, error = proper access control, different data for your own tenant = investigate further.",
            "Try the swapped identifier in both unauthenticated and authenticated contexts.",
            "Write a verification script that performs the three-way comparison systematically and saves results.",
        ),
        artifacts=("idor-evidence.txt", "verify_idor.py"),
        validation=(
            "At least two different identifier values were tested against the same endpoint.",
            "The unauthenticated vs authenticated vs swapped-identifier responses are compared and saved.",
            "If any endpoint returned data for a different identifier without authorization, that is a validated finding.",
        ),
        stop_conditions=("No identifier-based endpoints were discovered. The surface is entirely static.",),
    ),
    "auth_differential": AgentSkill(
        name="auth_differential",
        purpose="Compare anonymous, authenticated, and modified-auth behavior on the same surface.",
        when_to_use="When auth flows, cookies, bearer tokens, tenant identifiers, or account/session surfaces are present.",
        allowed_tools=("read_file", "write_file", "bash:curl", "bash:python3"),
        steps=(
            "Select one surface and capture the baseline unauthenticated response.",
            "Replay the same request with valid auth context when available.",
            "Replay one bounded variant with a changed identifier, header, cookie, or role hint to test tenant or object binding.",
            "Save a structured differential artifact showing request deltas, response deltas, and why the difference matters.",
            "Write a script that compares response status codes, body length, specific header values, and key JSON fields between auth contexts.",
        ),
        artifacts=("auth-differential.md", "verify_auth_*.py"),
        validation=(
            "At least two auth contexts are compared for the same surface.",
            "The saved artifact explains whether the difference indicates normal access control, auth boundary enforcement, or suspicious leakage/bypass.",
        ),
        stop_conditions=("No auth context is available and no meaningful auth-sensitive response can be compared.",),
    ),
    "source_map_analysis": AgentSkill(
        name="source_map_analysis",
        purpose="Download JavaScript source maps from discovered JS bundles and extract embedded API endpoints, SDK keys, operation names, and configuration secrets.",
        when_to_use="When JavaScript files (.js, .mjs) or source map references (sourceMappingURL) are discovered.",
        allowed_tools=("read_file", "write_file", "bash:curl", "bash:python3", "search"),
        steps=(
            "Identify JS bundle URLs from page source, network responses, or discovered surfaces — prioritize large bundles (.js files > 50KB) and those with 'sourceMappingURL' comments.",
            "Download the JS bundle and check for sourceMappingURL at the end of the file. If present, construct the source map URL (same path + .map extension, or relative path from sourceMappingURL).",
            "Download the source map (.map file) if accessible. Source maps contain the 'sources' and 'sourcesContent' arrays with original source code.",
            "Extract API endpoints, GraphQL operation names, SDK keys, auth token examples, internal hostnames, and configuration values from the source map content.",
            "Search the extracted endpoints against known Github issues, CVE databases, or bug bounty writeups specific to the technology stack.",
            "Save extracted endpoints and secrets to workspace files with source attribution. Do NOT commit sensitive values.",
        ),
        artifacts=("sourcemap-endpoints.txt", "sourcemap-secrets.txt", "verify_sourcemap_endpoint.py"),
        validation=(
            "At least one JS bundle was checked for sourceMappingURL.",
            "If a source map was downloaded, endpoints or operations were extracted.",
            "At least one extracted endpoint was tested with a bounded curl or Python request.",
        ),
        stop_conditions=("No JS bundles are accessible. Source maps return 404 on all discovered bundles.",),
    ),
    "fingerprint": AgentSkill(
        name="fingerprint",
        purpose="Identify technologies, WAF behavior, headers, and response patterns before vulnerability checks.",
        when_to_use="Before scanners or when choosing a CWE/CVE research path.",
        allowed_tools=("httpx", "wafw00f", "curl", "whatweb"),
        steps=(
            "Probe key in-scope hosts with headers, title, status, redirects, and technologies.",
            "Run WAF fingerprinting once per host with conservative timing.",
            "Compare unauthenticated and authenticated responses when credentials are available.",
            "Save technology and security-control notes to the workspace.",
        ),
        artifacts=("fingerprint.md", "headers or httpx JSON output"),
        validation=(
            "At least one fingerprinting tool was used.",
            "The result informs a next test, search, or scanner selection.",
        ),
        stop_conditions=("Responses are blocked by scope or network failure.",),
    ),
    "scanner_triage": AgentSkill(
        name="scanner_triage",
        purpose="Run one focused, low-rate scanner and manually triage any signal.",
        when_to_use="After research, discovery, and fingerprinting have produced a concrete target surface.",
        allowed_tools=("nuclei", "nikto", "xsstrike", "sqlmap"),
        steps=(
            "Choose one scanner that matches the surface and technology.",
            "Run it with explicit low-rate, low-concurrency, batch, or delay flags.",
            "Treat scanner output as leads only, never as final proof.",
            "Verify any lead with a minimal request or a small Python script.",
        ),
        artifacts=("scanner-output.txt", "triage-notes.md"),
        validation=(
            "At least one focused scanner command ran successfully or failed with a documented reason.",
            "No finding is recorded from scanner text alone.",
        ),
        stop_conditions=("The scanner would require intrusive payloads or high request volume.",),
    ),
    "verification_script": AgentSkill(
        name="verification_script",
        purpose="Convert a repeated manual probe into one clear, low-rate Python verification script.",
        when_to_use="Whenever curl commands start repeating or a possible finding needs exact reproduction.",
        allowed_tools=("write_file", "bash:python3", "read_file"),
        steps=(
            "Write a small Python script that sends one or a few explicit requests.",
            "Include timeout, no loops unless bounded, and print status, selected headers, and short body excerpts.",
            "Use cookies or tokens from environment variables without printing secret values.",
            "Run the script once and save its output as evidence or notes.",
        ),
        artifacts=("verify_*.py", "verification-output.txt"),
        validation=(
            "A workspace Python file was written.",
            "The script executed successfully or failed with a useful, scoped error.",
            "The output contains enough request/response detail to support or reject the hypothesis.",
        ),
        stop_conditions=("The hypothesis requires destructive testing or accessing other users' data.",),
    ),
    "public_api_fuzzer": AgentSkill(
        name="public_api_fuzzer",
        purpose="Fuzz public API endpoints for data leakage, rate limiting bypass, and information disclosure on unauthenticated endpoints.",
        when_to_use="When public API endpoints are discovered (e.g., /api/v1/market, /api/v1/ticker, /api/v1/search, /api/v1/property).",
        allowed_tools=("bash:curl", "bash:python3", "write_file", "read_file"),
        steps=(
            "Identify public API endpoints from discovered surfaces (search, property listings, restaurant menus, delivery tracking).",
            "Test each endpoint without auth headers to confirm it returns data publicly.",
            "Fuzz parameters: try different IDs, offsets, limits, and filters to find data leakage.",
            "Test for rate limiting: send rapid sequential requests and check for 429 responses.",
            "Test for CORS misconfiguration: send requests with Origin header set to a different domain.",
            "Save all findings to workspace/public_api_findings.txt with exact request/response pairs.",
        ),
        artifacts=("public_api_findings.txt", "verify_public_api.py"),
        validation=(
            "At least 3 public endpoints were tested.",
            "Each test includes exact request URL and response excerpt.",
            "Data leakage or rate limiting bypass is documented with evidence.",
        ),
        stop_conditions=("All public endpoints return 401/403 (auth required).", "WAF blocks all requests after 3 attempts."),
    ),
    "idor_tracking": AgentSkill(
        name="idor_tracking",
        purpose="Test tracking IDs, order IDs, restaurant IDs, and property IDs for Insecure Direct Object Reference (IDOR) on public endpoints.",
        when_to_use="When endpoints with sequential or predictable IDs are discovered (e.g., /track/<id>, /order/<id>, /restaurant/<id>, /property/<id>).",
        allowed_tools=("bash:curl", "bash:python3", "write_file", "read_file"),
        steps=(
            "Identify ID-based endpoints from discovered surfaces (tracking, orders, restaurants, properties).",
            "Capture baseline response for a known ID (e.g., your own order or a public listing).",
            "Test sequential IDs: increment/decrement the ID and compare responses.",
            "Test UUID patterns: if IDs are UUIDs, try common patterns like all-zeros or sequential UUIDs.",
            "Compare responses: if different IDs return the same data, that is IDOR evidence.",
            "Write a verification script that tests 10-20 sequential IDs and saves the comparison results.",
        ),
        artifacts=("idor_evidence.txt", "verify_idor_tracking.py"),
        validation=(
            "At least 5 different IDs were tested on the same endpoint.",
            "The baseline response is compared against swapped-ID responses.",
            "If any endpoint returned data for a different ID without authorization, that is a validated finding.",
        ),
        stop_conditions=("No ID-based endpoints were discovered.", "All IDs return 404 or identical error responses."),
    ),
    "session_testing": AgentSkill(
        name="session_testing",
        purpose="Test session security: fixation, expiry, concurrent sessions, and cookie properties.",
        when_to_use="After login automation has captured a valid session and auth surfaces are present.",
        allowed_tools=("read_file", "write_file", "bash:curl", "bash:python3"),
        steps=(
            "Read the current auth context from auth-context.json.",
            "Test session fixation: pre-set a candidate session cookie, complete login, check if the cookie was preserved or rotated.",
            "Test concurrent sessions: use two different session cookies simultaneously on authenticated endpoints, check if both remain valid.",
            "Test session expiry: if a short timeout is feasible, wait or manipulate exp claims, then replay the session cookie.",
            "Test cookie properties: check Secure, HttpOnly, SameSite, Domain, Path flags on captured cookies.",
            "Write a Python verification script that automates the most promising session test and captures exact request/response pairs.",
        ),
        artifacts=("evidence/session-test-results.txt", "verify_session.py"),
        validation=(
            "At least one session property or behavior was tested with exact request/response evidence.",
            "The script or evidence file shows whether the test passed, failed, or was inconclusive.",
        ),
        stop_conditions=("No valid session is available in auth-context.json.", "The application uses stateless JWTs without session cookies."),
    ),
    "jwt_testing": AgentSkill(
        name="jwt_testing",
        purpose="Analyze and test JWT security: alg:none, weak keys, kid injection, payload modification, expiration bypass.",
        when_to_use="When a JWT is discovered in auth headers, cookies, or response bodies.",
        allowed_tools=("read_file", "write_file", "bash:python3", "decode_jwt"),
        steps=(
            "Decode the JWT using decode_jwt to inspect header and payload.",
            "Check alg header: if 'none', try sending the token without signature.",
            "Check kid header: if present, test for path traversal or SQL injection in kid.",
            "Check exp claim: if present, test with an expired token and a far-future expiry.",
            "Check role/scope/privilege claims: try upgrading them in the payload (requires signing with a weak/common key if alg is HS256).",
            "Replay the modified token against a protected endpoint and compare responses.",
            "Write a Python script that automates the most promising JWT test and captures evidence.",
        ),
        artifacts=("evidence/jwt-analysis.txt", "verify_jwt.py"),
        validation=(
            "The JWT header and payload were decoded.",
            "At least one JWT security test was performed with exact request/response.",
            "The test result is clearly passed, failed, or inconclusive.",
        ),
        stop_conditions=("No JWT is available in the current auth context or responses.", "The JWT uses RS256/ECDSA and no private key is available for testing."),
    ),
    "finding_triage": AgentSkill(
        name="finding_triage",
        purpose="Decide whether an observation is a reportable bug bounty finding.",
        when_to_use="Before every record_finding action.",
        allowed_tools=("read_file", "record_finding"),
        steps=(
            "Confirm the asset is in scope.",
            "Confirm the behavior is not only public discovery, expected auth, 401, 403, 404, redirect, or content length.",
            "Attach exact request, exact response excerpt, security impact, and safe next manual verification.",
            "Reject the observation into notes if impact or reproduction is weak.",
        ),
        artifacts=("finding evidence file or exact request/response fields",),
        validation=(
            "Severity is low or higher.",
            "Request, response, evidence, impact, and next steps are all concrete.",
        ),
        stop_conditions=("Only informational or expected behavior has been observed.",),
    ),
}


def skill_catalog_prompt(include_research: bool = True) -> str:
    skills = BUILTIN_SKILLS.values()
    if not include_research:
        skills = (skill for skill in skills if skill.name != "public_research")
    return "\n".join(skill.compact() for skill in skills)


def get_skill(name: str) -> AgentSkill | None:
    normalized = name.strip().lower().replace("-", "_")
    return BUILTIN_SKILLS.get(normalized)
