from fastapi import APIRouter, HTTPException
from ..services import ai_service, participant_service, session_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/participant/{participant_id}/summary")
async def participant_summary(participant_id: str):
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    sessions = await session_service.get_sessions_by_participant(participant_id)
    summary = await ai_service.generate_patient_summary(participant, sessions)
    return {"participant_id": participant_id, "summary": summary}


@router.get("/compliance-overview")
async def compliance_overview():
    report = await session_service.get_compliance_report()
    if not report:
        return {"average_score": 0, "total_sessions": 0, "compliant": 0, "non_compliant": 0, "sessions": []}

    scores = [r["compliance_score"] for r in report if r["compliance_score"] is not None]
    avg = sum(scores) / len(scores) if scores else 0
    compliant = sum(1 for s in scores if s >= 80)

    return {
        "average_score": round(avg, 1),
        "total_sessions": len(report),
        "compliant": compliant,
        "non_compliant": len(report) - compliant,
        "sessions": report[:20]
    }
