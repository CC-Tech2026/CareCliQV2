"""
Shared fixtures for the real-Postgres RLS integration suite.

Gated behind INTEGRATION_REAL_DB=1 — the rest of the backend test suite mocks
the Supabase client entirely and never executes real SQL against a real
database. That's exactly why the bugs this suite targets (RLS "enabled" via
FORCE without ever running ENABLE, and ~30 tenant-scoped tables that never had
RLS enabled at all — see the tenant isolation audit, 2026-08-21) were invisible
to it: a mocked test can only verify the Python code *intends* to filter by
org, never that Postgres actually enforces it.

Requires Docker running locally. See README.md in this directory for how to run.
"""
from __future__ import annotations

import os
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pytest

_SKIP_REASON = "Set INTEGRATION_REAL_DB=1 (and have Docker running) to run the real-Postgres RLS suite."


def pytest_collection_modifyitems(config, items):
    # A bare `pytestmark` assignment in conftest.py is NOT auto-applied to
    # sibling test modules the way it is inside a test module itself — this
    # hook is the actual mechanism pytest provides for a conftest to mark
    # every item it collects. Without it, these tests would silently run
    # (spinning up real Docker containers) on every default `pytest
    # backend/tests/` invocation instead of skipping.
    if os.environ.get("INTEGRATION_REAL_DB") == "1":
        return
    skip = pytest.mark.skip(reason=_SKIP_REASON)
    for item in items:
        if "backend/tests/integration/" in str(item.fspath).replace("\\", "/"):
            item.add_marker(skip)


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
CONTAINER_NAME = "ccq_rls_integration_test"
PG_PORT = int(os.environ.get("CCQ_TEST_PG_PORT", "55433"))
PG_PASSWORD = "postgres"


