from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import Optional
from datetime import datetime, timezone
from ..schemas.session import SessionCreate, SessionUpdate, MessageCreate
from ..services import session_service, ai_service, alert_service, funding_service, message_service
from ..services.compliance_engine import run_compliance_check
from ..services import participant_service
from ..services.settings_service import get_physical_exam_session_types
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


@router.get("/{session_id}/context")
async def get_session_context(session_id: str):
    """Return session + participant's active plan goals + risk profile for the live session engine."""
    session = await session_service.get_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant_id = session.get("participant_id") or session.get("patient_id")
    plan_goals: list[dict] = []
    risk_profile: dict = {}

    if participant_id:
        # Goals from patient_goals table (plan-linked)
        try:
            from ..services import goals_service
            from ..services.migration_state import patient_goals_table_missing
            if not patient_goals_table_missing:
                plan_goals = await goals_service.get_goals_for_participant(participant_id)
        except Exception as exc:
            logger.warning("context: goals fetch failed for %s: %s", participant_id, exc)

        # Risk profile from patients record
        try:
            participant = await participant_service.get_participant_by_id(participant_id)
            if participant:
                risk_profile = {
                    "risk_level": participant.get("risk_level", "low"),
                    "triggers": participant.get("risk_triggers", "") or "",
                    "management_plan": participant.get("risk_management_plan", "") or "",
                }
        except Exception as exc:
            logger.warning("context: risk fetch failed for %s: %s", participant_id, exc)

    return {
        "session": session,
        "plan_goals": plan_goals,
        "risk_profile": risk_profile,
    }


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
        "full_name": participant.get("full_name", "") if participant else session.get("participant_name", ""),
        "ndis_number": participant.get("ndis_number", "") if participant else session.get("participant_ndis", ""),
        "goals": participant.get("goals") if participant else [],
    }

    try:
        # 1. Run the rules-based compliance engine
        existing_sessions = []
        if participant_id:
            existing_sessions = await session_service.get_sessions_by_participant(participant_id)

        custom_physical_types = await get_physical_exam_session_types()
        rules_result = run_compliance_check(session, participant, existing_sessions, custom_physical_types)

        # 2. Run the unified CareScribe AI analysis (single GPT call, spec JSON output)
        #    Pass RP flags already detected by the rules engine so the AI is aware
        rp_flags_for_ai: list[dict] = rules_result.get("rp_flags", [])
        analysis = await ai_service.generate_session_analysis(
            session, participant_data, rp_flags=rp_flags_for_ai
        )

        # AI spec compliance score (from weighted 5-dimension breakdown)
        ai_spec_score = float((analysis.get("compliance") or {}).get("score") or 0)

        # Use rules engine score blended with AI spec score (70/30 weight)
        blended_score = round(
            rules_result["score"] * 0.7 + ai_spec_score * 0.3, 1
        )

        # Keep backward-compat alias objects
        insights = {
            "summary": analysis.get("session_summary") or analysis.get("summary", ""),
            "key_observations": analysis.get("key_observations", []),
            "concerns": analysis.get("concerns", []),
            "next_session_recommendations": analysis.get("next_session_recommendations", []),
            "progress_trend": analysis.get("progress_trend", "stable"),
        }
        ai_compliance = {
            "score": ai_spec_score,
            "assessment": (analysis.get("compliance") or {}).get("recommendations", []),
        }

        # Derive claim readiness status from score
        if blended_score >= 85:
            compliance_status = "compliant"
        elif blended_score >= 60:
            compliance_status = "at_risk"
        else:
            compliance_status = "non_compliant"

        # 2b. RP enrichment — flags already detected inside run_compliance_check;
        #     now enrich with Claude rewrite suggestions (non-blocking)
        rp_flags: list[dict] = rules_result.get("rp_flags", [])
        try:
            if rp_flags:
                anthropic_client = ai_service.get_anthropic_client()
                rp_flags = await ai_service.enrich_rp_suggestions(rp_flags, anthropic_client)
                # Write enriched suggestions back into rules_result for consistency
                rules_result["rp_flags"] = rp_flags
        except Exception as rp_err:
            logger.warning(f"RP Claude enrichment failed (non-critical): {rp_err}")

        rp_detected = rules_result.get("restrictive_practice_detected", len(rp_flags) > 0)
        rp_categories = rules_result.get("restrictive_practice_types", [])
        compliance_checked_at = datetime.now(timezone.utc).isoformat()

        # Preserve audit-critical clinical data that was saved in the PATCH step.
        # The PATCH merges structured_notes/activity_log into ai_insights; we must
        # carry them forward so they survive this AI analysis overwrite.
        existing_ai = session.get("ai_insights") or {}
        if isinstance(existing_ai, str):
            try:
                existing_ai = json.loads(existing_ai)
            except Exception:
                existing_ai = {}
        preserved_structured_notes = existing_ai.get("structured_notes", {}) if isinstance(existing_ai, dict) else {}
        preserved_activity_log = existing_ai.get("activity_log", []) if isinstance(existing_ai, dict) else []

        # Derive input_language / voice_input / incident_language_detected from session data
        raw_transcription = session.get("transcription") or ""
        input_language = session.get("input_language") or "en"
        voice_input = raw_transcription or session.get("voice_input") or ""
        incident_language_detected = session.get("incident_language_detected") or False

        # Build the enriched ai_insights payload (spec fields + backward-compat fields)
        ai_insights_payload = {
            # Backward-compatible insight fields (used by session detail UI)
            **insights,
            # Full CareScribe spec output
            "session_summary": analysis.get("session_summary", ""),
            "ndis_mapping": analysis.get("ndis_mapping", {}),
            "compliance_spec": analysis.get("compliance", {}),
            "budget_insights": analysis.get("budget_insights", {}),
            "score_breakdown": (analysis.get("compliance") or {}).get("score_breakdown", {}),
            "ai_flags": (analysis.get("compliance") or {}).get("flags", []),
            "ai_recommendations": (analysis.get("compliance") or {}).get("recommendations", []),
            # Structured notes: prefer existing (user-entered) over AI-generated
            "structured_notes": preserved_structured_notes or analysis.get("structured_notes", {}),
            "activity_log": preserved_activity_log,
            # Rules engine result
            "rules_result": rules_result,
            "compliance_status": compliance_status,
            "rp_flags": rp_flags,
        }

        updates = {
            "compliance_score": blended_score,
            "compliance_notes": " | ".join(
                (analysis.get("compliance") or {}).get("recommendations", [])
            ) or ai_compliance.get("assessment", ""),
            "ai_summary": insights.get("summary", ""),
            "ai_insights": json.dumps(ai_insights_payload),
            "status": "completed",
            "restrictive_practice_detected": rp_detected,
            "restrictive_practice_types": json.dumps(rp_categories),
            "compliance_flags": json.dumps({"rp_flags": rp_flags}),
            "compliance_checked_at": compliance_checked_at,
            "input_language": input_language,
            "voice_input": voice_input,
            "incident_language_detected": incident_language_detected,
        }
        updated = await session_service.update_session(session_id, updates)

        # 2c. Persist RP flags + per-rule results (non-critical)
        try:
            from ..services.supabase_client import get_supabase_admin
            supabase = get_supabase_admin()

            # Upsert RP flags (idempotent via UNIQUE(session_id, phrase))
            for flag in rp_flags:
                supabase.table("restrictive_practice_flags").upsert(
                    {
                        "session_id": session_id,
                        "category": flag.get("category"),
                        "phrase": flag.get("phrase"),
                        "context": flag.get("context"),
                        "severity": flag.get("severity"),
                        "suggestion": flag.get("suggestion"),
                    },
                    on_conflict="session_id,phrase",
                ).execute()

            # Upsert per-rule rows into compliance_rule_results (idempotent via UNIQUE(session_id, rule_id))
            for rule in rules_result.get("rules", []):
                supabase.table("compliance_rule_results").upsert(
                    {
                        "session_id": session_id,
                        "rule_id": rule.get("rule"),
                        "status": rule.get("status"),
                        "message": rule.get("message"),
                        "severity": rule.get("severity"),
                        "checked_at": compliance_checked_at,
                    },
                    on_conflict="session_id,rule_id",
                ).execute()
        except Exception as rp_persist_err:
            logger.warning(f"Compliance rule/RP flag persistence failed (non-critical): {rp_persist_err}")

        # 3. Store compliance audit log (non-critical — do not fail the response)
        try:
            rules_result["score"] = blended_score
            await funding_service.create_compliance_audit_log(session_id, rules_result)
        except Exception as side_e:
            logger.warning(f"Audit log failed (non-critical): {side_e}")

        # 4. Record budget usage (non-critical)
        try:
            duration = session.get("duration_minutes") or 0
            session_type = session.get("session_type") or "Support"
            if participant_id and duration > 0:
                await funding_service.record_session_budget_usage(
                    session_id, participant_id, int(duration), session_type
                )
        except Exception as side_e:
            logger.warning(f"Budget usage record failed (non-critical): {side_e}")

        # 5. Create alerts for low compliance or budget issues (non-critical)
        try:
            if blended_score < 70 and participant_id:
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
                (r for r in rules_result.get("rules", []) if r["rule"] == "budget_not_exceeded"),
                None,
            )
            if budget_rule and budget_rule["status"] in ("warning", "fail") and participant_id:
                await alert_service.create_alert(AlertCreate(
                    participant_id=participant_id,
                    session_id=session_id,
                    alert_type="budget",
                    severity="high" if budget_rule["status"] == "fail" else "medium",
                    title="Budget Alert",
                    message=budget_rule["message"],
                ))
        except Exception as side_e:
            logger.warning(f"Alert creation failed (non-critical): {side_e}")

        return {
            "session": updated,
            "compliance": {
                **ai_compliance,
                "score": blended_score,
                "rules_result": rules_result,
                "rp_flags": rp_flags,
                "restrictive_practice_detected": rp_detected,
                "restrictive_practice_types": rp_categories,
                "checked_at": compliance_checked_at,
            },
            "insights": insights,
        }
    except Exception as e:
        logger.error(f"Error in save-with-ai: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/compliance")
