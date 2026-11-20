"""Local desktop launcher: start the API/UI and open a native window.

No installer, no service. The user runs this after the one-time dependency and UI
build steps. `pywebview` is optional; without it the default browser opens.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[1]
UI_DIST = ROOT / "ui" / "dist"
DEFAULT_PORT = 8765


def _base_url(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def _healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(_base_url(port) + "/api/v1/health", timeout=1) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _open_native(url: str) -> bool:
    try:
        import webview  # type: ignore[import-not-found]
    except ImportError:
        return False
    webview.create_window("ChainsawRecon", url, width=1440, height=900)
    webview.start()
    return True


def main() -> int:
    if not (UI_DIST / "index.html").exists():
        print("UI build not found.")
        print("Run:")
        print("  npm --prefix ui install")
        print("  npm --prefix ui run build")
        return 1
    raw_port = os.environ.get("CHAINSAW_API_PORT", "").strip()
    try:
        port = int(raw_port) if raw_port else DEFAULT_PORT
    except ValueError:
        print(f"CHAINSAW_API_PORT must be a number, got {raw_port!r}.")
        return 2
    url = _base_url(port)
    if _healthy(port):
        if not _open_native(url):
            webbrowser.open(url)
        return 0
    if not _port_available(port):
        fallback = _free_port()
        print(f"Port {port} is in use; using {fallback} instead.")
        port = fallback
        url = _base_url(port)

    config = uvicorn.Config(
        "chainsaw.api.main:app",
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if _healthy(port):
            break
        time.sleep(0.2)
    else:
        print("ChainsawRecon API did not start within 20 seconds.")
        return 1

    if _open_native(url):
        server.should_exit = True
        thread.join(timeout=5)
        return 0

    print(f"ChainsawRecon is running at {url}")
    print("Close this window or press Ctrl+C to stop.")
    webbrowser.open(url)
    try:
        while thread.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        server.should_exit = True
        thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
