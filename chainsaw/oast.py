"""Local out-of-band interaction server for blind SSRF/XSS testing."""

from __future__ import annotations

import json
import re
import socket
import socketserver
import sqlite3
import struct
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .secrets import SENSITIVE_HEADERS

MAX_BODY = 128 * 1024


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _redact(headers: dict[str, str]) -> dict[str, str]:
    return {
        key: "«redacted»" if key.lower() in SENSITIVE_HEADERS else value
        for key, value in headers.items()
    }


@dataclass(frozen=True)
class OASTToken:
    token: str
    project_id: str
    url: str
    note: str
    created_at: str

    def to_dict(self, hits: int = 0) -> dict[str, Any]:
        return {
            "token": self.token,
            "projectId": self.project_id,
            "url": self.url,
            "note": self.note,
            "createdAt": self.created_at,
            "hits": hits,
        }


class OASTStore:
    def __init__(self, db_path: Path, project_id: str) -> None:
        self.db_path = db_path
        self.project_id = project_id
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(
            str(db_path), timeout=10, check_same_thread=False
        )
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._lock = threading.Lock()
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS oast_tokens(
                token TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                url TEXT NOT NULL,
                note TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS oast_events(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                token TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                query TEXT NOT NULL,
                headers TEXT NOT NULL,
                body TEXT NOT NULL,
                remote TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def add_token(self, token: OASTToken) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO oast_tokens(token,project_id,url,note,created_at) "
                "VALUES(?,?,?,?,?)",
                (token.token, token.project_id, token.url, token.note, token.created_at),
            )
            self.conn.commit()

    def tokens(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT t.token,t.project_id,t.url,t.note,t.created_at,COUNT(e.id) "
                "FROM oast_tokens t LEFT JOIN oast_events e ON e.token=t.token "
                "WHERE t.project_id=? GROUP BY t.token ORDER BY t.created_at DESC",
                (self.project_id,),
            ).fetchall()
        return [
            {
                "token": row[0],
                "projectId": row[1],
                "url": row[2],
                "note": row[3],
                "createdAt": row[4],
                "hits": int(row[5]),
            }
            for row in rows
        ]

    def record(
        self,
        *,
        token: str,
        method: str,
        path: str,
        query: str,
        headers: dict[str, str],
        body: str,
        remote: str,
    ) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO oast_events(project_id,token,method,path,query,headers,body,remote,created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    self.project_id,
                    token,
                    method,
                    path,
                    query,
                    json.dumps(_redact(headers), ensure_ascii=False, sort_keys=True),
                    body[:MAX_BODY],
                    remote,
                    _now(),
                ),
            )
            self.conn.commit()

    def events(self, token: str = "") -> list[dict[str, Any]]:
        with self._lock:
            if token:
                rows = self.conn.execute(
                    "SELECT id,token,method,path,query,headers,body,remote,created_at "
                    "FROM oast_events WHERE project_id=? AND token=? ORDER BY id DESC",
                    (self.project_id, token),
                ).fetchall()
            else:
                rows = self.conn.execute(
                    "SELECT id,token,method,path,query,headers,body,remote,created_at "
                    "FROM oast_events WHERE project_id=? ORDER BY id DESC",
                    (self.project_id,),
                ).fetchall()
        return [
            {
                "id": row[0],
                "token": row[1],
                "method": row[2],
                "path": row[3],
                "query": row[4],
                "headers": json.loads(row[5] or "{}"),
                "body": row[6],
                "remote": row[7],
                "createdAt": row[8],
            }
            for row in rows
        ]

    def event(self, event_id: int) -> dict[str, Any] | None:
        with self._lock:
            row = self.conn.execute(
                "SELECT id,token,method,path,query,headers,body,remote,created_at "
                "FROM oast_events WHERE project_id=? AND id=?",
                (self.project_id, event_id),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "token": row[1],
            "method": row[2],
            "path": row[3],
            "query": row[4],
            "headers": json.loads(row[5] or "{}"),
            "body": row[6],
            "remote": row[7],
            "createdAt": row[8],
        }


