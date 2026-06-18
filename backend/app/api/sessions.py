from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Request
from typing import Optional, List
from datetime import datetime, timezone
from pydantic import BaseModel
from ..schemas.session import SessionCreate, SessionUpdate, MessageCreate
from ..services import session_service, ai_service, alert_service, funding_service, message_service, shift_service
from ..services.compliance_engine import run_compliance_check
from ..services.compliance_engine import ComplianceBlockedError, COMPLIANCE_BLOCKED_MESSAGE
from ..services import participant_service
from ..services.settings_service import get_physical_exam_session_types
from ..services.embedding_pipeline import run_session_embedding_pipeline
from ..schemas.alert import AlertCreate
from ..core.security import get_current_user
from ..core.access import get_user_organization_id, get_user_id
from ..services import audit_service
from .security import require_recent_reauth
import logging
import json
import os
import uuid

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])

ATTACHMENT_BUCKET = "session-attachments"
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/webm",
}


class SaveWithAIBody(BaseModel):
    acknowledged_warn_rules: List[str] = []


class WorkerLocationBody(BaseModel):
    lat: float
    lng: float


class StartSessionBody(BaseModel):
    startedAt: Optional[str] = None
    workerLocation: Optional[WorkerLocationBody] = None


class PreviewProgressBody(BaseModel):
    """Optional draft note content — used before PATCH on approve (CARECLIQV2-78)."""
    notes: Optional[str] = None
    activities_performed: Optional[str] = None
    outcomes: Optional[str] = None
    participant_response: Optional[str] = None
    progress_toward_goals: Optional[str] = None
    goals_addressed: Optional[List[str]] = None


class UploadEvidenceMeta(BaseModel):
    evidence_id: str
    task_id: str
    type: str
    filename: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    goal_id: Optional[str] = None
    duration_seconds: Optional[int] = None
    created_at: str
    content: Optional[str] = None


class UploadEvidenceBody(BaseModel):
    session_id: str
    evidence: List[UploadEvidenceMeta]
    files: dict[str, str] = {}


def _effective_tier(rule: dict) -> str:
    """Return enforcement_tier for a rule result, falling back to is_blocking."""
    tier = rule.get("enforcement_tier")
    if tier in ("block", "warn", "info"):
        return tier
    return "block" if rule.get("is_blocking") else "info"


def _resolve_goal_ids(session: dict, participant: dict | None) -> list[str]:
    raw = session.get("goals_addressed") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = []
    goal_ids = [str(g) for g in raw if g]
    if goal_ids:
        return goal_ids
    if participant:
        for g in participant.get("goals") or []:
            if isinstance(g, dict) and g.get("id"):
                goal_ids.append(str(g["id"]))
    return goal_ids[:5]


async def _build_prior_trajectory(
    session: dict,
    participant: dict | None,
    participant_id: str | None,
    current_user: dict,
) -> dict[str, list[dict]]:
    if not participant_id:
        return {}
    goal_ids = _resolve_goal_ids(session, participant)
    if not goal_ids:
        return {}
    return await session_service.get_prior_progress_sessions(
        participant_id=participant_id,
        goal_ids=goal_ids,
        exclude_session_id=str(session.get("id") or ""),
        current_user=current_user,
        limit=5,
    )


def _attachment_url(bucket, path: str) -> Optional[str]:
    try:
        signed = bucket.create_signed_url(path, 60 * 60 * 24 * 7)
        if isinstance(signed, dict):
            return (
                signed.get("signedURL")
                or signed.get("signed_url")
                or signed.get("signedUrl")
                or (signed.get("data") or {}).get("signedUrl")
                or (signed.get("data") or {}).get("signedURL")
            )
    except Exception:
        pass
    try:
        public_url = bucket.get_public_url(path)
        return str(public_url) if public_url else None
    except Exception:
        return None


def _safe_filename(filename: str) -> str:
    name = os.path.basename(filename or "attachment").replace("\\", "_").replace("/", "_")
    return name or "attachment"


