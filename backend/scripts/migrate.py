"""Apply pending Supabase SQL migrations automatically.

Tracks applied files (by filename) in public.schema_migrations and runs any
file in backend/supabase/migrations that isn't recorded yet, in name order,
each in its own transaction. Runs on every Fly deploy via release_command, so
nobody has to paste migrations into the SQL editor by hand.

Usage:
  python -m backend.scripts.migrate              # apply pending migrations
  python -m backend.scripts.migrate --status     # list pending, change nothing
  python -m backend.scripts.migrate --baseline   # mark ALL current files as
                                                 # applied without running them
                                                 # (one-time, for a DB that was
                                                 # migrated by hand already)

Needs DATABASE_URL = the Supabase Postgres connection string
(Project Settings -> Database -> Connection string, "Session pooler").
If DATABASE_URL is unset it exits 0 so deploys aren't blocked.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "supabase" / "migrations"

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
)
"""


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("[migrate] DATABASE_URL not set - skipping migrations.")
        return 0

    import psycopg

    args = set(sys.argv[1:])
    files = sorted(p for p in MIGRATIONS_DIR.glob("*.sql"))

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(CREATE_TABLE)
        applied = {r[0] for r in conn.execute("SELECT filename FROM public.schema_migrations")}
        pending = [p for p in files if p.name not in applied]

        if "--status" in args:
            print(f"[migrate] {len(pending)} pending:")
            for p in pending:
                print("  ", p.name)
            return 0

        if "--baseline" in args:
            with conn.transaction():
                for p in pending:
                    conn.execute(
                        "INSERT INTO public.schema_migrations (filename) VALUES (%s) ON CONFLICT DO NOTHING",
                        (p.name,),
                    )
            print(f"[migrate] Baselined {len(pending)} file(s) as already applied.")
            return 0

        if not pending:
            print("[migrate] Database is up to date.")
            return 0

        for p in pending:
            print(f"[migrate] Applying {p.name} ...")
            try:
                with conn.transaction():
                    conn.execute(p.read_text(encoding="utf-8"))
                    conn.execute(
                        "INSERT INTO public.schema_migrations (filename) VALUES (%s)",
                        (p.name,),
                    )
            except Exception as exc:  # stop at first failure; later files may depend on it
                print(f"[migrate] FAILED on {p.name}: {exc}")
                return 1
        print(f"[migrate] Applied {len(pending)} migration(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