async def get_session_compliance(session_id: str):
    """Return stored compliance results for a session — no recalculation."""
    session = await session_service.get_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ai_insights = session.get("ai_insights") or {}
    if isinstance(ai_insights, str):
        try:
            ai_insights = json.loads(ai_insights)
        except Exception:
            ai_insights = {}
    if not isinstance(ai_insights, dict):
        ai_insights = {}

    rules_result = ai_insights.get("rules_result")

    # Fetch stored RP flags from the dedicated table
    stored_rp_flags: list[dict] = []
    try:
        from ..services.supabase_client import get_supabase_admin
        supabase = get_supabase_admin()
        rp_resp = supabase.table("restrictive_practice_flags").select("*").eq("session_id", session_id).execute()
        stored_rp_flags = rp_resp.data or []
    except Exception:
        # Fall back to ai_insights if table doesn't exist yet
        stored_rp_flags = ai_insights.get("rp_flags", [])

    # Parse restrictive_practice_types (stored as JSON string)
    rp_types = session.get("restrictive_practice_types") or []
    if isinstance(rp_types, str):
        try:
            rp_types = json.loads(rp_types)
        except Exception:
            rp_types = []

    return {
        "session_id": session_id,
        "score": session.get("compliance_score"),
        "status": session.get("compliance_status") or ai_insights.get("compliance_status") or "draft",
        "rules": rules_result.get("rules", []) if rules_result else [],
        "rp_flags": stored_rp_flags,
        "restrictive_practice_detected": session.get("restrictive_practice_detected", False),
        "restrictive_practice_types": rp_types,
        "checked_at": session.get("compliance_checked_at"),
    }


