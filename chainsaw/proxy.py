"""Scope-aware local capture proxy.

HTTP requests are forwarded and captured directly. HTTPS requests are tunneled
with CONNECT, terminated with a per-host certificate signed by the local CA,
then forwarded and captured. One request/response per connection keeps the
implementation small and predictable.

WebSocket upgrades are relayed as raw bytes after the handshake so the session
keeps working. The handshake itself is recorded as a flow tagged ``websocket``;
individual frames are not parsed or stored.
"""

from __future__ import annotations

import select
import socket
import socketserver
import ssl
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from .ca import CertificateAuthority
from .governor import RateLimitExceeded, RequestGovernor
from .secrets import SecretBox
from .workbench import MAX_STORED_BODY, Flow, ScopePolicy, WorkbenchStore

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "expect",
}
MAX_HEADER_BYTES = 64 * 1024


class ProxyError(RuntimeError):
    pass


@dataclass(frozen=True)
class _Request:
    method: str
    target: str
    version: str
    headers: list[tuple[str, str]]
    body: bytes

    def header(self, name: str, default: str = "") -> str:
        lowered = name.lower()
        for key, value in self.headers:
            if key.lower() == lowered:
                return value
        return default


class _BufferedSocket:
    def __init__(self, sock: socket.socket) -> None:
        self.sock = sock
        self.buffer = b""

    def read_until(self, marker: bytes, limit: int = MAX_HEADER_BYTES) -> bytes | None:
        while marker not in self.buffer:
            chunk = self.sock.recv(65536)
            if not chunk:
                return None
            self.buffer += chunk
            if len(self.buffer) > limit:
                raise ProxyError("request headers exceed limit")
        head, self.buffer = self.buffer.split(marker, 1)
        return head

    def read_exact(self, size: int) -> bytes:
        while len(self.buffer) < size:
            chunk = self.sock.recv(max(65536, size - len(self.buffer)))
            if not chunk:
                raise ProxyError("unexpected EOF in request body")
            self.buffer += chunk
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data

    def read_chunked(self) -> bytes:
        chunks: list[bytes] = []
        while True:
            line = self.read_until(b"\r\n")
            if line is None:
                raise ProxyError("unexpected EOF in chunked body")
            size_text = line.split(b";", 1)[0].strip()
            try:
                size = int(size_text, 16)
            except ValueError as exc:
                raise ProxyError("invalid chunk size") from exc
            if size == 0:
                self.read_until(b"\r\n")
                break
            chunks.append(self.read_exact(size))
            self.read_exact(2)
        return b"".join(chunks)

    def read_request(self) -> _Request | None:
        head = self.read_until(b"\r\n\r\n")
        if head is None or not head.strip():
            return None
        text = head.decode("latin-1")
        lines = text.split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) < 3:
            raise ProxyError("malformed request line")
        headers: list[tuple[str, str]] = []
        for line in lines[1:]:
            key, sep, value = line.partition(":")
            if sep:
                headers.append((key.strip(), value.strip()))
        probe = _Request(parts[0].upper(), parts[1], parts[2], headers, b"")
        body = b""
        if "chunked" in probe.header("transfer-encoding").lower():
            body = self.read_chunked()
        else:
            length_text = probe.header("content-length")
            if length_text:
                try:
                    body = self.read_exact(int(length_text))
                except ValueError as exc:
                    raise ProxyError("invalid content-length") from exc
        return _Request(parts[0].upper(), parts[1], parts[2], headers, body)


def _split_host_port(value: str, default_port: int) -> tuple[str, int]:
    value = value.strip()
    if value.startswith("["):
        host, _, rest = value[1:].partition("]")
        port = int(rest.lstrip(":") or default_port)
        return host, port
    if ":" in value:
        host, _, port_text = value.rpartition(":")
        if port_text.isdigit():
            return host, int(port_text)
    return value, default_port


def _target_url(request: _Request, *, scheme: str, tunnel_host: str = "") -> str:
    if request.target.startswith(("http://", "https://")):
        return request.target
    host = tunnel_host or request.header("host")
    if not host:
        raise ProxyError("missing Host header")
    return f"{scheme}://{host}{request.target}"


