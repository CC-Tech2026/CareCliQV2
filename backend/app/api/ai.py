from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from ..services import ai_service, participant_service, session_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])


class InsightRequest(BaseModel):
    session_id: str
    participant_id: str
    notes: Optional[str] = ""
    session_type: Optional[str] = ""
    duration_minutes: Optional[int] = 0
    tags: Optional[List[str]] = []
    goals_addressed: Optional[List[str]] = []


class ComplianceRequest(BaseModel):
    session_id: Optional[str] = None
    notes: Optional[str] = ""
    duration_minutes: Optional[int] = 0
    goals_addressed: Optional[List[str]] = []
    session_type: Optional[str] = ""
    tags: Optional[List[str]] = []


@router.post("/insight")
async def get_insights(body: InsightRequest):
    participant = await participant_service.get_participant_by_id(body.participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    session_data = body.model_dump()
    try:
        insights = await ai_service.generate_clinical_insights(session_data, participant)
        return insights
    except Exception as e:
        logger.error(f"AI insight error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compliance")
async def check_compliance(body: ComplianceRequest):
    try:
        result = await ai_service.check_compliance(body.model_dump())
        return result
    except Exception as e:
        logger.error(f"Compliance check error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary/{participant_id}")
async def get_ai_summary(participant_id: str):
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    sessions = await session_service.get_sessions_by_participant(participant_id)

    try:
        summary = await ai_service.generate_patient_summary(participant, sessions)
        return {
            "participant_id": participant_id,
            "participant_name": participant.get("full_name"),
            "summary": summary,
            "sessions_count": len(sessions)
        }
    except Exception as e:
        logger.error(f"AI summary error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