@router.get("/{session_id}/audit")
async def get_session_audit(session_id: str):
    from datetime import datetime, timezone
    session = await session_service.get_session_by_id(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    ai_insights = session.get("ai_insights") or {}
    if isinstance(ai_insights, str):
        try:
            ai_insights = json.loads(ai_insights)
        except Exception:
            ai_insights = {}
    if not isinstance(ai_insights, dict):
        ai_insights = {}

    participant_id = session.get("participant_id") or session.get("patient_id")
    participant = None
    if participant_id:
        try:
            participant = await participant_service.get_participant_by_id(participant_id)
        except Exception:
            pass

    participant_name = None
    participant_ndis = None
    participant_dob = None
    participant_sex = None
    if participant:
        participant_name = participant.get("full_name")
        participant_ndis = participant.get("ndis_number")
        participant_dob = participant.get("date_of_birth")
        participant_sex = participant.get("biological_sex")
    else:
        participants_obj = session.get("participants") or {}
        if isinstance(participants_obj, dict):
            participant_name = participants_obj.get("full_name")
            participant_ndis = participants_obj.get("ndis_number")

    generated_at = datetime.now(timezone.utc).isoformat()
    notes_text = session.get("notes") or ""
    goals = session.get("goals_addressed") or []
    photos = session.get("photo_urls") or []
    compliance_score = session.get("compliance_score")
    compliance_status = session.get("compliance_status") or ai_insights.get("compliance_status") or "draft"

    # Structured clinical data — prefer dedicated DB columns, fall back to ai_insights
    db_activities_performed = session.get("activities_performed") or ""
    db_outcomes = session.get("outcomes") or ""
    db_participant_response = session.get("participant_response") or ""
    db_progress_toward_goals = session.get("progress_toward_goals") or ""
    has_db_structured = any([
        db_activities_performed.strip(),
        db_outcomes.strip(),
        db_participant_response.strip(),
        db_progress_toward_goals.strip(),
    ])
    if has_db_structured:
        structured_notes = {
            "activitiesPerformed": db_activities_performed,
            "outcomes": db_outcomes,
            "participantResponse": db_participant_response,
            "progressTowardGoals": db_progress_toward_goals,
        }
    else:
        structured_notes = ai_insights.get("structured_notes") or {}
    activity_log = ai_insights.get("activity_log") or []

    # Deterministic compliance re-computed from saved data (mirrors the frontend gate)
    has_participant = bool(participant_id)
    duration_minutes_val = session.get("duration_minutes") or 0
    duration_ok = duration_minutes_val > 0
    has_activities = len(activity_log) > 0 if isinstance(activity_log, list) else False
    any_note_filled = has_db_structured or any(
        (structured_notes.get(k) or "").strip()
        for k in ["activitiesPerformed", "outcomes", "participantResponse", "progressTowardGoals"]
    ) if isinstance(structured_notes, dict) else False
    has_photos = len(photos) > 0 if isinstance(photos, list) else False
    has_goals = len(goals) > 0 if isinstance(goals, list) else False
    # Mirror frontend ComplianceService weights: 20+20+20+20+10+10 = 100
    det_score = (
        (20 if has_participant else 0) +
        (20 if duration_ok else 0) +
        (20 if has_activities else 0) +
        (20 if any_note_filled else 0) +
        (10 if has_photos else 0) +
        (10 if has_goals else 0)
    )
    det_issues: list = []
    if not has_participant:
        det_issues.append("Session not linked to a participant")
    if not duration_ok:
        det_issues.append("Session duration not recorded")
    if not has_activities:
        det_issues.append("No activities logged (activity log empty)")
    if not any_note_filled:
        det_issues.append("No clinical note fields completed")
    if not has_photos:
        det_issues.append("No photo evidence captured")
    if not has_goals:
        det_issues.append("Non-compliant: No goals linked to this session.")
    # Blocking: score too low, content gate not met, OR no goals linked (all are hard NDIS requirements)
    det_blocking = det_score < 50 or not (duration_ok and (has_activities or any_note_filled)) or not has_goals

    # Human-readable formatted text for auditors
    separator = "=" * 50
    formatted_lines = [
        "NDIS SESSION AUDIT RECORD",
        separator,
        f"Participant : {participant_name or 'Unknown'} | NDIS: {participant_ndis or 'Not recorded'}",
        f"Session Date: {session.get('session_date') or 'N/A'} | Type: {session.get('session_type') or 'N/A'} | Duration: {session.get('duration_minutes') or 0} min",
        f"Status      : {session.get('status') or 'draft'} | Generated: {generated_at}",
        separator,
        "",
    ]

    # Include structured note sections if available, else fall back to combined notes
    if structured_notes:
        for label, key in [
            ("ACTIVITIES PERFORMED", "activitiesPerformed"),
            ("OUTCOMES", "outcomes"),
            ("PARTICIPANT RESPONSE", "participantResponse"),
            ("PROGRESS TOWARD GOALS", "progressTowardGoals"),
        ]:
            val = (structured_notes.get(key) or "").strip()
            if val:
                formatted_lines.extend([f"{label}:", val, ""])
    else:
        formatted_lines.extend(["CLINICAL NOTES:", notes_text if notes_text else "(No clinical notes recorded)", ""])

    if activity_log:
        formatted_lines.append("ACTIVITY LOG (timestamped):")
        for entry in activity_log if isinstance(activity_log, list) else []:
            if isinstance(entry, dict):
                formatted_lines.append(f"  [{entry.get('timestamp', '?')}] {entry.get('label') or entry.get('type', '?')}")
        formatted_lines.append("")

    if goals:
        formatted_lines.append("GOALS ADDRESSED:")
        goal_list = goals if isinstance(goals, list) else []
        for g in goal_list:
            formatted_lines.append(f"  \u2022 {g}")
        formatted_lines.append("")

    if photos:
        formatted_lines.append(f"PHOTO EVIDENCE: {len(photos)} photo(s) attached")
        formatted_lines.append("")

    # Always show deterministic compliance in the audit record (never null)
    formatted_lines.append(f"COMPLIANCE: {det_score}/100 points \u2014 {'APPROVED' if not det_blocking else 'BLOCKED'}")
    if det_issues:
        formatted_lines.append("COMPLIANCE GAPS:")
        for issue in det_issues:
            formatted_lines.append(f"  \u2022 {issue}")
    if compliance_score is not None:
        formatted_lines.append(f"  (AI-blended score: {compliance_score:.0f}% \u2014 {compliance_status})")
    formatted_lines.append("")

    formatted_lines.extend([
        separator,
        'NDIS Principle: "If it cannot be evidenced, it cannot be claimed."',
    ])
    formatted_text = "\n".join(formatted_lines)

    import os
    practitioner_name = session.get("practitioner_name") or os.environ.get("PRACTITIONER_NAME", "NDIS Support Practitioner")
    practitioner_credentials = session.get("practitioner_credentials") or os.environ.get("PRACTITIONER_CREDENTIALS", "Support Worker")
    sign_off_date = datetime.now(timezone.utc).strftime("%d %B %Y")

    audit = {
        "audit_version": "1.0",
        "ndis_principle": "If it cannot be evidenced, it cannot be claimed.",
        "generated_at": generated_at,
        "formatted_text": formatted_text,
        "session": {
            "id": session.get("id"),
            "date": session.get("session_date"),
            "type": session.get("session_type"),
            "duration_minutes": session.get("duration_minutes"),
            "status": session.get("status"),
        },
        "participant": {
            "id": participant_id,
            "full_name": participant_name,
            "ndis_number": participant_ndis,
            "date_of_birth": str(participant_dob) if participant_dob else None,
            "biological_sex": participant_sex or "unspecified",
        },
        "practitioner": {
            "name": practitioner_name,
            "credentials": practitioner_credentials,
            "sign_off_date": sign_off_date,
        },
        "structured_notes": structured_notes,
        "clinical_notes": notes_text,
        "activity_log": activity_log if isinstance(activity_log, list) else [],
        "transcription": session.get("transcription"),
        "goals_addressed": goals if isinstance(goals, list) else [],
        "evidence_summary": {
            "photo_count": len(photos),
            "has_transcription": bool(session.get("transcription")),
            "has_activity_log": bool(activity_log),
        },
        "photo_urls": photos if isinstance(photos, list) else [],
        "body_markers": session.get("body_markers") or [],
        "compliance": {
            "score": det_score,
            "blocking": det_blocking,
            "issues": det_issues,
            "status": "approved" if not det_blocking else "blocked",
            "ai_blended_score": compliance_score,
            "ai_status": compliance_status,
            "ai_notes": session.get("compliance_notes"),
        },
        "ai_insights": {
            "summary": ai_insights.get("summary"),
            "key_observations": ai_insights.get("key_observations"),
            "next_session_recommendations": ai_insights.get("next_session_recommendations"),
            "progress_trend": ai_insights.get("progress_trend"),
        },
    }
    return audit


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


# ---------------------------------------------------------------------------
# Session messages — chat-based documentation endpoints
# ---------------------------------------------------------------------------

@router.get("/{session_id}/messages")
async def get_session_messages(session_id: str):
    """Return all chat messages for a session, ordered by created_at ascending."""
    return await message_service.get_session_messages(session_id)


@router.post("/{session_id}/messages", status_code=201)
async def create_session_message(session_id: str, body: MessageCreate):
    """Persist a single chat message for a session."""
    try:
        result = await message_service.create_session_message(
            session_id, body.model_dump(exclude_none=True)
        )
        if result is None:
            raise HTTPException(status_code=500, detail="Failed to create message")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_session_message error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
