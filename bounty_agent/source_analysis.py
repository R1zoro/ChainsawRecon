from __future__ import annotations

"""Low-risk, local source and client-artifact analysis.

This is intentionally evidence extraction rather than a static vulnerability
scanner.  Its output becomes topology and hypotheses for later runtime checks.
"""

from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import re
from typing import Iterable


_TEXT_SUFFIXES = {".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java", ".cs", ".rb", ".php", ".go", ".json", ".yml", ".yaml", ".graphql", ".gql", ".html"}
_IGNORED_PARTS = {".git", "node_modules", "vendor", ".venv", "venv", "dist", "build", "coverage", "__pycache__"}


@dataclass(frozen=True)
class SourceRoute:
    path: str
    method: str
    source_file: str
    auth_hint: str = "unknown"


@dataclass(frozen=True)
class SourceAsset:
    path: str
    kind: str
    checksum: str
    language: str | None
    framework: str | None
    evidence: tuple[str, ...] = ()


@dataclass
class SourceAnalysis:
    root: str
    frameworks: set[str] = field(default_factory=set)
    languages: set[str] = field(default_factory=set)
    routes: list[SourceRoute] = field(default_factory=list)
    client_endpoints: set[str] = field(default_factory=set)
    graphql_operations: set[str] = field(default_factory=set)
    auth_indicators: set[str] = field(default_factory=set)
    source_assets: list[SourceAsset] = field(default_factory=list)
    files_scanned: int = 0
    skipped_files: int = 0


def analyze_source_tree(root: Path, *, max_files: int = 500, max_file_bytes: int = 1_000_000) -> SourceAnalysis:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError(f"Source root is not a directory: {root}")
    result = SourceAnalysis(root=str(root))
    for path in _source_files(root, max_files):
        try:
            if path.stat().st_size > max_file_bytes:
                result.skipped_files += 1
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            result.skipped_files += 1
            continue
        result.files_scanned += 1
        relative = str(path.relative_to(root)).replace("\\", "/")
        language = _language(path)
        result.languages.update([language] if language else [])
        frameworks = _frameworks_for(relative, text)
        result.frameworks.update(frameworks)
        result.source_assets.append(SourceAsset(relative, _asset_kind(path), _checksum(text), language, next(iter(frameworks), None), tuple(sorted(frameworks))))
        result.routes.extend(_extract_routes(relative, text))
        result.client_endpoints.update(_extract_client_endpoints(text))
        result.graphql_operations.update(_extract_graphql_operations(text))
        result.auth_indicators.update(_extract_auth_indicators(text))
    result.routes = _unique_routes(result.routes)
    return result


def analyze_client_artifact(path: Path) -> SourceAnalysis:
    """Analyze one JavaScript, source-map-adjacent, or schema artifact."""
    root = path.parent.resolve()
    analysis = SourceAnalysis(root=str(root))
    text = path.read_text(encoding="utf-8", errors="replace")
    relative = path.name
    frameworks = _frameworks_for(relative, text)
    analysis.frameworks.update(frameworks)
    analysis.languages.update([_language(path)] if _language(path) else [])
    analysis.source_assets.append(SourceAsset(relative, _asset_kind(path), _checksum(text), _language(path), next(iter(frameworks), None), tuple(sorted(frameworks))))
    analysis.routes = _extract_routes(relative, text)
    analysis.client_endpoints = _extract_client_endpoints(text)
    analysis.graphql_operations = _extract_graphql_operations(text)
    analysis.auth_indicators = _extract_auth_indicators(text)
    analysis.files_scanned = 1
    return analysis


def _source_files(root: Path, max_files: int) -> Iterable[Path]:
    count = 0
    for path in root.rglob("*"):
        if count >= max_files:
            break
        if not path.is_file() or path.suffix.lower() not in _TEXT_SUFFIXES:
            continue
        if any(part.lower() in _IGNORED_PARTS for part in path.parts):
            continue
        count += 1
        yield path


