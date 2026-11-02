"""Build the production database's schema from the dev database.

The migrations folder can't rebuild today's schema from scratch (duplicate
numbers, the original `patients` table, tables first made by hand), so a
new database copies the dev database's *structure* instead, plus the shared
reference data every organisation needs. No organisation, user or
participant data is copied.

Runs the official Postgres tools in Docker (postgres:17), so nothing needs
installing. Connection strings come from git-ignored files and are passed to
the container as environment variables, never on a command line:

  .env              DEV_DATABASE_URL   dev Supabase, Session pooler URL
  .env.production   DATABASE_URL       new production Supabase, Session pooler URL

    .venv/Scripts/python -m backend.scripts.bootstrap_production_db           # checks only
    .venv/Scripts/python -m backend.scripts.bootstrap_production_db --apply

Apply the dev catch-up SQL first, so the copied schema is complete.

Steps: extensions -> schema (one transaction) -> storage buckets ->
reference data -> mark every current migration applied (so deploys only run
new ones) -> compare table counts.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
IMAGE = "postgres:17"

# Shared, organisation-independent data, in foreign-key order.
REFERENCE_TABLES = [
    "platform_ndis_price_schedules",
    "platform_ndis_price_items",
    "public_holidays",
    "award_streams",
    "award_classifications",
    "award_allowances",
    "compliance_rules",
    "support_items",
    "support_faq_articles",
    "achievement_definitions",
    "app_support_config",
    "privacy_policy_versions",
    "news_sources",
]


def _urls() -> tuple[str, str]:
    dev = dotenv_values(ROOT / ".env").get("DEV_DATABASE_URL") or os.environ.get("DEV_DATABASE_URL", "")
    prod = dotenv_values(ROOT / ".env.production").get("DATABASE_URL") or ""
    if not dev or not prod:
        sys.exit("Set DEV_DATABASE_URL in .env and DATABASE_URL in .env.production (Session pooler URLs).")
    if dev == prod:
        sys.exit("DEV_DATABASE_URL and the production DATABASE_URL are the same database. Stopping.")
    return dev, prod


def _run(url: str, command: str, stdin: str | None = None) -> str:
    """Run a shell command in the postgres image with $DBURL set."""
    result = subprocess.run(
        ["docker", "run", "--rm", "-i", "-e", "DBURL", IMAGE, "sh", "-c", command],
        input=stdin, capture_output=True, text=True, encoding="utf-8",
        env={**os.environ, "DBURL": url},
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[-2000:])
    return result.stdout


def _sql(url: str, query: str) -> list[list[str]]:
    out = _run(url, 'psql "$DBURL" -X -A -t -F "|" -v ON_ERROR_STOP=1 -f -', stdin=query)
    return [line.split("|") for line in out.splitlines() if line.strip()]


def _count_tables(url: str) -> int:
    return int(_sql(url, "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")[0][0])


def main() -> None:
    apply = "--apply" in sys.argv
    dev, prod = _urls()

    print("Checking both databases...")
    dev_tables = _count_tables(dev)
    prod_tables = _count_tables(prod)
    print(f"  dev:  {dev_tables} tables")
    print(f"  prod: {prod_tables} tables")
    if prod_tables and _sql(prod, "select to_regclass('public.organizations') is not null;")[0][0] == "t":
        orgs = int(_sql(prod, "select count(*) from public.organizations;")[0][0])
        if orgs:
            sys.exit(f"Production already has {orgs} organisation(s). This script only builds an empty database.")
    if prod_tables and "--force-into-nonempty" not in sys.argv:
        sys.exit("Production already has tables. Use a fresh project (or --force-into-nonempty if you're sure).")

    extensions = _sql(dev, "select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace "
                           "where e.extname not in ('plpgsql') order by 1;")
    print(f"  extensions on dev: {', '.join(f'{name} ({schema})' for name, schema in extensions)}")
    if not apply:
        print("Checks passed. Re-run with --apply to build production.")
        return

    print("1/6 Extensions")
    for name, schema in extensions:
        try:
            _sql(prod, f'create extension if not exists "{name}" with schema "{schema}";')
        except RuntimeError as exc:
            print(f"     skipped {name}: {str(exc).splitlines()[-1]}")

    # Custom NOLOGIN roles the app created on dev (e.g. quill_agent, migration 197).
    # Roles live outside the schema dump, so recreate them before policies/grants reference them.
    custom_roles = _sql(dev, "select r.rolname, r.rolinherit, "
                             "exists(select 1 from pg_auth_members m join pg_roles a on a.oid = m.member "
                             "where m.roleid = r.oid and a.rolname = 'authenticator') "
                             "from pg_roles r where not r.rolcanlogin and r.rolname !~ '^(pg_|supabase|anon$|authenticated$|service_role$|dashboard_user$|pgsodium|pgbouncer|authenticator$)' "
                             "order by 1;")
    prod_roles = {row[0] for row in _sql(prod, "select rolname from pg_roles;")}
    for role, inherit, to_authenticator in custom_roles:
        if role not in prod_roles:
            _sql(prod, f'create role "{role}" nologin {"inherit" if inherit == "t" else "noinherit"};')
            print(f"     created role {role}")
        if to_authenticator == "t":
            _sql(prod, f'grant "{role}" to authenticator;')

    print("2/6 Schema (structure only, one transaction)")
    # Keep privileges so GRANTs to anon/authenticated/service_role/custom roles match dev.
    schema_sql = _run(dev, 'pg_dump "$DBURL" --schema-only --schema=public --no-owner')
    # Every Supabase project already has the public schema; drop the dump's CREATE for it.
    schema_sql = re.sub(r'(?im)^\s*CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"?public"?\s*;', "CREATE SCHEMA IF NOT EXISTS public;", schema_sql)
    # New Supabase projects ship some functions in public (e.g. rls_auto_enable); replace instead of failing.
    schema_sql = re.sub(r"(?m)^CREATE FUNCTION ", "CREATE OR REPLACE FUNCTION ", schema_sql)
    schema_sql = re.sub(r"(?m)^CREATE PROCEDURE ", "CREATE OR REPLACE PROCEDURE ", schema_sql)
    # Supabase manages supabase_admin's default privileges itself (already set on every new project);
    # the pooler's postgres user isn't allowed to change them.
    schema_sql = re.sub(r"(?m)^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin .*$", "", schema_sql)
    _run(prod, 'psql "$DBURL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f -', stdin=schema_sql)

    print("3/6 Storage buckets")
    buckets = _sql(dev, "select id, name, public, coalesce(file_size_limit::text, ''), "
                        "coalesce(array_to_string(allowed_mime_types, ','), '') from storage.buckets order by id;")
    for bucket_id, name, public, size, mimes in buckets:
        mime_sql = "null" if not mimes else "array[" + ",".join(f"'{m}'" for m in mimes.split(",")) + "]"
        _sql(prod, "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values "
                   f"('{bucket_id}', '{name}', {public == 't'}, {size or 'null'}, {mime_sql}) on conflict (id) do nothing;")
    print(f"     {len(buckets)} buckets")

    print("4/6 Reference data")
    for table in REFERENCE_TABLES:
        data = _run(dev, f'pg_dump "$DBURL" --data-only --no-owner --table=public.{table}')
        _run(prod, 'psql "$DBURL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f -', stdin=data)
        print(f"     {table}: {_sql(prod, f'select count(*) from public.{table};')[0][0]} rows")

    print("5/6 Mark current migrations as applied")
    subprocess.run(
        [sys.executable, "-m", "backend.scripts.migrate", "--baseline"],
        cwd=ROOT, check=True, env={**os.environ, "DATABASE_URL": prod},
    )

    print("6/6 Check")
    built = _count_tables(prod)
    print(f"     prod now has {built} tables (dev has {dev_tables})")
    if built < dev_tables:
        sys.exit("Fewer tables than dev: check the output above before going live.")
    print("Production database is ready.")


if __name__ == "__main__":
    main()
