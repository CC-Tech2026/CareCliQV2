from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from ..services import ai_service, participant_service, session_service
from ..core.security import get_current_user
from ..core.access import get_user_organization_id
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


class TranslatePreviewRequest(BaseModel):
    text: str
    target_language: str


class AssessNoteRequest(BaseModel):
    note_text: str
    session_id: Optional[str] = None
    participant_id: Optional[str] = None
    session_started: bool = False
    goals: Optional[List[dict]] = None
    progress_delta: Optional[List[dict]] = None


class TaskSuggestionsRequest(BaseModel):
    task_title: str
    context: str
    participant_name: str


class TaskInstructionsRequest(BaseModel):
    task_title: str
    task_purpose: str
    goal_name: Optional[str] = None
    goal_description: Optional[str] = None
    participant_name: str
    participant_id: Optional[str] = None


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
    participant_id = body.get("participant_id")

    if not notes:
        raise HTTPException(status_code=422, detail="notes field is required")

    try:
        org_id = current_user.get("organization_id")
        result = await ai_service.improve_note(
            notes,
            failed_rules,
            rp_flags,
            participant_id=participant_id,
            organisation_id=org_id,
        )
        return result
    except Exception as e:
        logger.error(f"Improve-note error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/translate-preview")
async def translate_preview_endpoint(
    body: TranslatePreviewRequest,
    current_user: dict = Depends(get_current_user),
):
    """Best-effort, read-only translation of English text into a display
    language for preview purposes only (never the saved legal record).
    Always returns 200 with the original text on failure rather than
    erroring - this is a convenience feature, not a compliance requirement.
    """
    try:
        result = await ai_service.translate_for_worker_preview(body.text, body.target_language)
        return result
    except Exception as e:
        logger.warning(f"Translate-preview error (non-critical): {str(e)}")
        return {"translated": body.text, "target_language": body.target_language, "translated_ok": False}


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


class IncidentComplyRequest(BaseModel):
    incident_type: str
    severity: str
    title: str
    description: str
    worker_actions: Optional[str] = ""
    participant_name: Optional[str] = "the participant"


@router.post("/incidents/comply")
async def comply_incident_endpoint(
    body: IncidentComplyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Rewrite a raw incident report in NDIS-compliant clinical English and return
    a compliance score, per-criterion breakdown, flags, and reporting requirements."""
    try:
        result = await ai_service.comply_incident(
            incident_type=body.incident_type,
            severity=body.severity,
            title=body.title,
            description=body.description,
            worker_actions=body.worker_actions or "",
            participant_name=body.participant_name or "the participant",
        )
        return result
    except Exception as e:
        logger.error("Incident comply error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/assess-note")
async def assess_note(body: AssessNoteRequest, current_user: dict = Depends(get_current_user)):
    """Real-time 5-criteria compliance scoring for a clinical note entry (CARECLIQV2-75).

    Criteria:
      +20 Session active check-in
      +28 Semantic NDIS goal connection
      +20 Documented support outcome
      +12 Next-step / routine action
      +20 Progress Evidence (progress_delta)

    Without progress_delta the score is capped at 80. Billing threshold remains 75.
    """
    goals: list[dict] = body.goals or []
    progress_delta = body.progress_delta

    if body.session_id and progress_delta is None:
        try:
            session = await session_service.get_session_by_id(body.session_id, current_user)
            if session:
                progress_delta = session.get("progress_delta")
        except Exception:
            pass

    # If participant_id supplied but no goals, fetch from ndis_goals
    if body.participant_id and not goals:
        participant = await participant_service.get_participant_by_id(body.participant_id, current_user)
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        try:
            from ..services import goals_service
            from ..services.migration_state import ndis_goals_table_missing
            if not ndis_goals_table_missing:
                goals = await goals_service.get_goals_for_participant(body.participant_id)
        except Exception:
            pass

    try:
        result = await ai_service.assess_note(
            note_text=body.note_text,
            session_started=body.session_started,
            goals=goals,
            progress_delta=progress_delta,
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


@router.post("/task-suggestions")
async def get_task_suggestions(
    body: TaskSuggestionsRequest,
    current_user: dict = Depends(get_current_user),
):
    """Generate AI-powered alternative task title suggestions.
    
    Args:
        task_title: The task title entered by user
        context: Context like "for goal: X" or "for core support"
        participant_name: Name of the participant
        
    Returns:
        {"suggestions": [list of alternative task titles]}
    """
    try:
        result = await ai_service.generate_task_suggestions(
            task_title=body.task_title,
            context=body.context,
            participant_name=body.participant_name,
        )
        return result
    except Exception as e:
        logger.error(f"Task suggestions error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/task-instructions")
async def get_task_instructions(
    body: TaskInstructionsRequest,
    current_user: dict = Depends(get_current_user),
):
    """Generate AI-powered instruction suggestions for a task.
    
    Args:
        task_title: The task title
        task_purpose: Either "core" or "goal"
        goal_name: Name of linked goal (if purpose is "goal")
        goal_description: Description of linked goal
        participant_name: Name of participant
        
    Returns:
        {"suggestions": [list of instruction options]}
    """
    try:
        org_id = get_user_organization_id(current_user)
        result = await ai_service.generate_task_instructions(
            task_title=body.task_title,
            task_purpose=body.task_purpose,
            goal_name=body.goal_name,
            goal_description=body.goal_description,
            participant_name=body.participant_name,
            participant_id=body.participant_id,
            organisation_id=org_id,
        )
        return result
    except Exception as e:
        logger.error(f"Task instructions error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
