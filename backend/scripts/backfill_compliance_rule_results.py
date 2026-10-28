"""Fill compliance_rule_results, which feeds the compliance centre's "Most
common issues".

Until this fix the session save wrote this table with columns it doesn't
have (rule_id, severity, checked_at), so it stayed empty everywhere. Each
session's own result is also kept in sessions.ai_insights.rules_result, so
the table can be rebuilt from that.

    .venv/Scripts/python -m backend.scripts.backfill_compliance_rule_results           # dry run
    .venv/Scripts/python -m backend.scripts.backfill_compliance_rule_results --apply

--recheck-org <organization_id> also runs the compliance engine on that
organisation's notes that were never checked (e.g. seeded pilot notes), and
stores the result on the note the same way a real save does. Only use it on
seeded or test organisations: it overwrites those notes' scores.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from backend.app.services.compliance_engine import run_compliance_check  # noqa: E402
from backend.app.services.supabase_client import get_supabase_admin  # noqa: E402

PAGE = 500


def _insights(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("ai_insights")
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}


def _status_for(score: float) -> str:
    return "compliant" if score >= 85 else ("at_risk" if score >= 60 else "non_compliant")


def _rule_rows(session: dict[str, Any], rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    checked_at = session.get("compliance_checked_at") or session.get("created_at")
    return [
        {
            "session_id": session["id"],
            "organization_id": session.get("organization_id"),
            "rule_code": rule.get("rule"),
            "rule_name": rule.get("label") or rule.get("rule"),
            "status": rule.get("status"),
            "message": rule.get("message"),
            "suggestion": rule.get("suggestion"),
            "enforcement_tier": rule.get("enforcement_tier"),
            "created_at": checked_at,
        }
        for rule in rules
        if rule.get("rule")
    ]


def recheck(db, org_id: str, apply: bool) -> None:
    sessions = (
        db.table("sessions").select("*").eq("organization_id", org_id).eq("status", "completed").execute().data or []
    )
    for session in sessions:
        if _insights(session).get("rules_result"):
            continue
        participant = (
            db.table("participants").select("*").eq("id", session.get("patient_id")).limit(1).execute().data or [None]
        )[0]
        others = [s for s in sessions if s["patient_id"] == session["patient_id"] and s["id"] != session["id"]]
        result = run_compliance_check(session, participant, others)
        score = float(result.get("score") or 0)
        print(f"  recheck {session['session_date']} {(participant or {}).get('full_name', '?'):16s} "
              f"score {session.get('compliance_score')} -> {score:.1f}, failed {[r['rule'] for r in result.get('failed_rules', [])]}")
        if apply:
            insights = {**_insights(session), "rules_result": result}
            db.table("sessions").update({
                "ai_insights": json.dumps(insights, default=str),
                "compliance_score": score,
                "compliance_status": _status_for(score),
                "compliance_review_required": score < 85,
            }).eq("id", session["id"]).execute()


def backfill(db, apply: bool) -> None:
    start, written, sessions_seen = 0, 0, 0
    while True:
        batch = (
            db.table("sessions").select("id, organization_id, ai_insights, compliance_checked_at, created_at")
            .not_.is_("ai_insights", "null").order("id").range(start, start + PAGE - 1).execute().data or []
        )
        if not batch:
            break
        for session in batch:
            rules = (_insights(session).get("rules_result") or {}).get("rules") or []
            rows = _rule_rows(session, rules)
            if not rows:
                continue
            sessions_seen += 1
            written += len(rows)
            if apply:
                db.table("compliance_rule_results").delete().eq("session_id", session["id"]).execute()
                db.table("compliance_rule_results").insert(rows).execute()
        start += PAGE
    print(f"{'Wrote' if apply else 'Would write'} {written} rule results for {sessions_seen} sessions.")


def main() -> None:
    apply = "--apply" in sys.argv
    db = get_supabase_admin()
    if "--recheck-org" in sys.argv:
        recheck(db, sys.argv[sys.argv.index("--recheck-org") + 1], apply)
    backfill(db, apply)
    if not apply:
        print("Dry run. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
