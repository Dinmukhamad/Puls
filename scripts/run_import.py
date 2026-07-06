#!/usr/bin/env python3
"""Deprecated embedded Excel import script.

Do not commit real import payloads into the repository. Use
scripts/import_from_excel.py with an external file and dry-run first.
"""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "run_import.py is disabled. "
        "Run scripts/import_from_excel.py --file <xlsx> first without --apply, "
        "then repeat with --apply after reviewing the diff.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
