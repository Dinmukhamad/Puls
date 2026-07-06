#!/usr/bin/env python3
"""Deprecated embedded Excel tenure repair script.

The previous version contained a base64-encoded workbook. Import data should
stay outside the repository and be processed through reviewed tools.
"""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "fix_tenure_levels.py is disabled. "
        "Use scripts/import_from_excel.py or a reviewed migration with an "
        "external input file and dry-run output.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
