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
            "Search GitHub for target names, SDKs, leaked endpoint names, public issues, and example API paths.",
            "Search Medium or bug bounty writeups for the target technology and similar bug classes.",
            "Search Stack Overflow for exact framework errors, route names, or API behavior seen in responses.",
            "Search CVE Details and Snyk for named products, packages, gateways, WAFs, or frontend libraries.",
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


def skill_catalog_prompt() -> str:
    return "\n".join(skill.compact() for skill in BUILTIN_SKILLS.values())


def get_skill(name: str) -> AgentSkill | None:
    normalized = name.strip().lower().replace("-", "_")
    return BUILTIN_SKILLS.get(normalized)