async def _persist_session_attachment(
    *,
    session: dict,
    session_id: str,
    file: UploadFile,
    current_user: dict,
    attachment_type: str = "file",
) -> dict:
    from ..services.supabase_client import get_supabase_admin

    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported attachment type")

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Attachment is empty")
    if len(contents) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Attachment exceeds 15 MB limit")

    supabase = get_supabase_admin()
    original_name = _safe_filename(file.filename or "attachment")
    storage_name = f"{uuid.uuid4()}-{original_name}"
    path = f"{session.get('organization_id')}/{session_id}/{storage_name}"
    bucket = supabase.storage.from_(ATTACHMENT_BUCKET)

    bucket.upload(path, contents, {"content-type": file.content_type, "upsert": "false"})
    url = _attachment_url(bucket, path)

    record = {
        "session_id": session_id,
        "organization_id": session.get("organization_id"),
        "uploaded_by": current_user.get("sub"),
        "file_name": original_name,
        "file_path": path,
        "public_url": url,
        "mime_type": file.content_type,
        "size_bytes": len(contents),
        "attachment_type": attachment_type,
    }
    result = supabase.table("session_attachments").insert(record).execute()
    if not result.data:
        try:
            bucket.remove([path])
        except Exception:
            logger.warning("Could not clean up uploaded attachment after DB insert failure")
        raise HTTPException(status_code=500, detail="Failed to persist attachment")

    return result.data[0]


@router.get("")
async def list_sessions(limit: int = 50, current_user: dict = Depends(get_current_user)):
    return await session_service.get_all_sessions(limit, current_user)


@router.get("/recent")
async def recent_sessions(limit: int = 10, current_user: dict = Depends(get_current_user)):
    return await session_service.get_recent_sessions(limit, current_user)


@router.get("/compliance-report")
async def compliance_report(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "support_worker":
        raise HTTPException(status_code=403, detail="Use /api/worker/my-compliance for scoped worker compliance.")
    return await session_service.get_compliance_report(current_user)


@router.get("/participant/{participant_id}")
async def get_participant_sessions(participant_id: str, current_user: dict = Depends(get_current_user)):
    return await session_service.get_sessions_by_participant(participant_id, current_user)


@router.post("", status_code=201)
async def create_session(body: SessionCreate, current_user: dict = Depends(get_current_user)):
    try:
        session = await session_service.create_session(body, current_user)
        return session
    except PermissionError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{session_id}")
async def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/{session_id}/start")
async def start_session(
    session_id: str,
    body: StartSessionBody = StartSessionBody(),
    current_user: dict = Depends(get_current_user),
):
    """Start an active session (CARECLIQV2-244)."""
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    worker_location = body.workerLocation.model_dump() if body.workerLocation else None
    try:
        result = shift_service.start_session_by_id(
            session_id,
            worker_id,
            org_id,
            started_at=body.startedAt,
            worker_location=worker_location,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=409, detail=message)

    await audit_service.log_action(
        action_type="session.started",
        entity_type="session",
        entity_id=session_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"startedAt": result.get("session", {}).get("startedAt")},
    )
    return result