def _headers_dict(headers: list[tuple[str, str]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in headers:
        if key.lower() not in HOP_BY_HOP and key.lower() not in {"host", "content-length"}:
            result[key] = value
    return result


def _is_websocket_upgrade(request: _Request) -> bool:
    if "websocket" not in request.header("upgrade").lower():
        return False
    connection = request.header("connection").lower()
    return any(token.strip() == "upgrade" for token in connection.split(","))


def _origin(url: str) -> tuple[str, int]:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if not host:
        raise ProxyError("missing host")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    return host, port


def _tls_context(verify: bool) -> ssl.SSLContext:
    if verify:
        return ssl.create_default_context()
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def _write_response(sock: socket.socket, status: int, reason: str, headers: list[tuple[str, str]], body: bytes) -> None:
    filtered = [
        (key, value)
        for key, value in headers
        if key.lower() not in {"content-encoding", "content-length", "transfer-encoding", "connection"}
    ]
    filtered.append(("Content-Length", str(len(body))))
    filtered.append(("Connection", "close"))
    head = [f"HTTP/1.1 {status} {reason}", *[f"{key}: {value}" for key, value in filtered], "", ""]
    sock.sendall("\r\n".join(head).encode("latin-1") + body)


class _ProxyHandler(socketserver.BaseRequestHandler):
    server: _ProxyServer

    def handle(self) -> None:
        proxy = self.server.capture_proxy
        sock = self.request
        sock.settimeout(proxy.timeout)
        reader = _BufferedSocket(sock)
        try:
            request = reader.read_request()
        except (ProxyError, OSError):
            return
        if request is None:
            return
        if request.method == "CONNECT":
            self._handle_connect(proxy, request)
            return
        self._handle_http(proxy, sock, request)

    def _handle_connect(self, proxy: CaptureProxy, request: _Request) -> None:
        try:
            host, port = _split_host_port(request.target, 443)
        except ValueError:
            return
        try:
            self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            context = proxy.ca.leaf_context(host)
            tls_socket = context.wrap_socket(self.request, server_side=True)
        except (OSError, ssl.SSLError, ValueError):
            return
        tls_socket.settimeout(proxy.timeout)
        try:
            reader = _BufferedSocket(tls_socket)
            inner = reader.read_request()
            if inner is None:
                return
            inner.headers.append(("Host", f"{host}:{port}" if port != 443 else host))
            self._forward(
                proxy, tls_socket, inner, scheme="https", pending=reader.buffer
            )
        except (ProxyError, OSError, ssl.SSLError):
            return
        finally:
            try:
                tls_socket.close()
            except OSError:
                pass

    def _handle_http(self, proxy: CaptureProxy, sock: socket.socket, request: _Request) -> None:
        self._forward(proxy, sock, request, scheme="http", pending=b"")

    def _forward(
        self,
        proxy: CaptureProxy,
        sock: socket.socket,
        request: _Request,
        *,
        scheme: str,
        pending: bytes = b"",
    ) -> None:
        try:
            url = _target_url(request, scheme=scheme)
        except ProxyError as exc:
            _write_response(sock, 400, "Bad Request", [], str(exc).encode())
            return
        decision = proxy.policy.check(url)
        if not decision.allowed:
            body = f"Blocked by scope: {decision.reason}".encode()
            self._record(proxy, request, url, 403, {}, body, 0, in_scope=False, tags=["scope-blocked"])
            _write_response(sock, 403, "Forbidden", [("Content-Type", "text/plain")], body)
            return

        if _is_websocket_upgrade(request):
            self._relay_websocket(proxy, sock, request, url=url, pending=pending)
            return

        headers = _headers_dict(request.headers)
        started = time.perf_counter()
        try:
            if proxy.governor is not None:
                proxy.governor.acquire(url, method=request.method)
        except RateLimitExceeded as exc:
            body = f"Rate limited by local governor: {exc}".encode()
            self._record(
                proxy, request, url, 429, {}, body, 0, in_scope=True, tags=["rate-limited"]
            )
            _write_response(sock, 429, "Too Many Requests", [("Content-Type", "text/plain")], body)
            return
        try:
            with httpx.Client(
                follow_redirects=False,
                timeout=proxy.timeout,
                trust_env=False,
                verify=proxy.verify_upstream,
            ) as client:
                response = client.request(
                    request.method,
                    url,
                    headers=headers,
                    content=request.body or None,
                )
        except httpx.HTTPError as exc:
            body = f"Upstream request failed: {exc.__class__.__name__}".encode()
            self._record(proxy, request, url, 502, {}, body, 0, in_scope=True, tags=["proxy-error"])
            _write_response(sock, 502, "Bad Gateway", [("Content-Type", "text/plain")], body)
            return
        finally:
            if proxy.governor is not None:
                proxy.governor.release(url)
        if proxy.governor is not None:
            proxy.governor.observe(url, response.status_code)
        duration_ms = int((time.perf_counter() - started) * 1000)
        full_content = response.content
        stored_content = full_content[:MAX_STORED_BODY]
        response_headers = {str(key): str(value) for key, value in response.headers.items()}
        self._record(
            proxy,
            request,
            url,
            response.status_code,
            response_headers,
            stored_content,
            duration_ms,
            in_scope=True,
            tags=["proxy"],
        )
        _write_response(
            sock,
            response.status_code,
            response.reason_phrase,
            list(response.headers.multi_items()),
            full_content,
        )

    def _relay_websocket(
        self,
        proxy: CaptureProxy,
        sock: socket.socket,
        request: _Request,
        *,
        url: str,
        pending: bytes,
    ) -> None:
        parts = urlsplit(url)
        try:
            host, port = _origin(url)
        except ProxyError as exc:
            _write_response(sock, 400, "Bad Request", [], str(exc).encode())
            return
        target = parts.path or "/"
        if parts.query:
            target = f"{target}?{parts.query}"
        governor = proxy.governor
        if governor is not None:
            try:
                governor.acquire(url, method=request.method)
            except RateLimitExceeded as exc:
                body = f"Rate limited by local governor: {exc}".encode()
                self._record(
                    proxy,
                    request,
                    url,
                    429,
                    {},
                    body,
                    0,
                    in_scope=True,
                    tags=["rate-limited"],
                )
                _write_response(
                    sock, 429, "Too Many Requests", [("Content-Type", "text/plain")], body
                )
                return
        held = governor is not None

        def release() -> None:
            nonlocal held
            if held and governor is not None:
                governor.release(url)
                held = False

        try:
            upstream = socket.create_connection((host, port), timeout=proxy.timeout)
        except OSError as exc:
            release()
            body = f"Upstream connection failed: {exc.__class__.__name__}".encode()
            self._record(
                proxy, request, url, 502, {}, body, 0, in_scope=True, tags=["proxy-error"]
            )
            _write_response(sock, 502, "Bad Gateway", [("Content-Type", "text/plain")], body)
            return
        started = time.perf_counter()
        try:
            if parts.scheme == "https":
                upstream = _tls_context(proxy.verify_upstream).wrap_socket(
                    upstream, server_hostname=host
                )
            lines = [f"{request.method} {target} HTTP/1.1"]
            for key, value in request.headers:
                lowered = key.lower()
                if lowered in {"host", "proxy-connection", "proxy-authorization"}:
                    continue
                lines.append(f"{key}: {value}")
            default_port = 443 if parts.scheme == "https" else 80
            host_header = f"{host}:{port}" if port != default_port else host
            lines.extend([f"Host: {host_header}", "", ""])
            upstream.sendall("\r\n".join(lines).encode("latin-1"))
            if request.body:
                upstream.sendall(request.body)

            reader = _BufferedSocket(upstream)
            head = reader.read_until(b"\r\n\r\n")
            if head is None:
                raise ProxyError("upstream closed before upgrade response")
            status_text = head.split(b"\r\n", 1)[0].decode("latin-1")
            pieces = status_text.split(" ", 2)
            if len(pieces) < 2 or not pieces[1].isdigit():
                raise ProxyError("malformed upgrade response")
            status = int(pieces[1])
            response_headers: dict[str, str] = {}
            for line in head.decode("latin-1").split("\r\n")[1:]:
                key, sep, value = line.partition(":")
                if sep:
                    response_headers[key.strip()] = value.strip()
        except (ProxyError, OSError, ssl.SSLError) as exc:
            release()
            body = f"Upgrade failed: {exc.__class__.__name__}".encode()
            self._record(
                proxy, request, url, 502, {}, body, 0, in_scope=True, tags=["proxy-error"]
            )
            _write_response(sock, 502, "Bad Gateway", [("Content-Type", "text/plain")], body)
            try:
                upstream.close()
            except OSError:
                pass
            return

        duration_ms = int((time.perf_counter() - started) * 1000)
        tags = ["websocket"] if status == 101 else ["websocket", "upgrade-failed"]
        if governor is not None:
            governor.observe(url, status)
        release()
        self._record(
            proxy,
            request,
            url,
            status,
            response_headers,
            b"",
            duration_ms,
            in_scope=True,
            tags=tags,
        )
        try:
            sock.sendall(head + b"\r\n\r\n" + reader.buffer)
            if pending:
                upstream.sendall(pending)
            if status != 101:
                while True:
                    chunk = upstream.recv(65536)
                    if not chunk:
                        break
                    sock.sendall(chunk)
                return
            self._pump(proxy, sock, upstream)
        except (OSError, ssl.SSLError):
            return
        finally:
            release()
            try:
                upstream.close()
            except OSError:
                pass

    def _pump(self, proxy: CaptureProxy, client: socket.socket, upstream: socket.socket) -> None:
        for peer in (client, upstream):
            try:
                peer.settimeout(None)
            except OSError:
                return
        sources = {client, upstream}
        while sources and proxy.running:
            try:
                readable, _, _ = select.select(list(sources), [], [], 5.0)
            except (OSError, ValueError):
                return
            for source in readable:
                try:
                    data = source.recv(65536)
                except OSError:
                    return
                target = upstream if source is client else client
                if not data:
                    sources.discard(source)
                    try:
                        target.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass
                    continue
                try:
                    target.sendall(data)
                except OSError:
                    return

    def _record(
        self,
        proxy: CaptureProxy,
        request: _Request,
        url: str,
        status: int,
        response_headers: dict[str, str],
        response_body: bytes,
        duration_ms: int,
        *,
        in_scope: bool,
        tags: list[str],
    ) -> None:
        flow = Flow(
            id="req_" + uuid.uuid4().hex[:24],
            project_id=proxy.project_id,
            method=request.method,
            url=url,
            host="",
            path="",
            status=status,
            request_headers={key: value for key, value in request.headers},
            request_body=request.body.decode("utf-8", errors="replace")[:MAX_STORED_BODY],
            response_headers=response_headers,
            response_body=response_body.decode("utf-8", errors="replace"),
            size_bytes=len(response_body),
            duration_ms=duration_ms,
            auth_context="",
            tags=tags,
            in_scope=in_scope,
            source="capture",
        )
        try:
            with WorkbenchStore(
                proxy.db_path, proxy.project_id, secret_box=proxy.secret_box
            ) as store:
                store.add_flow(flow)
        except Exception:
            return


class _ProxyServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    capture_proxy: CaptureProxy


class CaptureProxy:
    def __init__(
        self,
        *,
        project_path: Path,
        project_id: str,
        policy: ScopePolicy,
        ca: CertificateAuthority,
        host: str = "127.0.0.1",
        port: int = 8080,
        timeout: float = 30.0,
        verify_upstream: bool = True,
        governor: RequestGovernor | None = None,
        secret_box: SecretBox | None = None,
    ) -> None:
        self.project_path = project_path
        self.project_id = project_id
        self.policy = policy
        self.ca = ca
        self.host = host
        self.requested_port = port
        self.timeout = timeout
        self.verify_upstream = verify_upstream
        self.governor = governor
        self.secret_box = secret_box
        self.db_path = project_path / ".chainsaw" / "workbench.db"
        self._server: _ProxyServer | None = None
        self._thread: threading.Thread | None = None

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
        server = _ProxyServer((self.host, self.requested_port), _ProxyHandler)
        server.capture_proxy = self
        self._server = server
        self._thread = threading.Thread(target=server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        server, thread = self._server, self._thread
        self._server = None
        self._thread = None
        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None and thread.is_alive():
            thread.join(timeout=3)

    def status(self) -> dict[str, Any]:
        captured = 0
        try:
            with WorkbenchStore(self.db_path, self.project_id) as store:
                _, captured = store.list_flows(limit=1, offset=0)
        except Exception:
            pass
        return {
            "running": self.running,
            "projectId": self.project_id,
            "host": self.host,
            "port": self.port,
            "proxyUrl": f"http://{self.host}:{self.port}",
            "caPath": str(self.ca.cert_path) if self.ca.exists() else None,
            "captured": captured,
            "verifyUpstream": self.verify_upstream,
            "rateLimit": (
                {
                    "requestsPerSecond": self.governor.policy.requests_per_second,
                    "burst": self.governor.policy.burst,
                    "maxInFlight": self.governor.policy.max_in_flight,
                }
                if self.governor is not None
                else None
            ),
        }


class ProxyManager:
    def __init__(self, ca_root: Path) -> None:
        self.ca_root = ca_root
        self.secrets = SecretBox(ca_root)
        self._proxies: dict[str, CaptureProxy] = {}
        self._lock = threading.Lock()

    def start(
        self,
        *,
        project_path: Path,
        project_id: str,
        policy: ScopePolicy,
        host: str = "127.0.0.1",
        port: int = 8080,
        verify_upstream: bool = True,
        noise_profile: str = "balanced",
    ) -> dict[str, Any]:
        with self._lock:
            existing = self._proxies.get(project_id)
            if existing is not None and existing.running:
                return existing.status()
            ca = CertificateAuthority(self.ca_root / "ca").ensure()
            proxy = CaptureProxy(
                project_path=project_path,
                project_id=project_id,
                policy=policy,
                ca=ca,
                host=host,
                port=port,
                verify_upstream=verify_upstream,
                governor=RequestGovernor.from_profile(noise_profile),
                secret_box=self.secrets,
            )
            proxy.start()
            self._proxies[project_id] = proxy
            return proxy.status()

    def stop(self, project_id: str) -> dict[str, Any]:
        with self._lock:
            proxy = self._proxies.pop(project_id, None)
        if proxy is None:
            return {"running": False, "projectId": project_id}
        status = proxy.status()
        proxy.stop()
        return {**status, "running": False}

    def status(self, project_id: str) -> dict[str, Any]:
        proxy = self._proxies.get(project_id)
        if proxy is None:
            return {"running": False, "projectId": project_id}
        return proxy.status()

    def stop_all(self) -> None:
        with self._lock:
            proxies = list(self._proxies.values())
            self._proxies.clear()
        for proxy in proxies:
            proxy.stop()
