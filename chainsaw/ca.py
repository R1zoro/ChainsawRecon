"""Local certificate authority for HTTPS interception.

The CA and per-host leaf certificates live under the global Chainsaw home. Keys
are never written into project folders, journals, or reports.
"""

from __future__ import annotations

import ipaddress
import os
import re
import ssl
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CA_CERT_NAME = "ca.crt"
CA_KEY_NAME = "ca.key"
LEAF_DIR_NAME = "certs"
CA_COMMON_NAME = "ChainsawRecon Local CA"
CA_VALIDITY_DAYS = 3650
LEAF_VALIDITY_DAYS = 825

_INSTRUCTIONS = (
    "Install the ChainsawRecon proxy CA so HTTPS traffic can be captured.\n"
    "Windows: certutil -addstore -user Root <ca.crt>\n"
    "macOS: security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain-db <ca.crt>\n"
    "Linux: sudo cp <ca.crt> /usr/local/share/ca-certificates/chainsaw.crt && sudo update-ca-certificates\n"
    "Firefox: Settings -> Privacy & Security -> Certificates -> View Certificates -> Import.\n"
    "CLI: set NODE_EXTRA_CA_CERTS=<ca.crt> or REQUESTS_CA_BUNDLE=<ca.crt>."
)

_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _write_key(path: Path, key: rsa.RSAPrivateKey) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _write_cert(path: Path, cert: x509.Certificate) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    try:
        os.chmod(path, 0o644)
    except OSError:
        pass


def _safe_host(host: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", host)[:120] or "host"


@dataclass(frozen=True)
class CertificateAuthority:
    root: Path

    @property
    def cert_path(self) -> Path:
        return self.root / CA_CERT_NAME

    @property
    def key_path(self) -> Path:
        return self.root / CA_KEY_NAME

    @property
    def leaf_dir(self) -> Path:
        return self.root / LEAF_DIR_NAME

    def exists(self) -> bool:
        return self.cert_path.exists() and self.key_path.exists()

    def ensure(self) -> CertificateAuthority:
        with _lock:
            if self.exists():
                return self
            self.root.mkdir(parents=True, exist_ok=True)
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            subject = issuer = x509.Name(
                [
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ChainsawRecon"),
                    x509.NameAttribute(NameOID.COMMON_NAME, CA_COMMON_NAME),
                ]
            )
            now = _now()
            cert = (
                x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(issuer)
                .public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=1))
                .not_valid_after(now + timedelta(days=CA_VALIDITY_DAYS))
                .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                .add_extension(
                    x509.KeyUsage(
                        digital_signature=True,
                        content_commitment=False,
                        key_encipherment=False,
                        data_encipherment=False,
                        key_agreement=False,
                        key_cert_sign=True,
                        crl_sign=True,
                        encipher_only=False,
                        decipher_only=False,
                    ),
                    critical=True,
                )
                .add_extension(
                    x509.SubjectKeyIdentifier.from_public_key(key.public_key()),
                    critical=False,
                )
                .sign(key, hashes.SHA256())
            )
            _write_key(self.key_path, key)
            _write_cert(self.cert_path, cert)
            return self

    def _load_root(self) -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
        key = serialization.load_pem_private_key(self.key_path.read_bytes(), password=None)
        cert = x509.load_pem_x509_certificate(self.cert_path.read_bytes())
        if not isinstance(key, rsa.RSAPrivateKey):
            raise ValueError("CA private key is not RSA")
        return key, cert

    def leaf_context(self, host: str) -> ssl.SSLContext:
        """Return a server SSL context for ``host``, generating and caching a leaf."""

        host = host.strip().lower().strip("[]")
        if not host:
            raise ValueError("host is required")
        self.ensure()
        self.leaf_dir.mkdir(parents=True, exist_ok=True)
        safe = _safe_host(host)
        cert_path = self.leaf_dir / f"{safe}.crt.pem"
        key_path = self.leaf_dir / f"{safe}.key.pem"
        if not cert_path.exists() or not key_path.exists():
            self._create_leaf(host, cert_path, key_path)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(str(cert_path), str(key_path))
        return context

    def _create_leaf(self, host: str, cert_path: Path, key_path: Path) -> None:
        with _lock:
            if cert_path.exists() and key_path.exists():
                return
            ca_key, ca_cert = self._load_root()
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            subject = x509.Name(
                [
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ChainsawRecon"),
                    x509.NameAttribute(NameOID.COMMON_NAME, host[:64]),
                ]
            )
            try:
                san: x509.ExtensionType = x509.SubjectAlternativeName(
                    [x509.IPAddress(ipaddress.ip_address(host))]
                )
            except ValueError:
                san = x509.SubjectAlternativeName([x509.DNSName(host)])
            now = _now()
            cert = (
                x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(ca_cert.subject)
                .public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=1))
                .not_valid_after(now + timedelta(days=LEAF_VALIDITY_DAYS))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(
                    x509.KeyUsage(
                        digital_signature=True,
                        content_commitment=False,
                        key_encipherment=True,
                        data_encipherment=False,
                        key_agreement=False,
                        key_cert_sign=False,
                        crl_sign=False,
                        encipher_only=False,
                        decipher_only=False,
                    ),
                    critical=True,
                )
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .add_extension(san, critical=False)
                .add_extension(
                    x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
                    critical=False,
                )
                .sign(ca_key, hashes.SHA256())
            )
            _write_key(key_path, key)
            _write_cert(cert_path, cert)


def ca_status(home_root: Path) -> dict[str, object]:
    ca = CertificateAuthority(home_root / "ca")
    available = ca.exists()
    return {
        "available": available,
        "path": str(ca.cert_path) if available else None,
        "keyPath": str(ca.key_path) if available else None,
        "installed": False,
        "instructions": _INSTRUCTIONS,
    }


def ensure_ca(home_root: Path) -> CertificateAuthority:
    return CertificateAuthority(home_root / "ca").ensure()