def _frameworks_for(path: str, text: str) -> set[str]:
    lowered = f"{path}\n{text[:200000]}".lower()
    found: set[str] = set()
    indicators = {
        "Laravel": ("laravel", "artisan", "illuminate\\"),
        "Django": ("django", "urlpatterns", "manage.py"),
        "Flask": ("flask", "@app.route"),
        "FastAPI": ("fastapi", "apirouter"),
        "Express": ("express", "app.get(", "router.get("),
        "Next.js": ("next.config", "next/", "getserverprops", "app/api/"),
        "Rails": ("rails", "routes.draw", "activerecord"),
        "Spring": ("springframework", "@restcontroller", "@getmapping"),
        "ASP.NET": ("microsoft.aspnetcore", "[apicontroller]", "mapget("),
        "GraphQL": ("graphql", "type query", "type mutation"),
    }
    for framework, needles in indicators.items():
        if any(needle in lowered for needle in needles):
            found.add(framework)
    return found


def _extract_routes(source_file: str, text: str) -> list[SourceRoute]:
    routes: list[SourceRoute] = []
    patterns = (
        (r"(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['\"]([^'\"]+)", 1, 2),
        (r"@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)", 1, 2),
        (r"@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?['\"]([^'\"]+)", 1, 2),
        (r"(?:MapGet|MapPost|MapPut|MapDelete)\s*\(\s*['\"]([^'\"]+)", None, 1),
    )
    for pattern, method_group, path_group in patterns:
        for match in re.finditer(pattern, text, flags=re.I):
            method = match.group(method_group).upper() if method_group else _method_from_map(match.group(0))
            path = match.group(path_group)
            if path.startswith("/"):
                routes.append(SourceRoute(path, method, source_file, _auth_hint(text, match.start())))
    if "/graphql" in text.lower():
        routes.append(SourceRoute("/graphql", "POST", source_file, "unknown"))
    return routes


def _extract_client_endpoints(text: str) -> set[str]:
    values = set(re.findall(r"['\"](/(?:api|graphql|v\d+|auth|oauth|login|upload|admin|export|import)[^'\"\s]*)['\"]", text, flags=re.I))
    values.update(re.findall(r"https?://[A-Za-z0-9._:-]+/(?:api|graphql|v\d+)[^'\"\s]*", text, flags=re.I))
    return {value.rstrip("\\") for value in values if len(value) <= 500}


def _extract_graphql_operations(text: str) -> set[str]:
    return {f"{kind} {name}" for kind, name in re.findall(r"\b(query|mutation|subscription)\s+([A-Za-z_][\w]*)", text, flags=re.I)}


def _extract_auth_indicators(text: str) -> set[str]:
    lowered = text.lower()
    indicators = {"jwt": "jwt", "authorization": "authorization header", "cookie": "cookie", "tenant": "tenant reference", "role": "role reference", "csrf": "csrf"}
    return {label for needle, label in indicators.items() if needle in lowered}


def _auth_hint(text: str, offset: int) -> str:
    nearby = text[max(0, offset - 500): offset + 500].lower()
    if any(marker in nearby for marker in ("auth", "require_user", "current_user", "authorize", "role")):
        return "likely_required"
    return "unknown"


def _method_from_map(value: str) -> str:
    lowered = value.lower()
    for name in ("get", "post", "put", "delete"):
        if name in lowered:
            return name.upper()
    return "GET"


def _language(path: Path) -> str | None:
    return {".py": "Python", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".jsx": "JavaScript", ".java": "Java", ".cs": "C#", ".rb": "Ruby", ".php": "PHP", ".go": "Go"}.get(path.suffix.lower())


def _asset_kind(path: Path) -> str:
    if path.suffix.lower() in {".graphql", ".gql"}:
        return "graphql_schema"
    if path.suffix.lower() in {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"}:
        return "client_source"
    if path.name in {"package.json", "pyproject.toml", "composer.json", "pom.xml", "build.gradle"}:
        return "dependency_manifest"
    return "source"


def _checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def _unique_routes(routes: list[SourceRoute]) -> list[SourceRoute]:
    values: dict[tuple[str, str, str], SourceRoute] = {}
    for route in routes:
        values[(route.path, route.method, route.source_file)] = route
    return sorted(values.values(), key=lambda item: (item.path, item.method, item.source_file))
