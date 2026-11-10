"""ChainsawRecon v2 core package.

The legacy agent lives in :mod:`bounty_agent`. This package is the new
deterministic core: roles, context budgets, journal, and tool packs. It is
intentionally dependency-free so it can be tested and packaged before the
larger runtime lands.
"""

__version__ = "2.0.0-preview"
