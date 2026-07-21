"""Canonical surface normalization and deduplication.

Transforms raw URLs into stable, deduplicated surfaces by stripping
tracking parameters, Cloudflare challenge tokens, and normalizing
protocol variants. Prevents queue pollution from:
- CF challenge token variants (__cf_chl_tk, __cf_chl_rt_tk, __cf_chl_f_tk, __cf_bm)
- Protocol duplication (http:// vs https://)
- Trailing slash variants
- Tracking/analytics parameters
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse


# Cloudflare challenge and tracking parameters to strip
_CF_PARAMS: Set[str] = {
    "__cf_chl_tk",
    "__cf_chl_rt_tk",
    "__cf_chl_f_tk",
    "__cf_bm",
    "__cf_chl_rs_tk",
}

# Common tracking/analytics parameters to strip
_TRACKING_PARAMS: Set[str] = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "gclsrc",
    "dclid",
    "msclkid",
    "twclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "oly_anon_id",
    "oly_enc_id",
    "_openstat",
    "vero_id",
    "wickedid",
    "yclid",
    "ref",
    "source",
    "si",
}

# Hostname suffixes that indicate documentation/SDK surfaces
_DOCS_SUFFIXES: Tuple[str, ...] = (
    "docs.",
    "developer.",
    "apidocs.",
    "api-docs.",
    "swagger.",
    "openapi.",
    "sdk.",
    "help.",
    "support.",
)

# Patterns for common passive discovery paths
_PASSIVE_PATH_PATTERNS: List[re.Pattern] = [
    re.compile(r"/robots\.txt", re.I),
    re.compile(r"/sitemap\.xml", re.I),
    re.compile(r"/security\.txt", re.I),
    re.compile(r"/\.well-known/", re.I),
    re.compile(r"/openapi\.(json|yaml|yml)", re.I),
    re.compile(r"/swagger\.(json|yaml|yml)", re.I),
    re.compile(r"/api-docs?", re.I),
    re.compile(r"/graphql", re.I),
]


@dataclass(frozen=True)
class CanonicalSurface:
    """A deduplicated, normalized surface representation."""
    scheme: str  # Always "https" after normalization
    host: str
    path: str
    query: str  # Canonical sorted query string
    original_urls: Tuple[str, ...] = field(default_factory=tuple)
    is_passive: bool = False  # True for robots.txt, sitemap.xml, etc.
    is_docs: bool = False     # True for docs.*, developer.* subdomains
    is_api: bool = False      # True for api.* subdomains or /api/ paths
    is_graphql: bool = False  # True for /graphql endpoints

    @property
    def canonical_url(self) -> str:
        qs = f"?{self.query}" if self.query else ""
        return f"{self.scheme}://{self.host}{self.path}{qs}"

    @property
    def surface_key(self) -> str:
        """Unique key for deduplication (path-focused, ignores query)."""
        return f"{self.host}{self.path}"

    @property
    def surface_id(self) -> str:
        """Stable hash-based identifier."""
        import hashlib
        digest = hashlib.sha1(self.surface_key.encode("utf-8", errors="replace")).hexdigest()
        return f"S-{int(digest[:8], 16) % 1_000_000:06d}"


def strip_challenge_tokens(url: str) -> str:
    """Remove Cloudflare challenge tokens and tracking params from a URL.

    Strips query parameters like __cf_chl_tk, __cf_bm, utm_*, etc.
    Returns the clean URL.
    """
    if "?" not in url:
        return url

    parsed = urlparse(url)
    if not parsed.query:
        return url

    params = parse_qs(parsed.query, keep_blank_values=True)
    stripped: Dict[str, List[str]] = {}
    changed = False

    for key, values in params.items():
        key_lower = key.lower()
        if key_lower in _CF_PARAMS or key in _CF_PARAMS:
            changed = True
            continue
        if key_lower in _TRACKING_PARAMS or key in _TRACKING_PARAMS:
            changed = True
            continue
        stripped[key] = values

    if not changed:
        return url

    if not stripped:
        # All params were stripped
        return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, "", parsed.fragment))

    # Rebuild with sorted keys for consistency
    new_query = urlencode(sorted(stripped.items()), doseq=True)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))


def normalize_protocol(url: str) -> str:
    """Normalize protocol to HTTPS.

    Converts http:// to https:// for canonical form.
    """
    if url.startswith("http://"):
        return "https://" + url[7:]
    return url


def normalize_www(url: str) -> str:
    """Normalize www subdomain.

    Some programs treat 'example.com' and 'www.example.com' as the same site.
    This converts 'example.com' to 'www.example.com' for canonical consistency.
    Does NOT convert bare hostnames without dots (e.g., 'localhost').
    """
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host.count(".") == 1 and not host.startswith("www."):
        # e.g., "takeaway.com" -> "www.takeaway.com"
        new_host = "www." + host
        return urlunparse((parsed.scheme, new_host, parsed.path, parsed.params, parsed.query, parsed.fragment))
    return url


def normalize_path(url: str) -> str:
    """Normalize path by stripping trailing slash and fixing malformed patterns.

    - Strips trailing slash (except for root /)
    - Fixes malformed URL patterns like trailing colons
    - Removes duplicate slashes
    """
    parsed = urlparse(url)
    path = parsed.path

    # Fix malformed patterns like "restaurant/1:" or "restaurant/:"
    path = re.sub(r":$", "", path)

    # Remove duplicate slashes
    path = re.sub(r"/{2,}", "/", path)

    # Strip trailing slash (keep root /)
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    return urlunparse((parsed.scheme, parsed.netloc, path, parsed.params, parsed.query, parsed.fragment))


def normalize_url(url: str) -> str:
    """Full normalization pipeline for a single URL.

    1. Strip CF challenge tokens
    2. Strip tracking parameters
    3. Normalize to HTTPS
    4. Normalize path
    """
    url = strip_challenge_tokens(url)
    url = normalize_protocol(url)
    url = normalize_www(url)
    url = normalize_path(url)
    return url


def classify_surface_type(host: str, path: str) -> Tuple[bool, bool, bool, bool]:
    """Classify a surface by its characteristics.

    Returns (is_docs, is_api, is_graphql, is_passive).
    """
    is_docs = any(host.lower().startswith(suffix) for suffix in _DOCS_SUFFIXES)
    is_api = "api." in host.lower() or "/api/" in path.lower() or path.lower().startswith("/api")
    is_graphql = "/graphql" in path.lower()
    is_passive = any(pattern.search(path) for pattern in _PASSIVE_PATH_PATTERNS)

    return is_docs, is_api, is_graphql, is_passive


def build_canonical_surface(url: str, original_url: Optional[str] = None) -> CanonicalSurface:
    """Build a CanonicalSurface from a raw URL.

    Args:
        url: The raw URL to normalize.
        original_url: Optional original URL before normalization (for tracking).

    Returns:
        A CanonicalSurface with deduplication-ready fields.
    """
    normalized = normalize_url(url)
    parsed = urlparse(normalized)

    scheme = parsed.scheme or "https"
    host = (parsed.hostname or "").lower()
    path = parsed.path or "/"

    # Sort query string for consistent ordering
    if parsed.query:
        params = parse_qs(parsed.query, keep_blank_values=True)
        query = urlencode(sorted(params.items()), doseq=True)
    else:
        query = ""

    is_docs, is_api, is_graphql, is_passive = classify_surface_type(host, path)

    originals = tuple(
        sorted(set(
            u for u in [original_url, url] if u and u != normalized
        ))
    )

    return CanonicalSurface(
        scheme=scheme,
        host=host,
        path=path,
        query=query,
        original_urls=originals,
        is_passive=is_passive,
        is_docs=is_docs,
        is_api=is_api,
        is_graphql=is_graphql,
    )


class CanonicalSurfaceManager:
    """Manages canonical surface deduplication and merging.

    Maintains a registry of known surfaces by their surface_key and
    merges duplicate URL variants into a single canonical record.
    """

    def __init__(self) -> None:
        self._surfaces: Dict[str, CanonicalSurface] = {}
        self._url_to_key: Dict[str, str] = {}

    def register(self, url: str) -> CanonicalSurface:
        """Register a URL and get its canonical surface.

        If the URL normalizes to an already-known surface key,
        the existing canonical record is returned with the new
        URL added to original_urls.

        Args:
            url: Raw URL to register.

        Returns:
            The canonical surface (existing or newly created).
        """
        normalized = normalize_url(url)
        surface = build_canonical_surface(normalized, original_url=url)
        key = surface.surface_key

        self._url_to_key[url] = key
        self._url_to_key[normalized] = key

        if key in self._surfaces:
            existing = self._surfaces[key]
            # Merge original URLs if this is a new variant
            known_originals = set(existing.original_urls)
            new_originals = tuple(
                sorted(set(
                    u for u in [*existing.original_urls, url, normalized]
                    if u != existing.canonical_url
                ))
            )
            if len(new_originals) > len(existing.original_urls):
                self._surfaces[key] = CanonicalSurface(
                    scheme=existing.scheme,
                    host=existing.host,
                    path=existing.path,
                    query=existing.query,
                    original_urls=new_originals,
                    is_passive=existing.is_passive,
                    is_docs=existing.is_docs,
                    is_api=existing.is_api,
                    is_graphql=existing.is_graphql,
                )
            return self._surfaces[key]

        self._surfaces[key] = surface
        return surface

    def get_surface(self, url_or_key: str) -> Optional[CanonicalSurface]:
        """Look up a canonical surface by URL or surface key."""
        normalized = normalize_url(url_or_key)
        key = self._url_to_key.get(url_or_key) or self._url_to_key.get(normalized)
        if key and key in self._surfaces:
            return self._surfaces[key]

        # Try as a surface_key directly
        if url_or_key in self._surfaces:
            return self._surfaces[url_or_key]

        return None

    def is_known(self, url: str) -> bool:
        """Check if a URL's canonical form is already registered."""
        normalized = normalize_url(url)
        key = self._url_to_key.get(normalized)
        return key is not None and key in self._surfaces

    def deduplicate(self, urls: List[str]) -> List[str]:
        """Deduplicate a list of URLs to their canonical forms.

        Returns a list of canonical URLs (one per unique surface).
        """
        seen: Set[str] = set()
        result: List[str] = []
        for url in urls:
            surface = self.register(url)
            if surface.surface_key not in seen:
                seen.add(surface.surface_key)
                result.append(surface.canonical_url)
        return result

    def all_surfaces(self) -> List[CanonicalSurface]:
        """Return all registered canonical surfaces."""
        return list(self._surfaces.values())

    def surface_count(self) -> int:
        """Number of unique canonical surfaces."""
        return len(self._surfaces)

    def merge_count(self) -> int:
        """Total number of original URLs merged into canonical surfaces."""
        return len(self._url_to_key)

    def stats(self) -> Dict[str, int]:
        """Return merge statistics."""
        return {
            "canonical_surfaces": self.surface_count(),
            "original_urls": self.merge_count(),
            "compression_ratio": max(1, self.merge_count()) / max(1, self.surface_count()),
        }