class OASTDNSServer(socketserver.ThreadingUDPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[socketserver.BaseRequestHandler],
        *,
        oast: OASTServer,
        answer_ip: str,
    ) -> None:
        self.oast = oast
        self.answer_ip = answer_ip
        super().__init__(server_address, handler_class)


class _DNSHandler(socketserver.BaseRequestHandler):
    server: OASTDNSServer

    def handle(self) -> None:
        data, sock = self.request
        parsed = _parse_dns_query(data)
        if parsed is None:
            return
        query_id, name, qtype, question_end = parsed
        token = name.split(".", 1)[0] if name else ""
        if token.startswith("oast_"):
            self.server.oast.store.record(
                token=token,
                method="DNS",
                path=name,
                query=str(qtype),
                headers={},
                body="",
                remote=self.client_address[0] if self.client_address else "",
            )
        response = _build_dns_response(
            data,
            query_id=query_id,
            question_end=question_end,
            answer_ip=self.server.answer_ip,
        )
        sock.sendto(response, self.client_address)


def _parse_dns_query(data: bytes) -> tuple[int, str, int, int] | None:
    if len(data) < 12:
        return None
    query_id = struct.unpack("!H", data[:2])[0]
    qdcount = struct.unpack("!H", data[4:6])[0]
    if qdcount < 1:
        return None
    index = 12
    labels: list[str] = []
    while index < len(data):
        length = data[index]
        index += 1
        if length == 0:
            break
        if length & 0xC0:
            return None
        if index + length > len(data):
            return None
        labels.append(data[index : index + length].decode("ascii", errors="replace"))
        index += length
    if index + 4 > len(data):
        return None
    qtype = struct.unpack("!H", data[index : index + 2])[0]
    question_end = index + 4
    return query_id, ".".join(labels), qtype, question_end


def _build_dns_response(
    query: bytes,
    *,
    query_id: int,
    question_end: int,
    answer_ip: str,
) -> bytes:
    flags = struct.unpack("!H", query[2:4])[0]
    response_flags = 0x8000 | (flags & 0x0100) | 0x0080  # QR, RD, RA
    header = struct.pack("!HHHHHH", query_id, response_flags, 1, 1, 0, 0)
    question = query[12:question_end]
    answer = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4)
    try:
        answer += socket.inet_aton(answer_ip)
    except OSError:
        answer += socket.inet_aton("127.0.0.1")
    return header + question + answer


