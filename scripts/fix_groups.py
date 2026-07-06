#!/usr/bin/env python3
"""Deprecated unsafe one-off group mutation script.

The previous version ran direct UPDATE/DELETE statements against DATABASE_URL.
It is disabled to prevent accidental production data changes.
"""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "fix_groups.py is disabled. "
        "Use a reviewed Alembic migration or admin tool with dry-run and "
        "explicit --apply semantics.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
