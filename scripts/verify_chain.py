#!/usr/bin/env python3
"""Verify the audit log hash-chain (SPEC §9, M5).

Reads the chain in order and recomputes each entry hash; any break means the
log was tampered with. Exits non-zero on a broken chain.

Usage: DATABASE_URL=... python scripts/verify_chain.py [tenant_id]
"""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    # Allow running as a plain script (add the repo root to the import path).
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from core import db
    from core.audit import verify_chain
    from core.config import get_settings

    settings = get_settings()
    if not settings.database_url:
        print("verify_chain: DATABASE_URL is not configured", file=sys.stderr)
        return 2
    tenant_id = sys.argv[1] if len(sys.argv) > 1 else None
    with db.connection(settings.database_url) as conn:
        result = verify_chain(conn, tenant_id)
    if result.ok:
        print(f"verify_chain: OK ({result.count} entries)")
        return 0
    print(f"verify_chain: BROKEN at id={result.broken_id} ({result.count} entries)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
