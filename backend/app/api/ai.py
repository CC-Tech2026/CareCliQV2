from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from ..services import ai_service, participant_service, session_service
from ..core.security import get_current_user
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


class ExplainComplianceRequest(BaseModel):
    failed_rules: List[dict]
    session_notes: Optional[str] = ""


class TranslateRequest(BaseModel):
    text: str
    source_language: Optional[str] = "auto"


class ClinicalRewriteRequest(BaseModel):
    text: str
    source_language: Optional[str] = "auto"


class AssessNoteRequest(BaseModel):
    note_text: str
    session_id: Optional[str] = None
    participant_id: Optional[str] = None
    session_started: bool = False
    goals: Optional[List[dict]] = None


@router.post("/insight")
async def get_insights(body: InsightRequest, current_user: dict = Depends(get_current_user)):
    participant = await participant_service.get_participant_by_id(body.participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    session_data = body.model_dump()
    if body.session_id:
        session = await session_service.get_session_by_id(body.session_id, current_user)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        session_data.update(session)
    try:
        insights = await ai_service.generate_clinical_insights(session_data, participant)
        return insights
    except ValueError as e:
        if str(e) == ai_service.LEGAL_RECORD_REQUIRED_MESSAGE:
            raise HTTPException(status_code=422, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"AI insight error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compliance")
async def check_compliance(body: ComplianceRequest, current_user: dict = Depends(get_current_user)):
    if not body.session_id:
        raise HTTPException(
            status_code=422,
            detail="Compliance blocked: English legal record is missing or translation failed.",
        )
    session = await session_service.get_session_by_id(body.session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if (
        session.get("translation_status") in ai_service.BLOCKING_TRANSLATION_STATUSES
        or not (session.get("compliance_input_text") or session.get("translated_english_note") or "").strip()
    ):
        raise HTTPException(
            status_code=422,
            detail="Compliance blocked: English legal record is missing or translation failed.",
        )
    try:
        result = await ai_service.check_compliance(session)
        return result
    except ValueError as e:
        if str(e) == ai_service.LEGAL_RECORD_REQUIRED_MESSAGE:
            raise HTTPException(status_code=422, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Compliance check error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/explain-compliance")
async def explain_compliance(body: ExplainComplianceRequest, current_user: dict = Depends(get_current_user)):
    """Generate human-readable compliance explanation and actionable fix suggestions."""
    try:
        result = await ai_service.explain_compliance(body.failed_rules, body.session_notes or "")
        return result
    except Exception as e:
        logger.error(f"Explain compliance error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/improve-note")
async def improve_note_endpoint(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Generate an AI-improved clinical note fixing all failed compliance rules.

    Body: { notes: str, failed_rules: list, rp_flags: list }
    Returns: { improved_note: str, rule_suggestions: [{rule, issue, suggestion}] }
    """
    notes = (body.get("notes") or "").strip()
    failed_rules = body.get("failed_rules") or []
    rp_flags = body.get("rp_flags") or []

    if not notes:
        raise HTTPException(status_code=422, detail="notes field is required")

    try:
        result = await ai_service.improve_note(notes, failed_rules, rp_flags)
        return result
    except Exception as e:
        logger.error(f"Improve-note error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary/{participant_id}")
async def get_ai_summary(participant_id: str, current_user: dict = Depends(get_current_user)):
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    sessions = await session_service.get_sessions_by_participant(participant_id, current_user)

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


@router.post("/translate")
async def translate_text(body: TranslateRequest, current_user: dict = Depends(get_current_user)):
    """Translate text to English, detecting source language automatically."""
    try:
        result = await ai_service.translate_to_english(body.text, body.source_language or "auto")
        return result
    except ai_service.TranslationProviderUnavailable as e:
        logger.warning("Translation provider unavailable: %s", e)
        raise HTTPException(status_code=503, detail=str(e))
    except ai_service.TranslationProviderFailure as e:
        logger.error("Translation provider failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Translation error: {str(e)}")
        raise HTTPException(status_code=500, detail="Translation failed. Please try again.")


@router.post("/clinical-rewrite")
async def rewrite_clinical(body: ClinicalRewriteRequest, current_user: dict = Depends(get_current_user)):
    """Rewrite informal or dictated text into NDIS-compliant clinical documentation.

    Non-English input is translated to English first, then restructured using
    the TARP framework (Time · Activity · Response · Progress).
    """
    try:
        result = await ai_service.clinical_rewrite(body.text, body.source_language or "auto")
        return result
    except Exception as e:
        logger.error(f"Clinical rewrite error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/assess-note")
async def assess_note(body: AssessNoteRequest, current_user: dict = Depends(get_current_user)):
    """Real-time 4-criteria compliance scoring for a clinical note entry.

    Criteria (from NDIS spec):
      +25% Timestamp/session check-in
      +35% Semantic NDIS goal connection
      +25% Documented support outcome text
      +15% Next-step / routine action logged

    Returns score (0-100), is_ready_for_billing, and per-criterion breakdown.
    If score >= 75 and session_id provided, patches is_ready_for_billing on the session.
    """
    goals: list[dict] = body.goals or []

    # If participant_id supplied but no goals, try to fetch from patient_goals table
    if body.participant_id and not goals:
        participant = await participant_service.get_participant_by_id(body.participant_id, current_user)
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        try:
            from ..services import goals_service
            from ..services.migration_state import patient_goals_table_missing
            if not patient_goals_table_missing:
                goals = await goals_service.get_goals_for_participant(body.participant_id)
        except Exception:
            pass

    try:
        result = await ai_service.assess_note(
            note_text=body.note_text,
            session_started=body.session_started,
            goals=goals,
        )
    except Exception as e:
        logger.error(f"Assess-note error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    # If billing-ready, flag the session record
    if result.get("is_ready_for_billing") and body.session_id:
        try:
            from ..services import session_service
            session = await session_service.get_session_by_id(body.session_id, current_user)
            legal_ready = bool(
                session
                and session.get("translation_status") not in ai_service.BLOCKING_TRANSLATION_STATUSES
                and (session.get("compliance_input_text") or session.get("translated_english_note") or "").strip()
            )
            if legal_ready:
                await session_service.update_session(
                    body.session_id, {"is_ready_for_billing": True}, current_user
                )
            else:
                logger.warning(
                    "Skipped billing-ready flag for session %s because English legal record is not ready",
                    body.session_id,
                )
        except Exception as exc:
            logger.warning("Failed to flag is_ready_for_billing on session %s: %s", body.session_id, exc)

    return result
