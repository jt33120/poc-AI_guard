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
    from core import checkpoints, db
    from core.audit import verify_chain
    from core.config import get_settings

    settings = get_settings()
    if not settings.database_url:
        print("verify_chain: DATABASE_URL is not configured", file=sys.stderr)
        return 2
    tenant_id = sys.argv[1] if len(sys.argv) > 1 else None
    with db.connection(settings.database_url) as conn:
        result = verify_chain(conn, tenant_id)
        # Les témoins ne remplacent PAS la relecture ci-dessus et ne la raccourcissent
        # pas : ils répondent à une autre question, celle que la relecture ne peut pas
        # poser. Recalculer la chaîne dit qu'aucune ligne n'a été modifiée ; le témoin
        # dit qu'aucune n'a été retirée. Sur une table vide, la première rend
        # `ok=True, count=0` et le second est le seul à protester.
        temoin = checkpoints.verify(conn, tenant_id) if tenant_id else None
    if not result.ok:
        print(f"verify_chain: BROKEN at id={result.broken_id} ({result.count} entries)")
        return 1
    if temoin is not None and not temoin.ok:
        print(f"verify_chain: WITNESS DISAGREES — {temoin.detail}")
        return 1
    atteste = f", {temoin.checkpoints} checkpoint(s) agree" if temoin and temoin.attested else ""
    print(f"verify_chain: OK ({result.count} entries{atteste})")
    if tenant_id and (temoin is None or not temoin.attested):
        print("verify_chain: no signed checkpoint — nothing outside this database has")
        print("              ever witnessed this chain, so a tail deletion is invisible.")
        print("              fix: set CHECKPOINT_SIGNING_KEY and run `python -m cli")
        print("                   checkpoint take` on a schedule.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