@router.patch("/{session_id}")
async def update_session(session_id: str, body: SessionUpdate, current_user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "session_date" in data and data["session_date"]:
        data["session_date"] = str(data["session_date"])
    try:
        updated = await session_service.update_session(session_id, data, current_user)
    except ValueError as exc:
        if str(exc) == COMPLIANCE_BLOCKED_MESSAGE:
            raise HTTPException(status_code=422, detail=COMPLIANCE_BLOCKED_MESSAGE)
        raise HTTPException(status_code=400, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Session not found")
    return updated


@router.post("/{session_id}/save-with-ai")
async def save_session_with_ai(
    session_id: str,
    background_tasks: BackgroundTasks,
    body: Optional[SaveWithAIBody] = None,
    current_user: dict = Depends(get_current_user),
):
    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant_id = session.get("participant_id") or session.get("patient_id")
    participant = None
    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id, current_user)

    participant_data = {
        "full_name": participant.get("full_name", "") if participant else session.get("participant_name", ""),
        "ndis_number": participant.get("ndis_number", "") if participant else session.get("participant_ndis", ""),
        "goals": participant.get("goals") if participant else [],
    }

    try:
        compliance_input_text = (
            session.get("compliance_input_text")
            or session.get("translated_english_note")
            or ""
        ).strip()
        if session.get("translation_status") in {"failed", "unsupported", "pending"} or not compliance_input_text:
            raise HTTPException(status_code=422, detail=COMPLIANCE_BLOCKED_MESSAGE)

        # Per-message translation gate: block if any voice note message has an
        # incomplete or failed translation (AC: CARECLIQV2 translation audit trail).
        messages = await message_service.get_session_messages(session_id)
        blocked_messages = [
            m for m in messages
            if m.get("translation_status") in {"failed", "pending"}
        ]
        if blocked_messages:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Session cannot be approved: {len(blocked_messages)} message(s) "
                    "have an incomplete or failed translation. "
                    "Resolve all translation errors before approving."
                ),
            )

        session_for_analysis = {
            **session,
            "notes": compliance_input_text,
            "activities_performed": "",
            "outcomes": "",
            "participant_response": "",
            "progress_toward_goals": "",
        }

        # 1. Run the rules-based compliance engine
        existing_sessions = []
        if participant_id:
            existing_sessions = await session_service.get_sessions_by_participant(participant_id, current_user)

        custom_physical_types = await get_physical_exam_session_types()

        budget_context = None
        if participant_id:
            plan = await funding_service.get_plan_for_participant(participant_id)
            budget_context = funding_service.build_budget_alignment_context(
                session_for_analysis, plan
            )

        duration_context = shift_service.build_duration_consistency_context(session_for_analysis)

        rules_result = run_compliance_check(
            session_for_analysis,
            participant,
            existing_sessions,
            custom_physical_types,
            budget_context=budget_context,
            duration_context=duration_context,
        )

        # Three-tier failure classification.
        # block  → hard-stop; status never advances regardless of acknowledgements
        # warn   → worker must acknowledge each failing rule before save is allowed
        # info   → logged, scored, never gated
        acknowledged = set(body.acknowledged_warn_rules if body else [])
        _failing = [r for r in rules_result.get("rules", []) if r.get("status") == "fail"]
        block_failures      = [r for r in _failing if _effective_tier(r) == "block"]
        warn_failures       = [r for r in _failing if _effective_tier(r) == "warn"]
        unacked_warn_failures = [r for r in warn_failures if r["rule"] not in acknowledged]
        # Keep backward-compat alias so existing callers that check blocking_failures still work
        blocking_failures = block_failures

        # 2. Run the unified CareScribe AI analysis (single GPT call, spec JSON output)
        #    Pass RP flags already detected by the rules engine so the AI is aware
        rp_flags_for_ai: list[dict] = rules_result.get("rp_flags", [])
        prior_trajectory = await _build_prior_trajectory(
            session, participant, participant_id, current_user
        )
        analysis = await ai_service.generate_session_analysis(
            session_for_analysis,
            participant_data,
            rp_flags=rp_flags_for_ai,
            prior_trajectory=prior_trajectory,
        )
        progress_delta = analysis.get("progress_delta")

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

        # Derive compliance status from tier failures, then score.
        # block failures → non_compliant (cannot be saved)
        # warn failures (even acked) → at_risk (coordinator can see it was acknowledged)
        # score-only → compliant / at_risk / non_compliant
        if block_failures:
            compliance_status = "non_compliant"
        elif warn_failures:
            compliance_status = "at_risk"
        elif blended_score >= 85:
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
            "compliance_status": compliance_status,
            "compliance_notes": " | ".join(
                (analysis.get("compliance") or {}).get("recommendations", [])
            ) or ai_compliance.get("assessment", ""),
            "ai_summary": insights.get("summary", ""),
            "ai_insights": json.dumps(ai_insights_payload),
            "restrictive_practice_detected": rp_detected,
            "restrictive_practice_types": json.dumps(rp_categories),
            "compliance_flags": json.dumps({"rp_flags": rp_flags}),
            "compliance_checked_at": compliance_checked_at,
            "input_language": input_language,
            "voice_input": voice_input,
            "incident_language_detected": incident_language_detected,
        }
        if progress_delta is not None:
            updates["progress_delta"] = json.dumps(progress_delta)
        # Only advance to "completed" when no block-tier failures AND all warn-tier
        # failures have been explicitly acknowledged by the worker.
        if not block_failures and not unacked_warn_failures:
            updates["status"] = "completed"
        # Persist acknowledged warn rules for the coordinator audit trail.
        if acknowledged:
            updates["acknowledged_warn_rules"] = json.dumps(sorted(acknowledged))

        updated = await session_service.update_session(session_id, updates, current_user)

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
                        "enforcement_tier": rule.get("enforcement_tier"),
                        "checked_at": compliance_checked_at,
                    },
                    on_conflict="session_id,rule_id",
                ).execute()
        except Exception as rp_persist_err:
            logger.warning(f"Compliance rule/RP flag persistence failed (non-critical): {rp_persist_err}")

        # Gate approval: block-tier failures always stop the save.
        # Warn-tier failures stop the save until each failing rule is acknowledged.
        # Compliance data has already been persisted above so both the worker
        # and coordinator can review the score and failure details.
        if block_failures:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "COMPLIANCE_BLOCKING_FAILURE",
                    "message": "Note cannot be approved: one or more critical compliance rules failed.",
                    "blocking_rules": [
                        {
                            "rule": r["rule"],
                            "label": r.get("label", r["rule"]),
                            "message": r.get("message", ""),
                            "enforcement_tier": "block",
                        }
                        for r in block_failures
                    ],
                    "compliance_score": blended_score,
                },
            )

        if unacked_warn_failures:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "COMPLIANCE_WARN_UNACKNOWLEDGED",
                    "message": "Note requires acknowledgement: one or more rules need your confirmation before saving.",
                    "warn_rules": [
                        {
                            "rule": r["rule"],
                            "label": r.get("label", r["rule"]),
                            "message": r.get("message", ""),
                            "enforcement_tier": "warn",
                        }
                        for r in unacked_warn_failures
                    ],
                    "compliance_score": blended_score,
                },
            )

        # 3. Store compliance audit log (non-critical — do not fail the response)
        try:
            rules_result["score"] = blended_score
            await funding_service.create_compliance_audit_log(session_id, rules_result)
        except Exception as side_e:
            logger.warning(f"Audit log failed (non-critical): {side_e}")

        # Stage 7: Enqueue embedding pipeline as background task (CARECLIQV2-30).
        # Only embed when the session reaches "completed" status so partial/blocked
        # notes never pollute the vector store.
        if updates.get("status") == "completed" and compliance_input_text:
            _org_id = session.get("organization_id") or get_user_organization_id(current_user)
            background_tasks.add_task(
                run_session_embedding_pipeline,
                session_id=session_id,
                organization_id=_org_id,
                text=compliance_input_text,
                participant_id=participant_id,
                worker_id=session.get("worker_id"),
            )

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

        # 5a. R9 — Auto-create an incident draft when incident trigger language is detected
        try:
            r9_rule = next(
                (r for r in rules_result.get("rules", []) if r.get("rule") == "R9"), None
            )
            if r9_rule and r9_rule.get("incident_triggers"):
                triggers: list[str] = r9_rule["incident_triggers"]
                from ..services.incident_service import create_incident
                from ..schemas.incident import IncidentCreate

                session_date_raw = session.get("session_date") or datetime.now(timezone.utc).isoformat()
                try:
                    incident_date = datetime.fromisoformat(str(session_date_raw)[:19])
                except Exception:
                    incident_date = datetime.now(timezone.utc)

                has_aggression = any(
                    "aggression" in t or "self-harm" in t or "abuse" in t for t in triggers
                )
                incident_type = "behaviour_of_concern" if has_aggression else "other"

                auto_incident = IncidentCreate(
                    participant_id=participant_id,
                    session_id=session_id,
                    title=f"Auto-detected: {', '.join(triggers[:2])}",
                    description=(
                        f"Incident language was automatically detected in a session note "
                        f"dated {session.get('session_date')}.\n\n"
                        f"Triggers: {', '.join(triggers)}\n\n"
                        "This draft was created by the compliance engine. "
                        "Please review and complete this incident report."
                    ),
                    incident_type=incident_type,
                    severity="high",
                    incident_date=incident_date,
                )
                org_id = current_user.get("organization_id") or session.get("organization_id")
                user_id_str = current_user.get("sub")
                await create_incident(auto_incident, org_id=org_id, user_id=user_id_str)

                if participant_id:
                    await alert_service.create_alert(AlertCreate(
                        participant_id=participant_id,
                        session_id=session_id,
                        alert_type="incident",
                        severity="high",
                        title="Incident language detected in session note",
                        message=(
                            f"Incident triggers detected: {', '.join(triggers)}. "
                            "An incident draft has been created for coordinator review."
                        ),
                    ))
        except Exception as r9_err:
            logger.warning(f"R9 auto-incident creation failed (non-critical): {r9_err}")

        # 5b. Create alerts for low compliance or budget issues (non-critical)
        try:
            if blended_score < 70 and participant_id:
                failed_labels = ", ".join(
                    f"{r['rule']} ({r.get('label', r['rule'])})"
                    for r in rules_result.get("failed_rules", [])
                )
                await alert_service.create_alert(AlertCreate(
                    participant_id=participant_id,
                    session_id=session_id,
                    alert_type="compliance",
                    severity="high",
                    title="Low Compliance Score",
                    message=(
                        f"Session on {session.get('session_date')} scored {blended_score:.0f}%. "
                        f"Failed rules: {failed_labels}"
                    ),
                ))

            for rule in rules_result.get("rules", []):
                code = rule.get("rule")
                if code not in ("budget_exceeded", "budget_warning"):
                    continue
                if code == "budget_exceeded" and rule.get("status") != "fail":
                    continue
                if code == "budget_warning" and rule.get("status") != "warning":
                    continue
                if not participant_id:
                    continue
                await alert_service.create_alert(AlertCreate(
                    participant_id=participant_id,
                    session_id=session_id,
                    alert_type="budget",
                    severity="high" if code == "budget_exceeded" else "medium",
                    title="NDIS Budget Exceeded" if code == "budget_exceeded" else "NDIS Budget Low",
                    message=rule.get("message") or "NDIS plan budget advisory",
                ))
        except Exception as side_e:
            logger.warning(f"Alert creation failed (non-critical): {side_e}")

        return {
            "session": updated,
            "compliance": {
                **ai_compliance,
                "score": blended_score,
                "rules_result": rules_result,
                "block_failures": block_failures,
                "warn_failures": warn_failures,
                "acknowledged_warn_rules": sorted(acknowledged),
                "rp_flags": rp_flags,
                "restrictive_practice_detected": rp_detected,
                "restrictive_practice_types": rp_categories,
                "checked_at": compliance_checked_at,
            },
            "insights": insights,
            "progress_delta": progress_delta,
        }
    except HTTPException:
        raise
    except ComplianceBlockedError:
        raise HTTPException(status_code=422, detail=COMPLIANCE_BLOCKED_MESSAGE)
    except Exception as e:
        logger.error(f"Error in save-with-ai: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/preview-progress")
