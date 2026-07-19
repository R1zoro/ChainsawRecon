from __future__ import annotations

from dataclasses import dataclass
import fnmatch
import ipaddress
import shlex
from pathlib import Path
from urllib.parse import urlparse

from .config import ProgramScope


@dataclass(frozen=True)
class ScopeDecision:
    allowed: bool
    reason: str
    hosts: tuple[str, ...] = ()


class ScopeGuard:
    def __init__(self, scope: ProgramScope, dynamic_allow_file: str | Path | None = None, allow_all: bool = False) -> None:
        self.scope = scope
        self.dynamic_allow_file = Path(dynamic_allow_file) if dynamic_allow_file else None
        self.allow_all = bool(allow_all)

    def set_dynamic_allow_file(self, path: str | Path) -> None:
        self.dynamic_allow_file = Path(path)

    def validate_target(self, target: str) -> ScopeDecision:
        hosts = self._extract_hosts(target)
        if not hosts:
            return ScopeDecision(False, "No hostname or IP address found in target.", ())
        return self.validate_hosts(hosts)

    def validate_command(self, command: str) -> ScopeDecision:
        hosts = self._extract_hosts(command)
        if not hosts:
            return ScopeDecision(True, "Command contains no explicit remote host.", ())
        # Exempt package registries and code hosts for downloads
        exempt_hosts = {"github.com", "raw.githubusercontent.com", "pypi.org", "pypi.python.org",
                        "files.pythonhosted.org", "npmjs.org", "registry.npmjs.org",
                        "registry.npmjs.com", "rubygems.org", "crates.io", "cran.r-project.org"}
        remaining = tuple(h for h in hosts if h not in exempt_hosts)
        if not remaining:
            return ScopeDecision(True, "All hosts are exempt package registries.", hosts)
        return self.validate_hosts(remaining)

    def validate_hosts(self, hosts: tuple[str, ...] | list[str]) -> ScopeDecision:
        if self.allow_all:
            unique_hosts = tuple(dict.fromkeys(host.lower().strip(".") for host in hosts))
            return ScopeDecision(True, "Allow-all mode enabled.", unique_hosts)
        unique_hosts = tuple(dict.fromkeys(host.lower().strip(".") for host in hosts))
        for host in unique_hosts:
            if self._matches_any(host, self.scope.excluded_domains):
                return ScopeDecision(False, f"{host} is explicitly excluded from scope.", unique_hosts)
            if not self._is_allowed_host(host):
                # Check dynamic allowlist file (hosts discovered during this run)
                if self._is_in_dynamic_allowlist(host):
                    continue
                return ScopeDecision(False, f"{host} is not in allowed scope.", unique_hosts)
        return ScopeDecision(True, "All referenced hosts are in scope.", unique_hosts)

    def _is_in_dynamic_allowlist(self, host: str) -> bool:
        if not self.dynamic_allow_file:
            return False
        try:
            if not self.dynamic_allow_file.exists():
                return False
            lines = [l.strip() for l in self.dynamic_allow_file.read_text(encoding="utf-8").splitlines()]
        except Exception:
            return False
        patterns = [l.lower() for l in lines if l and not l.startswith("#")]
        return self._matches_any(host, patterns) or host in patterns

    def _is_allowed_host(self, host: str) -> bool:
        if self._is_ip(host):
            return host in self.scope.allowed_domains
        return self._matches_any(host, self.scope.allowed_domains)

    def _matches_any(self, host: str, patterns: list[str]) -> bool:
        for pattern in patterns:
            normalized = pattern.lower().strip()
            if normalized.startswith("*."):
                suffix = normalized[1:]
                if host.endswith(suffix) and host != normalized[2:]:
                    return True
            elif fnmatch.fnmatch(host, normalized):
                return True
        return False

    def _extract_hosts(self, text: str) -> tuple[str, ...]:
        hosts: list[str] = []
        for token in self._tokens(text):
            candidate = self._host_from_token(token)
            if candidate and candidate not in hosts:
                hosts.append(candidate)
        return tuple(hosts)

    def _tokens(self, text: str) -> list[str]:
        try:
            return shlex.split(text, posix=True)
        except ValueError:
            return text.split()

    def _host_from_token(self, token: str) -> str | None:
        cleaned = token.strip("()[]{}<>,;\"'")
        if not cleaned:
            return None
        # Skip local file paths (contain backslash, or start with ./ or .\\)
        if "\\\\" in cleaned or cleaned.startswith("./") or cleaned.startswith(".\\\\"):
            return None
        if "://" in cleaned:
            return urlparse(cleaned).hostname
        if cleaned.startswith("//"):
            return urlparse(f"https:{cleaned}").hostname
        # Normalize backslashes to forward slashes for path handling
        normalized = cleaned.replace("\\\\", "/")
        candidate = normalized.split("/", 1)[0].split(":", 1)[0].lower().strip(".")
        if self._is_ip(candidate) or self._is_domain(candidate):
            return candidate
        return None

    def _is_domain(self, value: str) -> bool:
        labels = value.split(".")
        if len(labels) < 2:
            return False
        for label in labels:
            if not label or len(label) > 63:
                return False
            if label[0] == "-" or label[-1] == "-":
                return False
            if not all(char.isalnum() or char == "-" for char in label):
                return False
        return labels[-1].isalpha() and len(labels[-1]) >= 2

    def _is_ip(self, value: str) -> bool:
        try:
            ipaddress.ip_address(value)
            return True
        except ValueError:
            return False
