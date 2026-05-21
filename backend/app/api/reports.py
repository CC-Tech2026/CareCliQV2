from fastapi import APIRouter, Depends, HTTPException
from ..core.rbac import require_auth, require_coordinator, require_participant_access
from ..services import ai_service, participant_service, session_service
import logging
import json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])


def _derive_status(score) -> str:
    if score is None:
        return "draft"
    score = float(score)
    if score >= 85:
        return "compliant"
    if score >= 60:
        return "at_risk"
    return "non_compliant"


@router.get("/participant/{participant_id}/summary")
async def participant_summary(participant_id: str, user: dict = Depends(require_auth)):
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    await require_participant_access(user, participant)
    sessions = await session_service.get_sessions_by_participant(participant_id)
    summary = await ai_service.generate_patient_summary(participant, sessions)
    return {"participant_id": participant_id, "summary": summary}


@router.get("/compliance-overview")
async def compliance_overview(user: dict = Depends(require_coordinator)):
    report = await session_service.get_compliance_report()
    if not report:
        return {
            "average_score": 0,
            "total_sessions": 0,
            "compliant": 0,
            "at_risk": 0,
            "non_compliant": 0,
            "sessions": [],
        }

    scores = [float(r["compliance_score"]) for r in report if r.get("compliance_score") is not None]
    avg = sum(scores) / len(scores) if scores else 0
    compliant = sum(1 for s in scores if s >= 85)
    at_risk = sum(1 for s in scores if 60 <= s < 85)
    non_compliant = sum(1 for s in scores if s < 60)

    sessions_with_status = []
    for item in report[:50]:
        score = item.get("compliance_score")
        goals = item.get("goals_addressed") or []
        if isinstance(goals, str):
            try:
                goals = json.loads(goals)
            except Exception:
                goals = []
        sessions_with_status.append({
            **item,
            "compliance_status": _derive_status(score),
            "goals_linked": bool(goals),
        })

    return {
        "average_score": round(avg, 1),
        "total_sessions": len(report),
        "compliant": compliant,
        "at_risk": at_risk,
        "non_compliant": non_compliant,
        "sessions": sessions_with_status,
    }