async def preview_session_progress(
    session_id: str,
    body: Optional[PreviewProgressBody] = None,
    current_user: dict = Depends(get_current_user),
):
    """Dry-run progress_delta extraction for the approval modal (CARECLIQV2-78)."""
    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant_id = session.get("participant_id") or session.get("patient_id")
    participant = None
    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id, current_user)

    participant_data = {
        "full_name": participant.get("full_name", "") if participant else session.get("participant_name", ""),
        "ndis_number": participant.get("ndis_number", "") if participant else session.get("participant_ndis", ""),
        "goals": participant.get("goals") if participant else [],
    }

    draft = body or PreviewProgressBody()
    structured_parts = [
        draft.activities_performed or session.get("activities_performed") or "",
        draft.outcomes or session.get("outcomes") or "",
        draft.participant_response or session.get("participant_response") or "",
        draft.progress_toward_goals or session.get("progress_toward_goals") or "",
    ]
    structured_text = "\n".join(p.strip() for p in structured_parts if str(p).strip())
    free_notes = (draft.notes or session.get("notes") or "").strip()
    combined_notes = f"{structured_text}\n\n{free_notes}".strip() if structured_text and free_notes else (structured_text or free_notes)

    compliance_input_text = (
        combined_notes
        or session.get("compliance_input_text")
        or session.get("translated_english_note")
        or ""
    ).strip()
    if not compliance_input_text:
        return {"progress_delta": None, "delta_summaries": []}

    session_for_analysis = {
        **session,
        "notes": compliance_input_text,
        "activities_performed": draft.activities_performed or session.get("activities_performed") or "",
        "outcomes": draft.outcomes or session.get("outcomes") or "",
        "participant_response": draft.participant_response or session.get("participant_response") or "",
        "progress_toward_goals": draft.progress_toward_goals or session.get("progress_toward_goals") or "",
    }
    if draft.goals_addressed:
        session_for_analysis["goals_addressed"] = draft.goals_addressed

    try:
        prior_trajectory = await _build_prior_trajectory(
            session, participant, participant_id, current_user
        )
        analysis = await ai_service.generate_session_analysis(
            session_for_analysis,
            participant_data,
            rp_flags=[],
            prior_trajectory=prior_trajectory,
        )
        progress_delta = analysis.get("progress_delta")
        summaries = [
            str(e.get("delta_summary"))
            for e in (progress_delta or [])
            if isinstance(e, dict) and e.get("delta_summary")
        ]
        return {"progress_delta": progress_delta, "delta_summaries": summaries}
    except Exception as exc:
        logger.warning("preview-progress failed (non-critical): %s", exc)
        return {"progress_delta": None, "delta_summaries": []}


