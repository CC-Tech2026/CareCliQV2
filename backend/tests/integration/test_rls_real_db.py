"""
Real-Postgres RLS integration tests for the tenant isolation audit fixes
(2026-08-21). Unlike the rest of the backend suite, these tests apply real
migration SQL to a real Postgres and query it as the real `authenticated`
Postgres role — proving RLS is actually enforced, not just that the Python
code intends to filter by organisation.

Run:
    INTEGRATION_REAL_DB=1 pytest backend/tests/integration/ -v

Requires Docker running locally. See README.md in this directory.
"""
from __future__ import annotations

import uuid


class TestRealtimeRLSForceVsEnable:
    """139_fix_realtime_rls_enable.sql — user_notifications/conversations/
    conversation_messages ran FORCE ROW LEVEL SECURITY without ever running
    ENABLE, so their policies (from 054) existed but were never evaluated."""

    def test_pre_fix_rls_is_not_actually_enabled(self, rls_enabled):
        """Confirms the bug as committed in 054: FORCE was run, but
        pg_class.relrowsecurity is still false until ENABLE also runs."""
        assert rls_enabled("user_notifications") is False
        assert rls_enabled("conversations") is False
        assert rls_enabled("conversation_messages") is False

    def test_pre_fix_a_user_can_read_another_users_notifications(self, as_user, seed_two_users):
        """Live demonstration of the bug: despite a `user_id = auth.uid()`
        policy existing on user_notifications, User B can read User A's
        notification because RLS was never actually turned on."""
        users = seed_two_users
        with as_user(users["user_a"]) as conn:
            conn.execute(
                "INSERT INTO public.user_notifications (user_id, organization_id, title) "
                "VALUES (%s, %s, 'Org A private notification')",
                (users["user_a"], users["org_a"]),
            )

        with as_user(users["user_b"]) as conn:
            rows = conn.execute("SELECT title FROM public.user_notifications").fetchall()

        assert len(rows) == 1, (
            "This assertion documents the pre-fix bug (CCQ audit finding #1): "
            "User B should not see User A's notification, but does, because "
            "FORCE-without-ENABLE leaves RLS off entirely."
        )
        assert rows[0][0] == "Org A private notification"

    def test_fix_enables_rls_and_restores_isolation(
        self, apply_migration, rls_enabled, as_user, seed_two_users, pg_conn
    ):
        """Apply the real fix (139) and confirm both that Postgres now
        considers RLS enabled, and that cross-user visibility is actually
        blocked — the same scenario as the bug-demonstration test above, but
        after the fix."""
        apply_migration("139_fix_realtime_rls_enable.sql")

        assert rls_enabled("user_notifications") is True
        assert rls_enabled("conversations") is True
        assert rls_enabled("conversation_messages") is True

        users = seed_two_users
        # 054 only defines SELECT/UPDATE policies for user_notifications —
        # inserts happen via the backend's service_role client in production,
        # which bypasses RLS entirely, so seed the same way here rather than
        # as the `authenticated` role (which has no INSERT policy at all).
        pg_conn.execute(
            "INSERT INTO public.user_notifications (user_id, organization_id, title) "
            "VALUES (%s, %s, 'Post-fix Org A notification')",
            (users["user_a"], users["org_a"]),
        )

        with as_user(users["user_b"]) as conn:
            rows = conn.execute("SELECT title FROM public.user_notifications").fetchall()
        assert rows == [], "Post-fix: User B must not see User A's notification"

        with as_user(users["user_a"]) as conn:
            rows = conn.execute("SELECT title FROM public.user_notifications").fetchall()
        assert [r[0] for r in rows] == ["Post-fix Org A notification"], \
            "Post-fix: User A must still see their own notification"

    def test_fix_blocks_cross_worker_conversation_visibility(
        self, apply_migration, as_user, seed_two_users, pg_conn
    ):
        """Same bug class, different table: a worker in Org B must not be able
        to read a conversation between an Org A worker and their coordinator."""
        apply_migration("139_fix_realtime_rls_enable.sql")
        users = seed_two_users

        # Seeded via the privileged connection — 054 defines no INSERT policy
        # for either table (writes happen via the backend's service_role
        # client in production), same reasoning as the notification test above.
        conv_id = pg_conn.execute(
            "INSERT INTO public.conversations (organization_id, worker_id, coordinator_id) "
            "VALUES (%s, %s, %s) RETURNING id",
            (users["org_a"], users["user_a"], users["user_a"]),
        ).fetchone()[0]
        pg_conn.execute(
            "INSERT INTO public.conversation_messages (conversation_id, sender_id, content) "
            "VALUES (%s, %s, 'Org A private message')",
            (conv_id, users["user_a"]),
        )

        with as_user(users["user_b"]) as conn:
            convs = conn.execute("SELECT id FROM public.conversations").fetchall()
            messages = conn.execute("SELECT content FROM public.conversation_messages").fetchall()

        assert convs == [], "Org B worker must not see Org A's conversation"
        assert messages == [], "Org B worker must not see Org A's conversation messages"


class TestMissingTenantRLSFix:
    """140_enable_missing_tenant_rls.sql — public.users, public.organizations,
    task_instances, and ~30 other tenant-scoped tables were created without RLS
    ever being enabled. This suite only stands up users/organizations/
    task_instances (the others are covered by migration 140's own
    per-table `IF EXISTS` guard, which this test also implicitly exercises by
    applying the real file against a schema where most of its target tables
    are absent)."""

    def test_pre_fix_rls_was_never_enabled(self, rls_enabled):
        assert rls_enabled("users") is False
        assert rls_enabled("organizations") is False
        assert rls_enabled("task_instances") is False

    def test_fix_enables_rls_with_deny_by_default_policy(self, apply_migration, rls_enabled, as_user, pg_conn):
        """Apply the real fix (140) and confirm RLS is on for all three tables,
        AND that the authenticated role — which the app itself never uses, but
        which is exactly what a direct PostgREST/anon-key client would be —
        gets zero rows back even for data nominally in "its own" org, since the
        fix is intentionally deny-by-default rather than org-scoped (nothing
        queries these tables directly today)."""
        apply_migration("140_enable_missing_tenant_rls.sql")

        assert rls_enabled("users") is True
        assert rls_enabled("organizations") is True
        assert rls_enabled("task_instances") is True

        org_id = uuid.uuid4()
        with pg_conn.transaction():
            pg_conn.execute("INSERT INTO public.organizations (id) VALUES (%s)", (org_id,))
            pg_conn.execute(
                "INSERT INTO public.task_instances (organization_id) VALUES (%s)", (org_id,)
            )

        with as_user(None) as conn:
            rows = conn.execute("SELECT id FROM public.task_instances").fetchall()
        assert rows == [], (
            "A direct client using the authenticated role must get zero rows "
            "from task_instances — this table has no policy granting it any "
            "access at all (service_role only), by design."
        )

    def test_fix_does_not_error_on_tables_this_schema_never_created(self, apply_migration):
        """The real 140 file targets ~30 tables that this minimal integration
        schema doesn't stand up (worker scheduling, security/session tables,
        etc.) — its own `IF EXISTS` guard must make that a silent no-op rather
        than an error, exactly as it needs to behave against a partially
        up-to-date production database."""
        apply_migration("140_enable_missing_tenant_rls.sql")  # must not raise
