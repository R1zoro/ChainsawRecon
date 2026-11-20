"""Local encryption for sensitive workbench headers.

The session/evidence journal is already separate from raw traffic. This box
protects the secrets that must remain available for replay, while public reads
stay redacted.
"""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet

SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "proxy-authorization",
    "api-key",
    "access-token",
}
PREFIX = "enc:v1:"


class SecretBox:
    def __init__(
        self,
        home_root: Path,
        *,
        use_keyring: bool | None = None,
    ) -> None:
        self.root = home_root / "secrets"
        self.root.mkdir(parents=True, exist_ok=True)
        self.key_path = self.root / "workbench.key"
        self.key_source = "file"
        key: bytes | None = None
        if use_keyring is None:
            use_keyring = os.environ.get("CHAINSAW_DISABLE_KEYRING", "") not in {
                "1",
                "true",
                "yes",
            }
        if use_keyring:
            try:
                import keyring  # type: ignore[import-not-found]

                stored = keyring.get_password("chainsawrecon", "workbench-key")
                if not stored:
                    stored = Fernet.generate_key().decode("ascii")
                    keyring.set_password("chainsawrecon", "workbench-key", stored)
                key = stored.encode("ascii")
                self.key_source = "keyring"
            except Exception:
                key = None
        if key is None:
            if not self.key_path.exists():
                self.key_path.write_bytes(Fernet.generate_key())
                try:
                    os.chmod(self.key_path, 0o600)
                except OSError:
                    pass
            key = self.key_path.read_bytes()
        self._fernet = Fernet(key)

    def seal(self, value: str) -> str:
        if not value or value.startswith(PREFIX):
            return value
        token = self._fernet.encrypt(value.encode("utf-8")).decode("ascii")
        return PREFIX + token

    def unseal(self, value: str) -> str:
        if not value.startswith(PREFIX):
            return value
        try:
            return self._fernet.decrypt(value[len(PREFIX) :].encode("ascii")).decode("utf-8")
        except Exception:
            return "«unavailable»"

    def seal_headers(self, headers: dict[str, str]) -> dict[str, str]:
        return {
            key: self.seal(str(value)) if key.lower() in SENSITIVE_HEADERS else str(value)
            for key, value in headers.items()
        }

    def unseal_headers(self, headers: dict[str, str]) -> dict[str, str]:
        return {
            key: self.unseal(str(value)) if key.lower() in SENSITIVE_HEADERS else str(value)
            for key, value in headers.items()
        }