def _docker_available() -> bool:
    try:
        subprocess.run(["docker", "info"], capture_output=True, check=True, timeout=10)
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def pg_dsn() -> Iterator[str]:
    if os.environ.get("INTEGRATION_REAL_DB") != "1":
        pytest.skip(_SKIP_REASON)
    if not _docker_available():
        pytest.skip("Docker is not available/running — required for the real-Postgres RLS suite.")

    subprocess.run(["docker", "rm", "-f", CONTAINER_NAME], capture_output=True)
    subprocess.run(
        [
            "docker", "run", "-d", "--rm", "--name", CONTAINER_NAME,
            "-e", f"POSTGRES_PASSWORD={PG_PASSWORD}",
            "-p", f"{PG_PORT}:5432",
            "postgres:16",
        ],
        check=True, capture_output=True,
    )
    try:
        for _ in range(30):
            ready = subprocess.run(
                ["docker", "exec", CONTAINER_NAME, "pg_isready", "-U", "postgres"],
                capture_output=True,
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            pytest.fail("Postgres container did not become ready within 30s")

        yield f"host=localhost port={PG_PORT} dbname=postgres user=postgres password={PG_PASSWORD}"
    finally:
        subprocess.run(["docker", "stop", CONTAINER_NAME], capture_output=True)


def _read_migration(name: str) -> str:
    return (MIGRATIONS_DIR / name).read_text(encoding="utf-8")


def _setup_schema(conn) -> None:
    """Minimal hand-built schema + a Supabase auth.uid() shim, then the REAL
    policy-defining SQL applied verbatim from the actual migration files.

    This deliberately does NOT replay the full historical migration sequence.
    Doing so hits pre-existing issues in this migration tree that are unrelated
    to tenant isolation — e.g. 073_task_pricing_evidence_invoicing.sql runs
    `DROP VIEW IF EXISTS public.task_instances` against what 068 actually
    created as a TABLE (which errors in real Postgres), and
    053_system_notifications.sql references `organizations(organization_id)`,
    a column that doesn't match `organizations`' real primary key (`id`).
    Both are worth a separate look but are out of scope for this audit.

    Instead: build minimal tables with exactly the columns the real policies
    below reference, then apply 054/139/140 verbatim, so the policy logic under
    test is the actual production SQL, not a reimplementation of it.
    """
    conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # --- Supabase auth.uid() shim, matching the real implementation --------
    conn.execute("CREATE SCHEMA IF NOT EXISTS auth")
    conn.execute("CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)")
    conn.execute(
        """
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE AS $$
          SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$
        """
    )

    for role in ("authenticated", "service_role"):
        conn.execute(
            f"DO $$ BEGIN "
            f"IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN "
            f"CREATE ROLE {role}; END IF; END $$;"
        )
    conn.execute("ALTER ROLE service_role BYPASSRLS")

    # --- Minimal tables, columns matching what the real policies reference -
    conn.execute("CREATE TABLE IF NOT EXISTS public.organizations (id uuid PRIMARY KEY)")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS public.users ("
        "  id uuid PRIMARY KEY, organization_id uuid REFERENCES public.organizations(id))"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS public.user_notifications ("
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"
        "  user_id uuid NOT NULL REFERENCES public.users(id),"
        "  organization_id uuid, title text, message text)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS public.conversations ("
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"
        "  organization_id uuid NOT NULL,"
        "  worker_id uuid REFERENCES public.users(id),"
        "  coordinator_id uuid REFERENCES public.users(id))"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS public.conversation_messages ("
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"
        "  conversation_id uuid NOT NULL REFERENCES public.conversations(id),"
        "  sender_id uuid REFERENCES public.users(id), content text)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS public.task_instances ("
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid)"
    )
    conn.execute("CREATE PUBLICATION supabase_realtime")

    for role in ("authenticated", "service_role"):
        conn.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
        conn.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}")

    # 054: the ORIGINAL bug — FORCE without ENABLE, plus the real policies.
    # Left exactly as committed; the fix (139) is applied later, per-test, so
    # each test can assert the pre-fix state before applying it.
    conn.execute(_read_migration("054_notifications_realtime_rls.sql"))


@pytest.fixture(scope="session")
def pg_conn(pg_dsn):
    import psycopg

    conn = psycopg.connect(pg_dsn, autocommit=True)
    try:
        _setup_schema(conn)
        yield conn
    finally:
        conn.close()


@pytest.fixture
def apply_migration(pg_conn):
    """Apply one of this audit's real fix migrations verbatim, by filename."""

    def _apply(filename: str) -> None:
        pg_conn.execute(_read_migration(filename))

    return _apply


@pytest.fixture
def rls_enabled(pg_conn):
    """True/False for whether Postgres itself considers RLS enabled on a table —
    i.e. `pg_class.relrowsecurity`, not whether a CREATE POLICY statement merely
    exists somewhere in the migration history."""

    def _check(table: str) -> bool:
        row = pg_conn.execute(
            "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (f"public.{table}",)
        ).fetchone()
        return bool(row and row[0])

    return _check


@pytest.fixture
def as_user(pg_conn):
    """Run a block of queries as the `authenticated` role with auth.uid() set to
    `user_id` — mirrors how PostgREST/Realtime actually authenticate a request
    from the anon key + a real user JWT. `user_id=None` simulates an
    unauthenticated/anon request (auth.uid() returns NULL)."""

    @contextmanager
    def _as_user(user_id: str | None):
        with pg_conn.transaction():
            pg_conn.execute("SET LOCAL ROLE authenticated")
            if user_id is not None:
                # Validate as a real UUID before interpolating — SET does not
                # support bind parameters, so this is the injection-safe way
                # to pass a value into it.
                safe_uuid = str(uuid.UUID(str(user_id)))
                pg_conn.execute(f"SET LOCAL request.jwt.claim.sub = '{safe_uuid}'")
            yield pg_conn
        pg_conn.execute("RESET ROLE")

    return _as_user


@pytest.fixture
def seed_two_users(pg_conn):
    """Two orgs, one user each — the standard cross-org fixture shape used
    throughout this audit's other tests (ORG_A/ORG_B/USER_A/USER_B)."""
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    with pg_conn.transaction():
        pg_conn.execute("INSERT INTO public.organizations (id) VALUES (%s), (%s)", (org_a, org_b))
        pg_conn.execute(
            "INSERT INTO public.users (id, organization_id) VALUES (%s, %s), (%s, %s)",
            (user_a, org_a, user_b, org_b),
        )
    return {"org_a": org_a, "org_b": org_b, "user_a": user_a, "user_b": user_b}
