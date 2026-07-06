#!/usr/bin/env python3
"""Deprecated unsafe one-off data deletion script.

This file is intentionally kept as a non-destructive guard so old deployment
notes or shell history cannot delete production data by accident.
"""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "delete_azana_operators.py is disabled. "
        "Use audited admin flows or a reviewed migration with dry-run, backup, "
        "explicit --apply, and peer approval.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
