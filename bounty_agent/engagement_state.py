from __future__ import annotations

"""Durable, structured engagement state for hypothesis-driven work.

This store deliberately complements ``ReconStore``.  ReconStore retains parsed
tool observations, while this module records the security question being
investigated, the evidence attached to it, and the work consumed to answer it.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from typing import Any, Iterable
from urllib.parse import urlparse


LIFECYCLE_STATES = {
    "observed", "suspected", "evidence_required", "experiment_planned",
    "experiment_attempted", "reproduced", "validated", "rejected", "deferred", "blocked",
}
EXPERIMENT_READY_STATES = {
    "suspected", "evidence_required", "experiment_planned", "experiment_attempted", "reproduced",
}
MISSION_STATES = {"active", "completed", "deferred", "blocked"}


@dataclass(frozen=True)
class SecurityObjective:
    objective_id: str
    title: str
    target: str
    status: str = "active"
    priority: int = 50
    description: str = ""
    source: str = "agent"
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class Mission:
    mission_id: str
    objective_id: str | None
    title: str
    target: str
    kind: str
    worker: str
    status: str = "active"
    required_evidence: tuple[str, ...] = ()
    completion_criteria: tuple[str, ...] = ()
    meta: dict[str, Any] | None = None


@dataclass(frozen=True)
class Hypothesis:
    hypothesis_id: str
    objective_id: str | None
    surface: str
    title: str
    security_question: str
    state: str = "suspected"
    confidence: str = "candidate"
    required_evidence: tuple[str, ...] = ()
    source: str = "agent"
    meta: dict[str, Any] | None = None


class EngagementStateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self._create_tables()

    def _create_tables(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS objectives(
                objective_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                title TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL,
                description TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hypotheses(
                hypothesis_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                objective_id TEXT, surface TEXT NOT NULL, title TEXT NOT NULL, security_question TEXT NOT NULL,
                state TEXT NOT NULL, confidence TEXT NOT NULL, required_evidence TEXT NOT NULL,
                source TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS missions(
                mission_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                objective_id TEXT, title TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL,
                worker TEXT NOT NULL, status TEXT NOT NULL, required_evidence TEXT NOT NULL,
                completion_criteria TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS evidence(
                evidence_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, hypothesis_id TEXT,
                objective_id TEXT, kind TEXT NOT NULL, location TEXT NOT NULL, summary TEXT NOT NULL,
                content_hash TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS actions(
                action_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, run_id TEXT NOT NULL,
                objective_id TEXT, hypothesis_id TEXT, action TEXT NOT NULL, target TEXT NOT NULL,
                ok INTEGER NOT NULL, summary TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tool_inventory(
                tool TEXT PRIMARY KEY, checked_at TEXT NOT NULL, present INTEGER NOT NULL,
                version TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS artifacts(
                artifact_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL,
                path TEXT NOT NULL, summary TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hypotheses_objective ON hypotheses(objective_id);
            CREATE INDEX IF NOT EXISTS idx_missions_objective ON missions(objective_id);
            CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id);
            CREATE INDEX IF NOT EXISTS idx_evidence_hypothesis ON evidence(hypothesis_id);
            """
        )
        self.conn.commit()

    def ensure_objective(self, title: str, target: str, *, source: str = "agent", priority: int = 50,
                         description: str = "", meta: dict[str, Any] | None = None) -> str:
        key = _stable_id("OBJ", title, target)
        now = _now()
        self.conn.execute(
            """INSERT INTO objectives(objective_id,created_at,updated_at,title,target,status,priority,description,source,meta)
               VALUES (?,?,?,?,?,'active',?,?,?,?)
               ON CONFLICT(objective_id) DO UPDATE SET updated_at=excluded.updated_at, priority=excluded.priority,
                 description=excluded.description, meta=excluded.meta""",
            (key, now, now, title, target, priority, description, source, _json(meta)),
        )
        self.conn.commit()
        return key

    def create_hypothesis(self, title: str, security_question: str, surface: str, *, objective_id: str | None = None,
                          state: str = "suspected", confidence: str = "candidate",
                          required_evidence: Iterable[str] = (), source: str = "agent",
                          meta: dict[str, Any] | None = None) -> str:
        if state not in LIFECYCLE_STATES:
            raise ValueError(f"Unsupported hypothesis state: {state}")
        key = _stable_id("HYP", objective_id or "", surface, title)
        now = _now()
        self.conn.execute(
            """INSERT INTO hypotheses(hypothesis_id,created_at,updated_at,objective_id,surface,title,security_question,state,confidence,required_evidence,source,meta)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(hypothesis_id) DO UPDATE SET updated_at=excluded.updated_at, security_question=excluded.security_question,
                 state=excluded.state, confidence=excluded.confidence, required_evidence=excluded.required_evidence, meta=excluded.meta""",
            (key, now, now, objective_id, surface, title, security_question, state, confidence,
             _json(list(required_evidence)), source, _json(meta)),
        )
        self.conn.commit()
        return key

    def ensure_mission(self, title: str, target: str, *, kind: str, worker: str,
                       objective_id: str | None = None, required_evidence: Iterable[str] = (),
                       completion_criteria: Iterable[str] = (), meta: dict[str, Any] | None = None) -> str:
        key = _stable_id("MIS", objective_id or "", target, kind, title)
        now = _now()
        self.conn.execute(
            """INSERT INTO missions(mission_id,created_at,updated_at,objective_id,title,target,kind,worker,status,required_evidence,completion_criteria,meta)
               VALUES (?,?,?,?,?,?,?,?, 'active',?,?,?)
               ON CONFLICT(mission_id) DO UPDATE SET updated_at=excluded.updated_at,worker=excluded.worker,
                 required_evidence=excluded.required_evidence,completion_criteria=excluded.completion_criteria,meta=excluded.meta""",
            (key, now, now, objective_id, title, target, kind, worker, _json(list(required_evidence)),
             _json(list(completion_criteria)), _json(meta)),
        )
        self.conn.commit()
        return key

    def record_evidence(self, kind: str, location: str, summary: str, *, content: str = "",
                        objective_id: str | None = None, hypothesis_id: str | None = None,
                        source: str = "agent", meta: dict[str, Any] | None = None) -> str:
        digest = hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()
        key = _stable_id("EVD", hypothesis_id or "", kind, location, digest)
        self.conn.execute(
            """INSERT INTO evidence(evidence_id,created_at,hypothesis_id,objective_id,kind,location,summary,content_hash,source,meta)
               VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(evidence_id) DO NOTHING""",
            (key, _now(), hypothesis_id, objective_id, kind, location, summary, digest, source, _json(meta)),
        )
        self.conn.commit()
        return key

    def record_action(self, run_id: str, action: dict[str, Any], ok: bool, summary: str, *, target: str = "",
                      objective_id: str | None = None, hypothesis_id: str | None = None,
                      meta: dict[str, Any] | None = None) -> None:
        self.conn.execute(
            "INSERT INTO actions(created_at,run_id,objective_id,hypothesis_id,action,target,ok,summary,meta) VALUES (?,?,?,?,?,?,?,?,?)",
            (_now(), run_id, objective_id, hypothesis_id, str(action.get("action", "")), target, 1 if ok else 0,
             _short(summary, 2000), _json({"action": action, **(meta or {})})),
        )
        self.conn.commit()

    def record_tool_inventory(self, content: str, *, source: str = "startup") -> None:
        for raw in content.splitlines():
            match = re.match(r"\s*([A-Za-z0-9_.-]+)=(present|missing)\s*$", raw)
            if not match:
                continue
            tool, state = match.groups()
            self.conn.execute(
                """INSERT INTO tool_inventory(tool,checked_at,present,version,source,meta) VALUES (?,?,?,?,?,?)
                   ON CONFLICT(tool) DO UPDATE SET checked_at=excluded.checked_at,present=excluded.present,source=excluded.source""",
                (tool, _now(), 1 if state == "present" else 0, "", source, "{}"),
            )
        self.conn.commit()

    def save_artifact(self, kind: str, path: Path, summary: str, *, source: str = "agent",
                      meta: dict[str, Any] | None = None) -> str:
        key = _stable_id("ART", kind, str(path.resolve()))
        self.conn.execute(
            """INSERT INTO artifacts(artifact_id,created_at,kind,path,summary,source,meta) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(artifact_id) DO UPDATE SET created_at=excluded.created_at,summary=excluded.summary,meta=excluded.meta""",
            (key, _now(), kind, str(path), summary, source, _json(meta)),
        )
        self.conn.commit()
        return key

    def objectives(self) -> list[dict[str, Any]]:
        return self._rows("SELECT objective_id,title,target,status,priority,description,source,meta FROM objectives ORDER BY priority DESC, created_at")

    def hypotheses(self) -> list[dict[str, Any]]:
        return self._rows("SELECT hypothesis_id,objective_id,surface,title,security_question,state,confidence,required_evidence,source,meta FROM hypotheses ORDER BY updated_at DESC")

    def hypothesis(self, hypothesis_id: str) -> dict[str, Any] | None:
        rows = self._rows(
            "SELECT hypothesis_id,objective_id,surface,title,security_question,state,confidence,required_evidence,source,meta "
            "FROM hypotheses WHERE hypothesis_id=?",
            (hypothesis_id,),
        )
        return rows[0] if rows else None

    def mission(self, mission_id: str) -> dict[str, Any] | None:
        rows = self._rows(
            "SELECT mission_id,objective_id,title,target,kind,worker,status,required_evidence,completion_criteria,meta "
            "FROM missions WHERE mission_id=?",
            (mission_id,),
        )
        return rows[0] if rows else None

    def missions(self, *, status: str | None = None) -> list[dict[str, Any]]:
        if status:
            return self._rows(
                "SELECT mission_id,objective_id,title,target,kind,worker,status,required_evidence,completion_criteria,meta "
                "FROM missions WHERE status=? ORDER BY updated_at DESC",
                (status,),
            )
        return self._rows(
            "SELECT mission_id,objective_id,title,target,kind,worker,status,required_evidence,completion_criteria,meta "
            "FROM missions ORDER BY updated_at DESC"
        )

    def transition_mission(self, mission_id: str, status: str, *, reason: str = "",
                           completion_evidence: Iterable[str] = ()) -> bool:
        if status not in MISSION_STATES:
            raise ValueError(f"Unsupported mission status: {status}")
        mission = self.mission(mission_id)
        if not mission:
            return False
        meta = dict(mission.get("meta") or {})
        if reason:
            meta["status_reason"] = reason
        evidence = [str(item) for item in completion_evidence if str(item).strip()]
        if evidence:
            meta["completion_evidence"] = evidence
        cursor = self.conn.execute(
            "UPDATE missions SET status=?, updated_at=?, meta=? WHERE mission_id=?",
            (status, _now(), _json(meta), mission_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def set_mission_worker(self, mission_id: str, worker: str) -> bool:
        cursor = self.conn.execute(
            "UPDATE missions SET worker=?, updated_at=? WHERE mission_id=?",
            (worker, _now(), mission_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def transition_hypothesis(self, hypothesis_id: str, state: str) -> bool:
        if state not in LIFECYCLE_STATES:
            raise ValueError(f"Unsupported hypothesis state: {state}")
        cursor = self.conn.execute(
            "UPDATE hypotheses SET state=?, updated_at=? WHERE hypothesis_id=?",
            (state, _now(), hypothesis_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def budget_summary(self, run_id: str) -> dict[str, int]:
        row = self.conn.execute("SELECT COUNT(*), COALESCE(SUM(ok),0) FROM actions WHERE run_id=?", (run_id,)).fetchone()
        return {"actions": int(row[0] or 0), "successful_actions": int(row[1] or 0)}

    def discovered_hosts_for_tool(self, tool_name: str) -> set[str]:
        rows = self.conn.execute("SELECT summary, meta FROM actions WHERE ok=1 ORDER BY action_id").fetchall()
        hosts: set[str] = set()
        needle = tool_name.lower()
        for summary, meta in rows:
            try:
                action = json.loads(meta or "{}").get("action", {})
            except json.JSONDecodeError:
                action = {}
            command = " ".join(str(action.get(key, "")) for key in ("action", "command", "target", "url"))
            if needle not in command.lower():
                continue
            hosts.update(extract_hosts(str(summary)))
        return hosts

    def write_machine_exports(self, root: Path) -> dict[str, Path]:
        root.mkdir(parents=True, exist_ok=True)
        exports = {
            "objectives.jsonl": self.objectives(),
            "hypotheses.jsonl": self.hypotheses(),
            "evidence.jsonl": self._rows("SELECT evidence_id,hypothesis_id,objective_id,kind,location,summary,content_hash,source,meta FROM evidence ORDER BY created_at"),
            "actions.jsonl": self._rows("SELECT run_id,objective_id,hypothesis_id,action,target,ok,summary,meta FROM actions ORDER BY action_id"),
            "artifacts.jsonl": self._rows("SELECT artifact_id,kind,path,summary,source,meta FROM artifacts ORDER BY created_at"),
        }
        paths: dict[str, Path] = {}
        for name, rows in exports.items():
            path = root / name
            path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
            paths[name] = path
        inventory = self._rows("SELECT tool,checked_at,present,version,source,meta FROM tool_inventory ORDER BY tool")
        manifest = root / "tool-manifest.json"
        manifest.write_text(json.dumps({"generated_at": _now(), "tools": inventory}, ensure_ascii=False, indent=2), encoding="utf-8")
        paths["tool-manifest.json"] = manifest
        return paths

    def _rows(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        cursor = self.conn.execute(query, params)
        names = [item[0] for item in cursor.description]
        rows = []
        for values in cursor.fetchall():
            row = dict(zip(names, values))
            for key in ("meta", "required_evidence", "completion_criteria"):
                if key in row:
                    try:
                        row[key] = json.loads(row[key] or ("[]" if key in {"required_evidence", "completion_criteria"} else "{}"))
                    except json.JSONDecodeError:
                        row[key] = [] if key in {"required_evidence", "completion_criteria"} else {}
            if "ok" in row:
                row["ok"] = bool(row["ok"])
            rows.append(row)
        return rows

    def close(self) -> None:
        self.conn.close()


# Invalid host tokens that appear when shell/tool text is misparsed as a host
_INVALID_HOST_TOKENS: frozenset[str] = frozenset(
    {
        "nuclei",
        "dalfox",
        "sqlmap",
        "httpx",
        "katana",
        "ffuf",
        "gobuster",
        "feroxbuster",
        "dirsearch",
        "nmap",
        "nikto",
        "whatweb",
        "wafw00f",
        "arjun",
        "inql",
        "clairvoyance",
        "grapeql",
        "commix",
        "xsstrike",
        "trufflehog",
        "curl",
        "wget",
        "bash",
        "sh",
        "python",
        "python3",
        "node",
        "npm",
        "true",
        "false",
        "null",
        "none",
        "undefined",
        "local",
        "host",
        "localhost",
    }
)

# Host suffixes that indicate infrastructure-only (CDN/analytics/SaaS) targets
_NOISE_HOST_SUFFIXES: tuple[str, ...] = (
    "cloudfront.net",
    "tealiumiq.com",
    "tiqcdn.com",
    "demdex.net",
    "doubleclick.net",
    "google-analytics.com",
    "googletagmanager.com",
    "gstatic.com",
    "googleapis.com",
    "segment.com",
    "mixpanel.com",
    "intercom.io",
    "zendesk.com",
    "crisp.chat",
    "hotjar.com",
    "fullstory.com",
    "heap.io",
    "amplitude.com",
    "auth0.com",
    "okta.com",
    "jsdelivr.net",
    "cdnjs.cloudflare.com",
    "unpkg.com",
    "npmjs.com",
    "github.com",
    "githubusercontent.com",
    "stackoverflow.com",
    "medium.com",
    "snyk.io",
    "cve.mitre.org",
    "nvd.nist.gov",
    "cvedetails.com",
    "bugcrowd.com",
    "hackerone.com",
    "yeswehack.com",
    "linkedin.com",
    "twitter.com",
    "facebook.com",
    "instagram.com",
    "bing.com",
    "google.com",
    "google.co.in",
    "google.co.uk",
    "builder.io",
    "bugherd.com",
    "brightcove.net",
    "brightcove.com",
    "irmau.com",
    "mutinycdn.com",
    "cookiebot.com",
    "evil.com",
)

# Host prefixes that are almost always infrastructure-only
_NOISE_HOST_PREFIXES: tuple[str, ...] = (
    "analytics.",
    "cdn.",
    "assets.",
    "static.",
    "gdpr.",
    "tags.",
    "metrics.",
    "smetrics.",
    "pixel.",
    "pixels.",
    "tracking.",
    "telemetry.",
    "beacon.",
)

# Markers that indicate a value is a shell command, not a host
_INVALID_HOST_MARKERS: tuple[str, ...] = (
    " ",
    "\t",
    "for t in",
    "command -v",
    "verify_",
    "create_hypothesis",
    "create_verifier",
    "create_objective",
    "cd ",
    "&&",
    "||",
    ";",
    "|",
    "$(",
    "${",
    "`",
)


def _is_noise_host(host: str) -> bool:
    """Filter out CDN/analytics, private IPs, tool-name garbage, and invalid hosts."""
    if not host:
        return True
    lowered = host.lower().strip().strip(".")
    if not lowered:
        return True
    if lowered in _INVALID_HOST_TOKENS:
        return True
    if any(marker in lowered for marker in _INVALID_HOST_MARKERS):
        return True
    if "." not in lowered:
        return True
    if "/" in lowered or "\\" in lowered:
        return True
    if lowered.startswith(("192.168.", "10.", "127.", "169.254.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.")):
        return True
    if ".uat." in f".{lowered}." or lowered.startswith("uat.") or lowered.endswith(".uat"):
        return True
    if any(lowered == suffix or lowered.endswith("." + suffix) for suffix in _NOISE_HOST_SUFFIXES):
        return True
    if any(lowered.startswith(prefix) for prefix in _NOISE_HOST_PREFIXES):
        return True
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", lowered):
        return True
    return False


def extract_hosts(text: str) -> set[str]:
    """Extract candidate hosts from text, rejecting noise, tool names, and commands."""
    hosts: set[str] = set()
    for value in re.findall(
        r"https?://[^\s'\"<>]+|(?<![A-Za-z0-9.-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?![A-Za-z0-9.-])",
        text,
    ):
        host = urlparse(value).hostname if "://" in value else value.strip().lower()
        if host and not _is_noise_host(host):
            hosts.add(host.lower())
    return hosts


def _stable_id(prefix: str, *parts: str) -> str:
    payload = "\n".join(parts).encode("utf-8", errors="replace")
    return f"{prefix}-{hashlib.sha1(payload).hexdigest()[:12]}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _short(value: str, limit: int) -> str:
    cleaned = " ".join(str(value).split())
    return cleaned if len(cleaned) <= limit else cleaned[:limit] + "..."


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)
