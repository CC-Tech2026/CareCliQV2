"""The schema check: every migration file applied, and what the newest ones
added is readable through the API."""
from __future__ import annotations

from unittest.mock import patch

from backend.app.services import schema_status as ss


def test_finds_the_tables_and_columns_a_migration_adds():
    sql = """
    BEGIN;
    ALTER TABLE public.organizations
        ADD COLUMN IF NOT EXISTS voice_transcription_enabled BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS voice_transcription_agreed_by UUID REFERENCES public.users(id);
    CREATE TABLE IF NOT EXISTS public.shift_series (id uuid primary key);
    ALTER TABLE shift_travel_expenses ADD COLUMN paid_via TEXT;
    COMMENT ON COLUMN public.organizations.voice_transcription_enabled IS 'x';
    COMMIT;
    """
    assert ss.objects_in(sql) == [
        ("shift_series", None),
        ("organizations", "voice_transcription_enabled"),
        ("organizations", "voice_transcription_agreed_by"),
        ("shift_travel_expenses", "paid_via"),
    ]


def test_the_real_newest_migrations_are_parsed():
    files = ss.migration_files()
    assert files and ss.number(files[-1]).isdigit()
    sql = (ss.MIGRATIONS_DIR / "268_voice_transcription_opt_in.sql").read_text(encoding="utf-8")
    assert ("organizations", "voice_transcription_enabled") in ss.objects_in(sql)


def test_up_to_date_only_when_nothing_is_pending_and_the_api_sees_it_all():
    files = ss.migration_files()
    with patch.object(ss, "_applied", return_value=set(files)), patch.object(ss, "_visible", return_value=True):
        s = ss.check(fresh=True)
    assert s["pending"] == [] and s["api_sees_newest"] is True and s["up_to_date"] is True
    # Whichever column the newest migrations add (not a fixed one: newer
    # migrations keep moving older ones out of the window checked).
    assert s["visible"], "none of the newest migrations adds a column to check"
    # A column entry ("table.column"); a migration that adds a whole table
    # is listed by table name alone.
    key = next(k for k in s["visible"] if "." in k)
    hidden_column = key.split(".", 1)[1]

    with patch.object(ss, "_applied", return_value=set(files[:-1])), patch.object(ss, "_visible", return_value=True):
        s = ss.check(fresh=True)
    assert s["pending"] == [files[-1]] and s["up_to_date"] is False

    with patch.object(ss, "_applied", return_value=set(files)), \
         patch.object(ss, "_visible", side_effect=lambda t, c: c != hidden_column):
        s = ss.check(fresh=True)
    assert s["visible"][key] is False
    assert s["api_sees_newest"] is False and s["up_to_date"] is False


def test_without_a_database_connection_it_says_it_did_not_check():
    with patch.object(ss, "_applied", return_value=None), patch.object(ss, "_visible", return_value=True):
        s = ss.check(fresh=True)
    assert s["migrations_checked"] is False and s["up_to_date"] is None and s["pending"] == []


def test_the_public_summary_names_no_tables():
    with patch.object(ss, "_applied", return_value=set(ss.migration_files())), patch.object(ss, "_visible", return_value=True):
        ss.check(fresh=True)
        out = ss.summary()
    assert set(out) == {"latest_migration", "migrations_checked", "pending", "api_sees_newest_migrations", "up_to_date"}
    assert out["pending"] == 0 and out["up_to_date"] is True
