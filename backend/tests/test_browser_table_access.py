"""The browser's Supabase key may read only the tables its Realtime
subscriptions need (migration 270). A new subscription on another table
silently receives nothing until it is granted, so this test names it."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "backend" / "supabase" / "migrations"
CLIENT_DIRS = [ROOT / "artifacts" / "frontend" / "src", ROOT / "artifacts" / "mobile"]


def _subscribed_tables() -> set[str]:
    tables: set[str] = set()
    for base in CLIENT_DIRS:
        for path in base.rglob("*.ts*"):
            if "node_modules" in path.parts or ".test." in path.name:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if "postgres_changes" not in text:
                continue
            tables.update(re.findall(r"""table:\s*["'`]([a-z_]+)["'`]""", text))
    return tables


def _granted_tables() -> set[str]:
    granted: set[str] = set()
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name < "270_":
            continue
        sql = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))
        for block in re.findall(r"GRANT\s+SELECT\s+ON\s+(.*?)\s+TO\s+authenticated", sql, re.S | re.I):
            granted.update(re.findall(r"public\.([a-z_]+)", block))
    return granted


def test_every_realtime_table_is_granted():
    subscribed = _subscribed_tables()
    assert subscribed, "found no Realtime subscriptions; the scan is broken"
    missing = subscribed - _granted_tables()
    assert not missing, (
        f"Realtime subscribes to {sorted(missing)} but authenticated has no SELECT on it. "
        "Add a migration with GRANT SELECT ... TO authenticated and an RLS policy."
    )


def test_client_code_never_reads_tables_directly():
    # Everything else goes through the API. A direct .from("table") would
    # now fail with permission denied, so catch it here instead.
    pattern = re.compile(r"""\.from\(\s*["'`][a-z_]+["'`]\s*\)""")
    offenders = []
    for base in CLIENT_DIRS:
        for path in base.rglob("*.ts*"):
            if "node_modules" in path.parts or ".test." in path.name:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if "supabase" in text.lower() and pattern.search(text):
                offenders.append(str(path.relative_to(ROOT)))
    assert not offenders, offenders


def test_migration_270_revokes_before_granting():
    sql = (MIGRATIONS / "270_lock_down_browser_table_access.sql").read_text(encoding="utf-8")
    assert sql.index("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated") < sql.index("GRANT SELECT ON")
    for policy in ("anon_read_alerts", "allow_authenticated_read_participants", "authenticated_can_view_invitations"):
        assert f"DROP POLICY IF EXISTS {policy}" in sql
