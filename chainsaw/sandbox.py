"""Native process execution boundary.

This is the first native sandbox implementation. It is deliberately conservative:
if the platform backend cannot be constructed, the caller must fail closed.

- Linux: bubblewrap (bwrap). Filesystem is read-only except the workspace and /tmp.
- macOS: sandbox-exec (Seatbelt). Read-only host, write only workspace and /tmp.
- Windows: Job Object process limits. This is a partial backend: it bounds process
  lifetime and resources but does not yet provide full filesystem isolation, so
  shell execution remains opt-in and is labelled accordingly.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_TIMEOUT = 60
MAX_OUTPUT = 200_000
ENV_ALLOWLIST = {
    "PATH",
    "HOME",
    "USER",
    "USERNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
}


@dataclass(frozen=True)
class SandboxResult:
    command: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False
    truncated: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "command": self.command,
            "exitCode": self.exit_code,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "durationMs": self.duration_ms,
            "timedOut": self.timed_out,
            "truncated": self.truncated,
        }


@dataclass
class SandboxConfig:
    workspace: Path
    allow_network: bool = True
    timeout: int = DEFAULT_TIMEOUT
    max_output: int = MAX_OUTPUT
    env: dict[str, str] = field(default_factory=dict)

    def environment(self) -> dict[str, str]:
        env = {key: value for key, value in os.environ.items() if key in ENV_ALLOWLIST}
        env.update(self.env)
        env.setdefault("TMPDIR", str(self.workspace / ".tmp"))
        env.setdefault("TEMP", str(self.workspace / ".tmp"))
        env.setdefault("TMP", str(self.workspace / ".tmp"))
        return env


class SandboxError(RuntimeError):
    pass


class SandboxRunner:
    name = "none"
    strength = "none"

    def __init__(self, config: SandboxConfig) -> None:
        self.config = config
        self.config.workspace.mkdir(parents=True, exist_ok=True)
        (self.config.workspace / ".tmp").mkdir(parents=True, exist_ok=True)

    @property
    def available(self) -> bool:
        return False

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "strength": self.strength,
            "available": self.available,
            "workspace": str(self.config.workspace),
            "network": self.config.allow_network,
        }

    def run(self, command: str, *, timeout: int | None = None, cwd: str | Path = ".") -> SandboxResult:
        raise SandboxError(f"sandbox backend {self.name} is not available")

    def _cwd(self, cwd: str | Path) -> Path:
        target = (self.config.workspace / str(cwd).lstrip("/\\")).resolve()
        workspace = self.config.workspace.resolve()
        if target != workspace and workspace not in target.parents:
            raise SandboxError(f"cwd escapes workspace: {cwd}")
        target.mkdir(parents=True, exist_ok=True)
        return target


class WindowsLowIntegritySandbox(SandboxRunner):
    """Windows restricted-token + low-integrity + Job Object sandbox.

    The child is created suspended with a Safer ``Basic User`` restricted token
    (admin SIDs removed, privileges stripped), lowered to Low integrity, attached
    to a Job Object, then resumed. The workspace is marked Low integrity so the
    child can write there; normal user files (Medium integrity) are write-denied.

    Reads and network are still allowed: Low integrity does not block reads, and
    per-process network policy needs a firewall or AppContainer, which would
    require elevation or break ordinary tooling. This is a write/privilege
    confinement boundary, not a full filesystem or network sandbox, so a request
    for ``allow_network=False`` fails closed instead of pretending to enforce it.
    """

    name = "windows-restricted-low-integrity"
    strength = "native"

    @property
    def available(self) -> bool:
        return sys.platform == "win32"

    def __init__(self, config: SandboxConfig) -> None:
        super().__init__(config)
        self._workspace_low = self._mark_workspace_low()
        self._restricted = _safer_token_available()
        self._job_handle: Any = None

    def _mark_workspace_low(self) -> bool:
        if not self.available:
            return False
        try:
            completed = subprocess.run(
                [
                    "icacls",
                    str(self.config.workspace),
                    "/setintegritylevel",
                    "(OI)(CI)L",
                ],
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                timeout=10,
            )
            return completed.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def describe(self) -> dict[str, Any]:
        return {
            **super().describe(),
            "strength": "native",
            "filesystemWriteConfined": self._workspace_low,
            "restrictedToken": self._restricted,
            "integrityLevel": "low",
            "readsConfined": False,
            "networkConfined": False,
        }

    def run(
        self, command: str, *, timeout: int | None = None, cwd: str | Path = "."
    ) -> SandboxResult:
        if not self.available:
            raise SandboxError("Windows sandbox backend is only available on Windows")
        if not self._workspace_low:
            raise SandboxError("could not set workspace integrity to Low; refusing to run")
        if not self._restricted:
            raise SandboxError("could not create a restricted token; refusing to run")
        if not self.config.allow_network:
            raise SandboxError(
                "network confinement is not supported by the Windows sandbox; refusing to run"
            )
        target = self._cwd(cwd)
        started = time.perf_counter()
        try:
            process = _spawn_restricted(
                command,
                cwd=target,
                env=self.config.environment(),
            )
        except OSError as exc:
            raise SandboxError(str(exc)) from exc
        try:
            if not _set_low_integrity(process):
                process.kill()
                process.communicate()
                raise SandboxError("could not lower child process to Low integrity")
            _assign_job(process)
            if not _resume_process(process):
                process.kill()
                process.communicate()
                raise SandboxError("could not resume suspended child process")
            stdout, stderr, timed_out = process.communicate_with_timeout(
                timeout or self.config.timeout
            )
        finally:
            job = getattr(process, "_job_handle", None)
            if job:
                _close_job(job)
            process.close()
        duration = int((time.perf_counter() - started) * 1000)
        return _fit_output(
            command,
            process.returncode if process.returncode is not None else 124,
            stdout,
            stderr,
            duration,
            timed_out,
            self.config.max_output,
        )


def _set_low_integrity(process: Any) -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        class SID_AND_ATTRIBUTES(ctypes.Structure):
            _fields_ = [
                ("Sid", ctypes.c_void_p),
                ("Attributes", wintypes.DWORD),
            ]

        class TOKEN_MANDATORY_LABEL(ctypes.Structure):
            _fields_ = [("Label", SID_AND_ATTRIBUTES)]

        advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        token = wintypes.HANDLE()
        if not advapi.OpenProcessToken(
            wintypes.HANDLE(process._handle),  # type: ignore[attr-defined]
            0x0080 | 0x0008 | 0x0002,  # ADJUST_DEFAULT | QUERY | DUPLICATE
            ctypes.byref(token),
        ):
            return False
        sid = ctypes.c_void_p()
        if not advapi.ConvertStringSidToSidW(
            ctypes.c_wchar_p("S-1-16-4096"), ctypes.byref(sid)
        ):
            kernel32.CloseHandle(token)
            return False
        label = TOKEN_MANDATORY_LABEL()
        label.Label.Sid = sid
        label.Label.Attributes = 0x20  # SE_GROUP_INTEGRITY
        ok = advapi.SetTokenInformation(
            token,
            25,  # TokenIntegrityLevel
            ctypes.byref(label),
            ctypes.sizeof(label),
        )
        kernel32.CloseHandle(token)
        return bool(ok)
    except Exception:
        return False


def _resume_process(process: Any) -> bool:
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        ntdll = ctypes.WinDLL("ntdll")
        ntdll.NtResumeProcess.argtypes = [wintypes.HANDLE]
        ntdll.NtResumeProcess.restype = ctypes.c_long
        return int(ntdll.NtResumeProcess(wintypes.HANDLE(process._handle))) == 0  # type: ignore[attr-defined]
    except Exception:
        return False


def _safer_token_available() -> bool:
    """Check whether a Safer Basic User restricted token can be created."""
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        advapi.SaferCreateLevel.argtypes = [
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.DWORD,
            ctypes.POINTER(wintypes.HANDLE),
            ctypes.c_void_p,
        ]
        advapi.SaferCreateLevel.restype = wintypes.BOOL
        advapi.SaferComputeTokenFromLevel.argtypes = [
            wintypes.HANDLE,
            wintypes.HANDLE,
            ctypes.POINTER(wintypes.HANDLE),
            wintypes.DWORD,
            ctypes.c_void_p,
        ]
        advapi.SaferComputeTokenFromLevel.restype = wintypes.BOOL
        advapi.SaferCloseLevel.argtypes = [wintypes.HANDLE]
        advapi.SaferCloseLevel.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL

        level = wintypes.HANDLE()
        if not advapi.SaferCreateLevel(2, 0x20000, 1, ctypes.byref(level), None):
            return False
        token = wintypes.HANDLE()
        try:
            if not advapi.SaferComputeTokenFromLevel(
                level, None, ctypes.byref(token), 0, None
            ):
                return False
            return bool(token.value)
        finally:
            if token.value:
                kernel32.CloseHandle(token)
            advapi.SaferCloseLevel(level)
    except Exception:
        return False


class _RestrictedProcess:
    """Minimal Popen-like wrapper around a restricted-token process."""

    def __init__(
        self,
        handle: int,
        thread_handle: int,
        pid: int,
        stdout: Any,
        stderr: Any,
        kernel32: Any,
    ) -> None:
        self._handle = handle
        self._thread_handle = thread_handle
        self._kernel32 = kernel32
        self.pid = pid
        self.stdout = stdout
        self.stderr = stderr
        self._returncode: int | None = None

    @property
    def returncode(self) -> int | None:
        return self._returncode

    def communicate(self, timeout: float | None = None) -> tuple[str, str]:
        stdout, stderr, _ = self.communicate_with_timeout(timeout or 5.0)
        return stdout, stderr

    def communicate_with_timeout(self, timeout: float) -> tuple[str, str, bool]:
        import ctypes
        from ctypes import wintypes

        collected: tuple[list[bytes], list[bytes]] = ([], [])
        streams = (self.stdout, self.stderr)
        threads = []
        for stream, sink in zip(streams, collected, strict=False):
            thread = threading.Thread(target=_drain_stream, args=(stream, sink), daemon=True)
            thread.start()
            threads.append(thread)
        wait_ms = 0xFFFFFFFF if timeout is None else max(1, int(timeout * 1000))
        result = self._kernel32.WaitForSingleObject(wintypes.HANDLE(self._handle), wait_ms)
        timed_out = result == 258  # WAIT_TIMEOUT
        if timed_out:
            self.kill()
            self._kernel32.WaitForSingleObject(wintypes.HANDLE(self._handle), 5000)
        code = wintypes.DWORD()
        self._kernel32.GetExitCodeProcess(wintypes.HANDLE(self._handle), ctypes.byref(code))
        self._returncode = int(code.value)
        for thread in threads:
            thread.join(5)
        for stream in streams:
            try:
                stream.close()
            except OSError:
                pass
        return (
            b"".join(collected[0]).decode("utf-8", errors="replace"),
            b"".join(collected[1]).decode("utf-8", errors="replace"),
            timed_out,
        )

    def kill(self) -> None:
        from ctypes import wintypes

        if self._handle:
            self._kernel32.TerminateProcess(wintypes.HANDLE(self._handle), 124)

    def close(self) -> None:
        from ctypes import wintypes

        for handle in (self._thread_handle, self._handle):
            if handle:
                self._kernel32.CloseHandle(wintypes.HANDLE(handle))
        self._thread_handle = 0
        self._handle = 0


def _drain_stream(stream: Any, sink: list[bytes]) -> None:
    try:
        while True:
            chunk = stream.read(65536)
            if not chunk:
                return
            sink.append(chunk)
    except (OSError, ValueError):
        return


def _spawn_restricted(
    command: str, *, cwd: Path, env: dict[str, str]
) -> _RestrictedProcess:
    """Create a suspended process with a Safer Basic User restricted token.

    The token drops admin SIDs and all privileges except SeChangeNotifyPrivilege,
    which is what ``runas /trustlevel:0x20000`` uses and does not need elevation.
    """
    if sys.platform != "win32":
        raise OSError("restricted token spawn is only available on Windows")
    import ctypes
    import msvcrt
    from ctypes import wintypes

    class STARTUPINFOW(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("lpReserved", wintypes.LPWSTR),
            ("lpDesktop", wintypes.LPWSTR),
            ("lpTitle", wintypes.LPWSTR),
            ("dwX", wintypes.DWORD),
            ("dwY", wintypes.DWORD),
            ("dwXSize", wintypes.DWORD),
            ("dwYSize", wintypes.DWORD),
            ("dwXCountChars", wintypes.DWORD),
            ("dwYCountChars", wintypes.DWORD),
            ("dwFillAttribute", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("wShowWindow", wintypes.WORD),
            ("cbReserved2", wintypes.WORD),
            ("lpReserved2", ctypes.c_void_p),
            ("hStdInput", wintypes.HANDLE),
            ("hStdOutput", wintypes.HANDLE),
            ("hStdError", wintypes.HANDLE),
        ]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("hProcess", wintypes.HANDLE),
            ("hThread", wintypes.HANDLE),
            ("dwProcessId", wintypes.DWORD),
            ("dwThreadId", wintypes.DWORD),
        ]

    class SECURITY_ATTRIBUTES(ctypes.Structure):
        _fields_ = [
            ("nLength", wintypes.DWORD),
            ("lpSecurityDescriptor", ctypes.c_void_p),
            ("bInheritHandle", wintypes.BOOL),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32.CreatePipe.argtypes = [
        ctypes.POINTER(wintypes.HANDLE),
        ctypes.POINTER(wintypes.HANDLE),
        ctypes.POINTER(SECURITY_ATTRIBUTES),
        wintypes.DWORD,
    ]
    kernel32.CreatePipe.restype = wintypes.BOOL
    kernel32.SetHandleInformation.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD]
    kernel32.SetHandleInformation.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(SECURITY_ATTRIBUTES),
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    advapi.SaferCreateLevel.argtypes = [
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
        ctypes.c_void_p,
    ]
    advapi.SaferCreateLevel.restype = wintypes.BOOL
    advapi.SaferComputeTokenFromLevel.argtypes = [
        wintypes.HANDLE,
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.HANDLE),
        wintypes.DWORD,
        ctypes.c_void_p,
    ]
    advapi.SaferComputeTokenFromLevel.restype = wintypes.BOOL
    advapi.SaferCloseLevel.argtypes = [wintypes.HANDLE]
    advapi.SaferCloseLevel.restype = wintypes.BOOL
    advapi.CreateProcessAsUserW.argtypes = [
        wintypes.HANDLE,
        wintypes.LPCWSTR,
        wintypes.LPWSTR,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.BOOL,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.LPCWSTR,
        ctypes.POINTER(STARTUPINFOW),
        ctypes.POINTER(PROCESS_INFORMATION),
    ]
    advapi.CreateProcessAsUserW.restype = wintypes.BOOL

    security = SECURITY_ATTRIBUTES()
    security.nLength = ctypes.sizeof(security)
    security.bInheritHandle = True

    def make_pipe() -> tuple[int, int]:
        read = wintypes.HANDLE()
        write = wintypes.HANDLE()
        if not kernel32.CreatePipe(
            ctypes.byref(read), ctypes.byref(write), ctypes.byref(security), 0
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel32.SetHandleInformation(read, 1, 0):  # HANDLE_FLAG_INHERIT
            for handle in (read, write):
                kernel32.CloseHandle(handle)
            raise ctypes.WinError(ctypes.get_last_error())
        return int(read.value or 0), int(write.value or 0)

    level = wintypes.HANDLE()
    if not advapi.SaferCreateLevel(2, 0x20000, 1, ctypes.byref(level), None):
        raise ctypes.WinError(ctypes.get_last_error())
    token = wintypes.HANDLE()
    raw_handles: list[int] = []
    info: PROCESS_INFORMATION | None = None
    try:
        if not advapi.SaferComputeTokenFromLevel(
            level, None, ctypes.byref(token), 0, None
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        out_read, out_write = make_pipe()
        raw_handles.extend([out_read, out_write])
        err_read, err_write = make_pipe()
        raw_handles.extend([err_read, err_write])
        nul = int(
            kernel32.CreateFileW(
                "NUL",
                0x80000000,  # GENERIC_READ
                0x00000001 | 0x00000002,  # FILE_SHARE_READ | FILE_SHARE_WRITE
                ctypes.byref(security),
                3,  # OPEN_EXISTING
                0,
                None,
            )
        )
        if nul in (0, -1) or nul >= 2**63:
            raise ctypes.WinError(ctypes.get_last_error())
        raw_handles.append(nul)

        environ = "\0".join(f"{key}={value}" for key, value in sorted(env.items())) + "\0\0"
        environment = ctypes.create_unicode_buffer(environ)
        shell = env.get("COMSPEC") or os.environ.get("COMSPEC") or "cmd.exe"
        command_line = ctypes.create_unicode_buffer(f"{shell} /c {command}")
        startup = STARTUPINFOW()
        startup.cb = ctypes.sizeof(startup)
        startup.dwFlags = 0x100  # STARTF_USESTDHANDLES
        startup.hStdInput = wintypes.HANDLE(nul)
        startup.hStdOutput = wintypes.HANDLE(out_write)
        startup.hStdError = wintypes.HANDLE(err_write)
        info = PROCESS_INFORMATION()
        if not advapi.CreateProcessAsUserW(
            token,
            None,
            command_line,
            None,
            None,
            True,
            0x4 | 0x400 | 0x200,  # SUSPENDED | UNICODE_ENVIRONMENT | NEW_PROCESS_GROUP
            ctypes.cast(environment, ctypes.c_void_p),
            str(cwd),
            ctypes.byref(startup),
            ctypes.byref(info),
        ):
            raise ctypes.WinError(ctypes.get_last_error())

        for handle in (out_write, err_write, nul):
            kernel32.CloseHandle(wintypes.HANDLE(handle))
            raw_handles.remove(handle)
        streams = []
        for handle in (out_read, err_read):
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | getattr(os, "O_BINARY", 0))
            raw_handles.remove(handle)
            streams.append(os.fdopen(fd, "rb", buffering=0))
        return _RestrictedProcess(
            int(info.hProcess or 0),
            int(info.hThread or 0),
            int(info.dwProcessId),
            streams[0],
            streams[1],
            kernel32,
        )
    except Exception:
        if info is not None and info.hProcess:
            kernel32.TerminateProcess(wintypes.HANDLE(int(info.hProcess)), 1)
            kernel32.CloseHandle(wintypes.HANDLE(int(info.hProcess)))
            kernel32.CloseHandle(wintypes.HANDLE(int(info.hThread)))
        for handle in raw_handles:
            kernel32.CloseHandle(wintypes.HANDLE(handle))
        raise
    finally:
        if token.value:
            kernel32.CloseHandle(token)
        advapi.SaferCloseLevel(level)


class UnavailableSandbox(SandboxRunner):
    name = "unavailable"
    strength = "none"


class LinuxBwrapSandbox(SandboxRunner):
    name = "bwrap"
    strength = "native"

    @property
    def available(self) -> bool:
        return shutil.which("bwrap") is not None

    def build(self, command: str, cwd: str | Path = ".") -> list[str]:
        workspace = self.config.workspace.resolve()
        target = self._cwd(cwd)
        args = [
            "bwrap",
            "--die-with-parent",
            "--unshare-pid",
            "--unshare-ipc",
            "--unshare-uts",
            "--unshare-cgroup",
            "--ro-bind",
            "/",
            "/",
            "--dev",
            "/dev",
            "--proc",
            "/proc",
            "--tmpfs",
            "/tmp",
            "--bind",
            str(workspace),
            str(workspace),
            "--chdir",
            str(target),
            "--clearenv",
        ]
        if not self.config.allow_network:
            args.append("--unshare-net")
        for key, value in self.config.environment().items():
            args.extend(["--setenv", key, value])
        args.extend(["/bin/sh", "-lc", command])
        return args

    def run(self, command: str, *, timeout: int | None = None, cwd: str | Path = ".") -> SandboxResult:
        if not self.available:
            raise SandboxError("bwrap is not installed")
        return _execute(
            self.build(command, cwd),
            command=command,
            cwd=self.config.workspace,
            timeout=timeout or self.config.timeout,
            max_output=self.config.max_output,
        )


class MacSeatbeltSandbox(SandboxRunner):
    name = "seatbelt"
    strength = "native"

    @property
    def available(self) -> bool:
        return sys.platform == "darwin" and shutil.which("sandbox-exec") is not None

    def profile(self) -> str:
        workspace = str(self.config.workspace.resolve())
        tmp = str((self.config.workspace / ".tmp").resolve())
        network = "(allow network*)" if self.config.allow_network else "(deny network*)"
        return f"""
        (version 1)
        (deny default)
        (allow process-exec)
        (allow process-fork)
        (allow file-read*)
        (allow file-write* (subpath "{workspace}") (subpath "{tmp}") (subpath "/tmp"))
        {network}
        (allow sysctl-read)
        (allow mach-lookup)
        """

    def run(self, command: str, *, timeout: int | None = None, cwd: str | Path = ".") -> SandboxResult:
        if not self.available:
            raise SandboxError("sandbox-exec is not available")
        target = self._cwd(cwd)
        return _execute(
            ["sandbox-exec", "-p", self.profile(), "/bin/sh", "-lc", f"cd {target} && {command}"],
            command=command,
            cwd=self.config.workspace,
            timeout=timeout or self.config.timeout,
            max_output=self.config.max_output,
        )



def _assign_job(process: Any) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return
        # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", ctypes.c_uint32),
                ("SchedulingClass", ctypes.c_uint32),
            ]

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_uint64),
                ("WriteOperationCount", ctypes.c_uint64),
                ("OtherOperationCount", ctypes.c_uint64),
                ("ReadTransferCount", ctypes.c_uint64),
                ("WriteTransferCount", ctypes.c_uint64),
                ("OtherTransferCount", ctypes.c_uint64),
            ]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = 0x2000 | 0x8
        info.BasicLimitInformation.ActiveProcessLimit = 8
        kernel32.SetInformationJobObject(
            job,
            9,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        kernel32.AssignProcessToJobObject(job, wintypes.HANDLE(process._handle))  # type: ignore[attr-defined]
        process._job_handle = job  # type: ignore[attr-defined]
    except Exception:
        return


def _close_job(job: Any) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import wintypes

        ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(wintypes.HANDLE(job))
    except Exception:
        return


def _execute(
    args: list[str],
    *,
    command: str,
    cwd: Path,
    timeout: int,
    max_output: int,
) -> SandboxResult:
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            args,
            cwd=str(cwd),
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
        )
        timed_out = False
        code = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        code = 124
        raw_stdout = exc.stdout or ""
        raw_stderr = exc.stderr or f"Command timed out after {timeout}s"
        stdout = (
            raw_stdout.decode("utf-8", errors="replace")
            if isinstance(raw_stdout, bytes)
            else str(raw_stdout)
        )
        stderr = (
            raw_stderr.decode("utf-8", errors="replace")
            if isinstance(raw_stderr, bytes)
            else str(raw_stderr)
        )
    return _fit_output(
        command,
        code,
        stdout,
        stderr,
        int((time.perf_counter() - started) * 1000),
        timed_out,
        max_output,
    )


def _fit_output(
    command: str,
    code: int,
    stdout: str,
    stderr: str,
    duration_ms: int,
    timed_out: bool,
    max_output: int,
) -> SandboxResult:
    combined = False
    if len(stdout) > max_output:
        stdout = stdout[:max_output]
        combined = True
    if len(stderr) > max_output:
        stderr = stderr[:max_output]
        combined = True
    return SandboxResult(
        command=command,
        exit_code=code,
        stdout=stdout,
        stderr=stderr,
        duration_ms=duration_ms,
        timed_out=timed_out,
        truncated=combined,
    )


def build_sandbox(workspace: Path, *, allow_network: bool = True) -> SandboxRunner:
    config = SandboxConfig(workspace=workspace, allow_network=allow_network)
    system = platform.system().lower()
    backend: SandboxRunner
    if system == "linux":
        backend = LinuxBwrapSandbox(config)
    elif system == "darwin":
        backend = MacSeatbeltSandbox(config)
    elif system == "windows":
        backend = WindowsLowIntegritySandbox(config)
    else:
        backend = UnavailableSandbox(config)
    return backend
