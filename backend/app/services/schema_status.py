"""Has this database got every migration this build ships, and can the API
actually use what the newest ones added?

Two questions, answered separately because either can go wrong on its own:

1. Applied: the migration files in this build compared with
   public.schema_migrations (what backend/scripts/migrate.py records when the
   deploy's release_command runs them). Needs DATABASE_URL; without it the
   answer is "not checked".
2. Visible: the tables and columns the newest migrations create, read
   through the Supabase API (PostgREST). A migration can be applied while
   the API's schema cache still doesn't know the new column, and then every
   request using it fails.

Kept for a minute so the health endpoint is cheap.
"""

from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
# How many of the newest migrations to check through the API.
NEWEST = 3
_CACHE_SECONDS = 60
_cache: dict[str, Any] = {"at": 0.0, "value": None}

_ALTER = re.compile(r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?\"?(\w+)\"?(.*?);", re.I | re.S)
_ADD_COLUMN = re.compile(r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?(\w+)\"?", re.I)
_CREATE_TABLE = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?\"?(\w+)\"?", re.I)


def migration_files() -> list[str]:
    return sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))


def number(filename: Optional[str]) -> Optional[str]:
    match = re.match(r"(\d+)", filename or "")
    return match.group(1) if match else None


def objects_in(sql: str) -> list[tuple[str, Optional[str]]]:
    """(table, column) for each column a migration adds, and (table, None)
    for each table it creates, in order, without repeats."""
    found: list[tuple[str, Optional[str]]] = []
    for table in _CREATE_TABLE.findall(sql):
        found.append((table, None))
    for table, body in _ALTER.findall(sql):
        for column in _ADD_COLUMN.findall(body):
            found.append((table, column))
    return list(dict.fromkeys(found))


def _applied() -> Optional[set[str]]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg

        with psycopg.connect(url, connect_timeout=5) as conn:
            return {r[0] for r in conn.execute("SELECT filename FROM public.schema_migrations")}
    except Exception as exc:
        logger.warning("schema status: schema_migrations not read: %s", exc)
        return None


def _visible(table: str, column: Optional[str]) -> bool:
    try:
        from .supabase_client import get_supabase_admin

        get_supabase_admin().table(table).select(column or "*").limit(1).execute()
        return True
    except Exception as exc:
        logger.warning("schema status: %s.%s not readable through the API: %s", table, column or "*", exc)
        return False


def check(fresh: bool = False) -> dict[str, Any]:
    if not fresh and _cache["value"] is not None and time.monotonic() - _cache["at"] < _CACHE_SECONDS:
        return _cache["value"]
    files = migration_files()
    applied = _applied()
    pending = [f for f in files if applied is not None and f not in applied]
    newest = files[-NEWEST:]
    visible: dict[str, bool] = {}
    for name in newest:
        try:
            sql = (MIGRATIONS_DIR / name).read_text(encoding="utf-8")
        except OSError:
            continue
        for table, column in objects_in(sql):
            visible[f"{table}.{column}" if column else table] = _visible(table, column)
    value = {
        "latest_shipped": number(files[-1]) if files else None,
        "migrations_checked": applied is not None,
        "pending": pending,
        "newest_checked": [number(n) for n in newest],
        "visible": visible,
        "api_sees_newest": all(visible.values()) if visible else None,
        "up_to_date": (not pending and all(visible.values())) if applied is not None else None,
    }
    _cache.update(at=time.monotonic(), value=value)
    return value


def summary() -> dict[str, Any]:
    """The public part: no table names, just whether it's all there."""
    s = check()
    return {
        "latest_migration": s["latest_shipped"],
        "migrations_checked": s["migrations_checked"],
        "pending": len(s["pending"]),
        "api_sees_newest_migrations": s["api_sees_newest"],
        "up_to_date": s["up_to_date"],
    }
