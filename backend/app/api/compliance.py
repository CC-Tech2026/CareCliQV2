from fastapi import APIRouter, HTTPException
from ..services import session_service, participant_service, funding_service, ai_service
from ..services.compliance_engine import run_compliance_check
from ..services.settings_service import get_physical_exam_session_types
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/compliance", tags=["compliance"])


def _derive_status(score) -> str:
    if score is None:
        return "draft"
    score = float(score)
    if score >= 85:
        return "compliant"
    if score >= 60:
        return "at_risk"
    return "non_compliant"


@router.post("/run/{session_id}")
async def run_compliance(session_id: str):
    """Run the compliance engine on a specific session, store results, and get AI explanation."""
    session = await session_service.get_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant_id = session.get("participant_id") or session.get("patient_id")
    participant = None
    existing_sessions = []

    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id)
        existing_sessions = await session_service.get_sessions_by_participant(participant_id)

    custom_physical_types = await get_physical_exam_session_types()
    rules_result = run_compliance_check(session, participant, existing_sessions, custom_physical_types)
    score = rules_result["score"]
    status = _derive_status(score)

    updates: dict = {
        "compliance_score": score,
    }
    if "compliance_status" in (session.keys() if hasattr(session, "keys") else {}):
        updates["compliance_status"] = status

    try:
        await session_service.update_session(session_id, updates)
    except Exception as e:
        logger.warning(f"Could not update compliance_status (column may not exist yet): {e}")
        try:
            await session_service.update_session(session_id, {"compliance_score": score})
        except Exception:
            pass

    try:
        await funding_service.create_compliance_audit_log(session_id, rules_result)
    except Exception as e:
        logger.warning(f"Audit log write failed: {e}")

    explanation = None
    failed = rules_result.get("failed_rules", [])
    if failed:
        try:
            explanation = await ai_service.explain_compliance(failed, session.get("notes", ""))
        except Exception as e:
            logger.warning(f"AI explanation failed: {e}")

    return {
        "session_id": session_id,
        "score": score,
        "status": status,
        "rules_result": rules_result,
        "explanation": explanation,
    }


@router.get("/report/{patient_id}")
async def compliance_report_for_patient(patient_id: str):
    """Get full compliance report for a specific participant."""
    sessions = await session_service.get_sessions_by_participant(patient_id)
    scored = [s for s in sessions if s.get("compliance_score") is not None]
    scores = [float(s["compliance_score"]) for s in scored]

    avg = round(sum(scores) / len(scores), 1) if scores else 0
    compliant = sum(1 for s in scores if s >= 85)
    at_risk = sum(1 for s in scores if 60 <= s < 85)
    non_compliant = sum(1 for s in scores if s < 60)

    session_rows = []
    for s in sessions:
        score = s.get("compliance_score")
        status = _derive_status(score)
        goals = s.get("goals_addressed") or []
        if isinstance(goals, str):
            import json
            try:
                goals = json.loads(goals)
            except Exception:
                goals = []

        session_rows.append({
            "session_id": s.get("id"),
            "session_date": s.get("session_date"),
            "session_type": s.get("session_type"),
            "compliance_score": score,
            "compliance_status": status,
            "duration_minutes": s.get("duration_minutes"),
            "notes_length": len(s.get("notes") or ""),
            "goals_linked": bool(goals),
            "status": s.get("status"),
        })

    return {
        "participant_id": patient_id,
        "total_sessions": len(sessions),
        "analyzed_sessions": len(scored),
        "average_score": avg,
        "compliant": compliant,
        "at_risk": at_risk,
        "non_compliant": non_compliant,
        "sessions": sorted(session_rows, key=lambda x: x.get("session_date") or "", reverse=True),
    }
