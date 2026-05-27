from fastapi import APIRouter, Depends, HTTPException, Request
from ..services import ai_service, participant_service, session_service
from ..services.supabase_client import get_supabase_admin
from ..core.access import get_user_id, get_user_organization_id, is_allied_health
from ..core.security import get_current_user
from .security import require_recent_reauth
import logging
import json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])

REPORT_ROLES = {"support_coordinator", "allied_health"}


def _require_report_access(current_user: dict) -> None:
    if current_user.get("role") not in REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reports are restricted to support coordinators and allied health professionals")


def _derive_status(score) -> str:
    if score is None:
        return "draft"
    score = float(score)
    if score >= 85:
        return "compliant"
    if score >= 60:
        return "at_risk"
    return "non_compliant"


REPORT_TYPES = {
    "functional_capacity_assessment",
    "therapy_progress_report",
    "assistive_technology_assessment",
    "home_modification_report",
    "goal_review_report",
    "annual_review_report",
}


def _minimal_pdf_bytes(title: str, content: dict) -> bytes:
    text = (title + "\\n" + json.dumps(content, ensure_ascii=True)[:2500]).replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 10 Tf 50 780 Td ({text}) Tj ET"
    pdf = (
        "%PDF-1.4\n"
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        f"4 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj\n"
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        "trailer << /Root 1 0 R /Size 6 >>\n%%EOF\n"
    )
    return pdf.encode("utf-8")


@router.get("/participant/{participant_id}/summary")
async def participant_summary(participant_id: str, current_user: dict = Depends(get_current_user)):
    _require_report_access(current_user)
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    sessions = await session_service.get_sessions_by_participant(participant_id, current_user)
    summary = await ai_service.generate_patient_summary(participant, sessions)
    return {"participant_id": participant_id, "summary": summary}


@router.get("/compliance-overview")
async def compliance_overview(current_user: dict = Depends(get_current_user)):
    _require_report_access(current_user)
    report = await session_service.get_compliance_report(current_user)
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


@router.get("/history")
async def report_history(current_user: dict = Depends(get_current_user)):
    _require_report_access(current_user)
    query = (
        get_supabase_admin()
        .table("report_history")
        .select("*")
        .eq("organization_id", get_user_organization_id(current_user))
        .order("created_at", desc=True)
        .limit(100)
    )
    if is_allied_health(current_user):
        query = query.eq("generated_by", get_user_id(current_user))
    result = query.execute()
    return result.data or []


@router.post("/participant/{participant_id}/generate", status_code=201)
async def generate_participant_report(
    request: Request,
    participant_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    _require_report_access(current_user)
    require_recent_reauth(request, current_user)
    report_type = body.get("report_type") or "therapy_progress_report"
    if report_type not in REPORT_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported report type.")
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    sessions = await session_service.get_sessions_by_participant(participant_id, current_user)
    content = {
        "report_type": report_type,
        "participant": participant,
        "goals": participant.get("goals") or [],
        "sessions": sessions[:50],
        "clinical_sections": {
            "referral_reason": body.get("referral_reason"),
            "background": body.get("background"),
            "assessment_summary": body.get("assessment_summary"),
            "interventions": body.get("interventions"),
            "recommendations": body.get("recommendations"),
            "risk_compliance_flags": [
                s for s in sessions if (s.get("compliance_score") is not None and float(s.get("compliance_score")) < 85)
            ][:20],
        },
    }
    title = body.get("title") or f"{report_type.replace('_', ' ').title()} - {participant.get('full_name', 'Participant')}"
    file_path = None
    file_url = None
    try:
        file_path = f"{get_user_organization_id(current_user)}/{participant_id}/{report_type}.pdf"
        pdf_bytes = _minimal_pdf_bytes(title, content)
        supabase = get_supabase_admin()
        supabase.storage.from_("report-files").upload(
            file_path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        file_url = supabase.storage.from_("report-files").get_public_url(file_path)
    except Exception as exc:
        logger.warning("Report PDF storage unavailable: %s", exc)

    payload = {
        "organization_id": get_user_organization_id(current_user),
        "participant_id": participant_id,
        "generated_by": get_user_id(current_user),
        "report_type": report_type,
        "title": title,
        "content": content,
        "file_path": file_path,
        "file_url": file_url,
    }
    result = get_supabase_admin().table("report_history").insert(payload).execute()
    return result.data[0] if result.data else payload
