from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import Optional
from ..schemas.session import SessionCreate, SessionUpdate
from ..services import session_service, ai_service, alert_service, funding_service
from ..services.compliance_engine import run_compliance_check
from ..services import participant_service
from ..schemas.alert import AlertCreate
import logging
import json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("")
async def list_sessions(limit: int = 50):
    return await session_service.get_all_sessions(limit)


@router.get("/recent")
async def recent_sessions(limit: int = 10):
    return await session_service.get_recent_sessions(limit)


@router.get("/compliance-report")
async def compliance_report():
    return await session_service.get_compliance_report()


@router.get("/participant/{participant_id}")
async def get_participant_sessions(participant_id: str):
    return await session_service.get_sessions_by_participant(participant_id)


@router.post("", status_code=201)
async def create_session(body: SessionCreate):
    try:
        session = await session_service.create_session(body)
        return session
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{session_id}")
async def get_session(session_id: str):
    session = await session_service.get_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/{session_id}")
async def update_session(session_id: str, body: SessionUpdate):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "session_date" in data and data["session_date"]:
        data["session_date"] = str(data["session_date"])
    updated = await session_service.update_session(session_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Session not found")
    return updated


@router.post("/{session_id}/save-with-ai")
async def save_session_with_ai(session_id: str):
    session = await session_service.get_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant_id = session.get("participant_id") or session.get("patient_id")
    participant = None
    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id)

    participant_data = {
        "full_name": session.get("participant_name", ""),
        "ndis_number": session.get("participant_ndis", ""),
    }

    try:
        # 1. Run the rules-based compliance engine
        existing_sessions = []
        if participant_id:
            existing_sessions = await session_service.get_sessions_by_participant(participant_id)

        rules_result = run_compliance_check(session, participant, existing_sessions)

        # 2. Run AI compliance check for narrative assessment
        ai_compliance = await ai_service.check_compliance(session)
        insights = await ai_service.generate_clinical_insights(session, participant_data)

        # Use rules engine score blended with AI score (70/30 weight)
        blended_score = round(
            rules_result["score"] * 0.7 + ai_compliance["score"] * 0.3, 1
        )

        updates = {
            "compliance_score": blended_score,
            "compliance_notes": ai_compliance.get("assessment", ""),
            "ai_summary": insights.get("summary", ""),
            "ai_insights": json.dumps({
                **insights,
                "rules_result": rules_result,
            }),
            "status": "completed",
        }
        updated = await session_service.update_session(session_id, updates)

        # 3. Store compliance audit log
        rules_result["score"] = blended_score
        await funding_service.create_compliance_audit_log(session_id, rules_result)

        # 4. Record budget usage
        duration = session.get("duration_minutes") or 0
        session_type = session.get("session_type") or "Support"
        if participant_id and duration > 0:
            await funding_service.record_session_budget_usage(
                session_id, participant_id, int(duration), session_type
            )

        # 5. Create alerts for low compliance or budget issues
        if blended_score < 70:
            await alert_service.create_alert(AlertCreate(
                participant_id=participant_id,
                session_id=session_id,
                alert_type="compliance",
                severity="high",
                title="Low Compliance Score",
                message=(
                    f"Session on {session.get('session_date')} scored {blended_score:.0f}%. "
                    f"Failed rules: {', '.join(r['rule'] for r in rules_result.get('failed_rules', []))}"
                ),
            ))

        budget_rule = next(
            (r for r in rules_result["rules"] if r["rule"] == "budget_not_exceeded"),
            None,
        )
        if budget_rule and budget_rule["status"] in ("warning", "fail"):
            await alert_service.create_alert(AlertCreate(
                participant_id=participant_id,
                session_id=session_id,
                alert_type="budget",
                severity="high" if budget_rule["status"] == "fail" else "medium",
                title="Budget Alert",
                message=budget_rule["message"],
            ))

        return {
            "session": updated,
            "compliance": {**ai_compliance, "score": blended_score, "rules_result": rules_result},
            "insights": insights,
        }
    except Exception as e:
        logger.error(f"Error in save-with-ai: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/upload-photo")
async def upload_photo(session_id: str, file: UploadFile = File(...)):
    from ..services.supabase_client import get_supabase_admin
    supabase = get_supabase_admin()

    contents = await file.read()
    path = f"sessions/{session_id}/{file.filename}"

    try:
        supabase.storage.from_("uploaded-evidence").upload(path, contents, {"content-type": file.content_type})
        url_result = supabase.storage.from_("uploaded-evidence").get_public_url(path)

        session = await session_service.get_session_by_id(session_id)
        existing_photos = session.get("photo_urls") or []
        if isinstance(existing_photos, str):
            try:
                existing_photos = json.loads(existing_photos)
            except Exception:
                existing_photos = []
        existing_photos.append(url_result)
        await session_service.update_session(session_id, {"photo_urls": existing_photos})

        return {"url": url_result, "path": path}
    except Exception as e:
        logger.error(f"Photo upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/transcribe-audio")
async def transcribe_audio(session_id: str, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        text = await ai_service.transcribe_audio(contents, file.filename)
        await session_service.update_session(session_id, {"transcription": text, "notes": text})
        return {"transcription": text}
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