@router.get("/{session_id}/compliance")
async def get_session_compliance(session_id: str, current_user: dict = Depends(get_current_user)):
    """Return stored compliance results for a session — no recalculation."""
    session = await session_service.get_session_by_id(session_id, current_user)
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
async def get_session_audit(session_id: str, current_user: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    session = await session_service.get_session_by_id(session_id, current_user)
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
            participant = await participant_service.get_participant_by_id(participant_id, current_user)
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
    legal_record_text = (
        session.get("translated_english_note")
        or session.get("compliance_input_text")
        or ""
    )
    notes_text = legal_record_text
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

    if isinstance(structured_notes, dict):
        structured_notes = {
            key: value
            for key, value in structured_notes.items()
            if str(value or "").strip()
            and str(value or "").strip() in legal_record_text
        }
    else:
        structured_notes = {}

    # Deterministic compliance re-computed from saved data (mirrors the frontend gate)
    has_participant = bool(participant_id)
    duration_minutes_val = session.get("duration_minutes") or 0
    duration_ok = duration_minutes_val > 0
    has_activities = len(activity_log) > 0 if isinstance(activity_log, list) else False
    has_legal_structured = bool(structured_notes)
    any_note_filled = bool(notes_text.strip()) or has_legal_structured or any(
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
        "legal_record_text": legal_record_text,
        "compliance_input_text": session.get("compliance_input_text"),
        "original_language_input": session.get("original_language_input"),
        "detected_language": session.get("detected_language"),
        "translation_status": session.get("translation_status"),
        "translation_metadata": session.get("translation_metadata") or {},
        "translation_provider": session.get("translation_provider"),
        "translation_completed_at": session.get("translation_completed_at"),
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


@router.post("/{session_id}/attachments", status_code=201)
async def upload_session_attachment(
    session_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    attachment_type = "image" if (file.content_type or "").startswith("image/") else "file"
    return await _persist_session_attachment(
        session=session,
        session_id=session_id,
        file=file,
        current_user=current_user,
        attachment_type=attachment_type,
    )


@router.get("/{session_id}/attachments")
async def list_session_attachments(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    from ..services.supabase_client import get_supabase_admin

    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    supabase = get_supabase_admin()
    result = (
        supabase.table("session_attachments")
        .select("*")
        .eq("session_id", session_id)
        .eq("organization_id", session.get("organization_id"))
        .order("created_at", desc=False)
        .execute()
    )
    rows = result.data or []
    bucket = supabase.storage.from_(ATTACHMENT_BUCKET)
    for row in rows:
        if isinstance(row, dict) and row.get("file_path") and not row.get("public_url"):
            row["public_url"] = _attachment_url(bucket, row["file_path"])
    return rows


@router.delete("/{session_id}/attachments/{attachment_id}", status_code=204)
async def delete_session_attachment(
    request: Request,
    session_id: str,
    attachment_id: str,
    current_user: dict = Depends(get_current_user),
):
    from ..services.supabase_client import get_supabase_admin

    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    require_recent_reauth(request, current_user)
    supabase = get_supabase_admin()
    result = (
        supabase.table("session_attachments")
        .select("*")
        .eq("id", attachment_id)
        .eq("session_id", session_id)
        .eq("organization_id", session.get("organization_id"))
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Attachment not found")
    attachment = rows[0]
    try:
        supabase.storage.from_(ATTACHMENT_BUCKET).remove([attachment["file_path"]])
    except Exception as exc:
        logger.warning("Attachment storage delete failed: %s", exc)
    supabase.table("session_attachments").delete().eq("id", attachment_id).execute()
    return None


@router.post("/{session_id}/upload-evidence")
async def upload_session_evidence(
    session_id: str,
    body: UploadEvidenceBody,
    current_user: dict = Depends(get_current_user),
):
    """Upload task evidence media (photo/voice) to object storage (CARECLIQV2-230)."""
    from ..services import evidence_upload_service

    if body.session_id != session_id:
        raise HTTPException(status_code=400, detail="session_id mismatch")

    session = await session_service.get_session_by_id(session_id, current_user)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)

    try:
        result = evidence_upload_service.upload_session_evidence_media(
            session_id=session_id,
            worker_id=worker_id,
            organization_id=org_id,
            evidence_items=[item.model_dump() for item in body.evidence],
            files=body.files,
        )
    except ValueError as exc:
        msg = str(exc)
        if "exceeds" in msg.lower() or "mb limit" in msg.lower():
            raise HTTPException(status_code=413, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc

    if not result:
        raise HTTPException(status_code=404, detail="Session not found")

    await audit_service.log_action(
        action_type="session.evidence_uploaded",
        entity_type="session",
        entity_id=session_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"uploaded_count": len(result.get("uploaded_evidence") or [])},
    )
    return result


@router.post("/{session_id}/upload-photo")
async def upload_photo(session_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    try:
        session = await session_service.get_session_by_id(session_id, current_user)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        attachment = await _persist_session_attachment(
            session=session,
            session_id=session_id,
            file=file,
            current_user=current_user,
            attachment_type="image",
        )
        existing_photos = session.get("photo_urls") or []
        if isinstance(existing_photos, str):
            try:
                existing_photos = json.loads(existing_photos)
            except Exception:
                existing_photos = []
        url_result = attachment.get("public_url") or attachment.get("file_path")
        existing_photos.append(url_result)
        await session_service.update_session(session_id, {"photo_urls": existing_photos}, current_user)

        return {"url": url_result, "path": attachment.get("file_path"), "attachment": attachment}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Photo upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/transcribe-audio")
async def transcribe_audio(session_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    try:
        if not await session_service.get_session_by_id(session_id, current_user):
            raise HTTPException(status_code=404, detail="Session not found")
        contents = await file.read()
        text = await ai_service.transcribe_audio(contents, file.filename)
        await session_service.update_session(session_id, {"transcription": text, "notes": text}, current_user)
        return {"transcription": text}
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Session messages — chat-based documentation endpoints
# ---------------------------------------------------------------------------

@router.get("/{session_id}/messages")
async def get_session_messages(session_id: str, current_user: dict = Depends(get_current_user)):
    """Return all chat messages for a session, ordered by created_at ascending."""
    if not await session_service.get_session_by_id(session_id, current_user):
        raise HTTPException(status_code=404, detail="Session not found")
    return await message_service.get_session_messages(session_id)


@router.post("/{session_id}/messages", status_code=201)
async def create_session_message(session_id: str, body: MessageCreate, current_user: dict = Depends(get_current_user)):
    """Persist a single chat message for a session."""
    try:
        if not await session_service.get_session_by_id(session_id, current_user):
            raise HTTPException(status_code=404, detail="Session not found")
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


@router.patch("/{session_id}/messages/{message_id}")
async def update_session_message(
    session_id: str,
    message_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Persist translated content/metadata for a chat message."""
    try:
        if not await session_service.get_session_by_id(session_id, current_user):
            raise HTTPException(status_code=404, detail="Session not found")
        result = await message_service.update_session_message(session_id, message_id, body or {})
        if result is None:
            raise HTTPException(status_code=404, detail="Message not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_session_message error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
