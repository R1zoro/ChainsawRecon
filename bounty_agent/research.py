"""Milestone 3.4 — Deterministic research skills.

Provides two external-intelligence probes that do NOT scrape HTML:
- OSV API (api.osv.dev) — keyless, deterministic CVE lookup for (package, ecosystem, version).
- Tavily Search API — structured JSON search (requires TAVILY_API_KEY in .env / env).

Both are exposed through a single ``research`` tool action with a
``source`` field ("osv" or "tavily") so the model cannot choose engines.
"""
from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OSV_QUERY_URL = "https://api.osv.dev/v1/query"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"

_TIMEOUT_SECONDS = 20
_MAX_RESULTS = 5


def osv_query(package: str, ecosystem: str = "", version: str = "") -> str:
    """Query the OSV vulnerability database for (package, ecosystem, version).

    Returns a compact, cited CVE list. Pure JSON API — no HTML scraping.
    """
    if not package.strip():
        return "osv_query requires a 'package' name. Optionally provide 'ecosystem' and 'version'."
    payload: dict[str, Any] = {"package": {"name": package.strip()}}
    if ecosystem.strip():
        payload["package"]["ecosystem"] = ecosystem.strip()
    if version.strip():
        payload["version"] = version.strip()

    req = Request(
        OSV_QUERY_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "chainsaw-recon/1.0"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return f"OSV query failed: {type(exc).__name__}: {exc}"

    vulns = data.get("vulns") or []
    if not vulns:
        return f"OSV: no known vulnerabilities for {package!r}" + (
            f"@{version}" if version.strip() else ""
        ) + (f" ({ecosystem})" if ecosystem.strip() else "") + "."

    lines = [f"OSV: {len(vulns)} known vulnerability(ies) for {package}" + (f"@{version}" if version.strip() else "")]
    for vuln in vulns[:_MAX_RESULTS]:
        vuln_id = vuln.get("id", "unknown")
        summary = (vuln.get("summary") or vuln.get("details") or "").strip()
        summary = summary.replace("\n", " ")[:220]
        affected = vuln.get("affected") or []
        affected_desc = ""
        if affected:
            first = affected[0]
            ranges = first.get("ranges") or []
            if ranges and ranges[0].get("events"):
                intro = next((e.get("introduced") for e in ranges[0]["events"] if "introduced" in e), "?")
                fixed = next((e.get("fixed") for e in ranges[0]["events"] if "fixed" in e), None)
                affected_desc = f" (introduced {intro}" + (f", fixed {fixed}" if fixed else "") + ")"
        aliases = vuln.get("aliases") or []
        alias_txt = ", ".join(aliases[:4]) if aliases else ""
        lines.append(f"- {vuln_id}{affected_desc}: {summary}")
        if alias_txt:
            lines.append(f"  aliases: {alias_txt}")
    lines.append(f"  source: OSV API (api.osv.dev) — deterministic, no key required.")
    return "\n".join(lines)


def tavily_search(query: str, api_key: str = "", max_results: int = 5) -> str:
    """Structured JSON search via Tavily. Requires TAVILY_API_KEY.

    Returns cited result snippets. Never returns raw HTML.
    """
    if not query.strip():
        return "tavily_search requires a 'query'."
    if not api_key:
        key = os.environ.get("TAVILY_API_KEY", "")
        if not key:
            return "tavily_search unavailable: TAVILY_API_KEY is not set. Fall back to OSV or observed evidence."
        api_key = key
    max_results = min(max(int(max_results), 1), 10)

    payload = {"api_key": api_key, "query": query.strip(), "max_results": max_results, "search_depth": "basic"}
    req = Request(
        TAVILY_SEARCH_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "chainsaw-recon/1.0"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return f"Tavily search failed: {type(exc).__name__}: {exc}"

    results = data.get("results") or []
    if not results:
        return f"Tavily: no results for {query!r}."
    lines = [f"Tavily results for {query!r} ({len(results)} found):"]
    for item in results[:_MAX_RESULTS]:
        title = (item.get("title") or "").strip()
        url = (item.get("url") or "").strip()
        snippet = (item.get("content") or "").strip().replace("\n", " ")[:200]
        score = item.get("score")
        score_txt = f" score={score:.2f}" if isinstance(score, (int, float)) else ""
        lines.append(f"- {title}{score_txt}: {snippet}\n  {url}")
    lines.append("  Note: treat public research as context, never as target evidence.")
    return "\n".join(lines)


def research_probe(action: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
    """Dispatch for the ToolRegistry 'research' action.

    Returns (ok, content, meta). `action['source']` selects the backend.
    """
    source = str(action.get("source", "")).strip().lower()
    if source == "osv":
        content = osv_query(
            str(action.get("package", "")),
            str(action.get("ecosystem", "")),
            str(action.get("version", "")),
        )
        ok = not content.startswith("OSV query failed") and not content.startswith("osv_query requires")
        return ok, content, {"source": "osv"}
    if source == "tavily":
        content = tavily_search(
            str(action.get("query", "")),
            str(action.get("api_key", "")),
            int(action.get("max_results", 5)),
        )
        ok = not content.startswith("Tavily") or "unavailable" not in content
        return ok, content, {"source": "tavily"}
    return (
        False,
        "Unsupported research source. Use {\"action\":\"research\",\"source\":\"osv\",\"package\":\"...\"} "
        "or {\"action\":\"research\",\"source\":\"tavily\",\"query\":\"...\"}.",
        {},
    )