class OASTServer:
    def __init__(
        self,
        *,
        project_path: Path,
        project_id: str,
        host: str = "127.0.0.1",
        port: int = 0,
        dns_port: int = 0,
        dns_domain: str = "oast.local",
        answer_ip: str = "127.0.0.1",
    ) -> None:
        self.project_path = project_path
        self.project_id = project_id
        self.host = host
        self.requested_port = port
        self.dns_port = dns_port
        self.dns_domain = dns_domain.strip(".") or "oast.local"
        self.answer_ip = answer_ip
        self.store = OASTStore(project_path / ".chainsaw" / "oast.db", project_id)
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._dns_server: OASTDNSServer | None = None
        self._dns_thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        if self._server is None:
            return self.requested_port
        return int(self._server.server_address[1])

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        server = ThreadingHTTPServer((self.host, self.requested_port), _OASTHandler)
        server.oast = self  # type: ignore[attr-defined]
        server.daemon_threads = True
        dns_server = OASTDNSServer(
            (self.host, self.dns_port),
            _DNSHandler,
            oast=self,
            answer_ip=self.answer_ip,
        )
        self._server = server
        self._dns_server = dns_server
        self._thread = threading.Thread(target=server.serve_forever, daemon=True)
        self._dns_thread = threading.Thread(target=dns_server.serve_forever, daemon=True)
        self._thread.start()
        self._dns_thread.start()

    def stop(self) -> None:
        server, thread = self._server, self._thread
        dns_server, dns_thread = self._dns_server, self._dns_thread
        self._server = None
        self._thread = None
        self._dns_server = None
        self._dns_thread = None
        if server is not None:
            server.shutdown()
            server.server_close()
        if dns_server is not None:
            dns_server.shutdown()
            dns_server.server_close()
        if thread is not None and thread.is_alive():
            thread.join(timeout=3)
        if dns_thread is not None and dns_thread.is_alive():
            dns_thread.join(timeout=3)
        self.store.close()

    @property
    def actual_dns_port(self) -> int:
        if self._dns_server is None:
            return self.dns_port
        return int(self._dns_server.server_address[1])

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "projectId": self.project_id,
            "host": self.host,
            "port": self.port,
            "url": f"http://{self.host}:{self.port}",
            "dnsPort": self.actual_dns_port,
            "dnsDomain": self.dns_domain,
            "tokenCount": len(self.store.tokens()),
            "eventCount": len(self.store.events()),
        }

    def create_token(self, note: str = "") -> dict[str, Any]:
        token = "oast_" + uuid.uuid4().hex[:24]
        url = f"http://{self.host}:{self.port}/t/{token}"
        dns_name = f"{token}.{self.dns_domain}" if self.dns_domain else ""
        item = OASTToken(
            token=token,
            project_id=self.project_id,
            url=url,
            note=note,
            created_at=_now(),
        )
        self.store.add_token(item)
        return {**item.to_dict(), "dnsName": dns_name}


class _OASTHandler(BaseHTTPRequestHandler):
    server: ThreadingHTTPServer

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_PUT(self) -> None:  # noqa: N802
        self._handle()

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle()

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle()

    def _handle(self) -> None:
        oast: OASTServer = self.server.oast  # type: ignore[attr-defined]
        parts = urlsplit(self.path)
        token = ""
        match = re.match(r"^/t/([A-Za-z0-9_-]+)$", parts.path)
        if match:
            token = match.group(1)
        else:
            token = (parse_qs(parts.query).get("token") or [""])[0]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(min(length, MAX_BODY)) if length else b""
        if token:
            headers = {key: value for key, value in self.headers.items()}
            oast.store.record(
                token=token,
                method=self.command,
                path=parts.path,
                query=parts.query,
                headers=headers,
                body=body.decode("utf-8", errors="replace"),
                remote=self.client_address[0] if self.client_address else "",
            )
        payload = b"ok" if token else b"unknown token"
        self.send_response(200 if token else 404)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args: object) -> None:
        return


class OASTManager:
    def __init__(self) -> None:
        self._servers: dict[str, OASTServer] = {}
        self._lock = threading.Lock()

    def start(
        self,
        *,
        project_path: Path,
        project_id: str,
        host: str = "127.0.0.1",
        port: int = 0,
        dns_port: int = 0,
        dns_domain: str = "oast.local",
        answer_ip: str = "127.0.0.1",
    ) -> dict[str, Any]:
        with self._lock:
            existing = self._servers.get(project_id)
            if existing is not None and existing.running:
                return existing.status()
            server = OASTServer(
                project_path=project_path,
                project_id=project_id,
                host=host,
                port=port,
                dns_port=dns_port,
                dns_domain=dns_domain,
                answer_ip=answer_ip,
            )
            server.start()
            self._servers[project_id] = server
            return server.status()

    def stop(self, project_id: str) -> dict[str, Any]:
        with self._lock:
            server = self._servers.pop(project_id, None)
        if server is None:
            return {"running": False, "projectId": project_id}
        status = server.status()
        server.stop()
        return {**status, "running": False}

    def get(self, project_id: str) -> OASTServer | None:
        server = self._servers.get(project_id)
        return server if server is not None and server.running else None

    def stop_all(self) -> None:
        with self._lock:
            servers = list(self._servers.values())
            self._servers.clear()
        for server in servers:
            server.stop()
