from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from ..services import ai_service, participant_service, session_service
from ..services.compliance_engine import collect_budget_rule_alerts_from_sessions
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


def _pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(value: str, width: int = 88) -> list[str]:
    words = str(value or "").replace("\n", " ").split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or ["Not recorded."]


def _report_pdf_bytes(title: str, content: dict) -> bytes:
    participant = content.get("participant") or {}
    clinician = content.get("clinician") or {}
    sections = content.get("clinical_sections") or {}
    sessions = content.get("sessions") or []
    goals = content.get("goals") or []
    flags = sections.get("risk_compliance_flags") or []
    lines = [
        "CareCliQ Allied Health Report",
        title,
        f"Generated: {content.get('generated_at')}",
        "",
        f"Client: {participant.get('full_name', 'Participant')}",
        f"NDIS Number: {participant.get('ndis_number', 'Not recorded')}",
        f"Primary Disability: {participant.get('primary_disability', 'Not recorded')}",
        "",
        f"Clinician: {clinician.get('full_name', 'Not recorded')}",
        f"Discipline: {clinician.get('discipline', 'Not recorded')}",
        f"AHPRA: {clinician.get('ahpra_registration_number', 'Not applicable')}",
        "",
        "Referral Reason:",
        *_wrap(sections.get("referral_reason")),
        "",
        "Background:",
        *_wrap(sections.get("background")),
        "",
        "Assessment Summary:",
        *_wrap(sections.get("assessment_summary")),
        "",
        "Goals:",
    ]
    for goal in goals[:8]:
        if isinstance(goal, dict):
            lines.append(f"- {goal.get('title') or goal.get('description') or goal.get('id')}")
        else:
            lines.append(f"- {goal}")
    lines.extend(["", "Interventions:"])
    lines.extend(_wrap(sections.get("interventions")))
    lines.extend(["", "Progress Summary:"])
    lines.extend(_wrap(f"{len(sessions)} session records reviewed."))
    lines.extend(["", "Recommendations:"])
    lines.extend(_wrap(sections.get("recommendations")))
    lines.extend(["", "Risk and Compliance Flags:"])
    if flags:
        for flag in flags[:8]:
            lines.append(f"- Session {flag.get('id', '')}: compliance score {flag.get('compliance_score', 'not scored')}")
    else:
        lines.append("- No active compliance flags in reviewed records.")
    lines.extend(["", "Clinician Signature:", clinician.get("full_name", "CareCliQ clinician")])
    text_ops = []
    y = 790
    for line in lines[:70]:
        text_ops.append(f"1 0 0 1 50 {y} Tm ({_pdf_escape(line[:110])}) Tj")
        y -= 12
        if y < 60:
            break
    stream = "BT /F1 9 Tf\n" + "\n".join(text_ops) + "\nET"
    pdf = (
        "%PDF-1.4\n"
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        f"4 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj\n"
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        "xref\n0 6\n0000000000 65535 f \ntrailer << /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF\n"
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
            "budget_warnings": [],
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
        "budget_warnings": collect_budget_rule_alerts_from_sessions(report),
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
    profile_result = (
        get_supabase_admin()
        .table("users")
        .select("full_name, discipline, ahpra_registration_number, business_name")
        .eq("id", get_user_id(current_user))
        .maybe_single()
        .execute()
    )
    clinician = profile_result.data if profile_result and profile_result.data else {}
    content = {
        "report_type": report_type,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "participant": participant,
        "goals": participant.get("goals") or [],
        "sessions": sessions[:50],
        "clinician": clinician,
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
        pdf_bytes = _report_pdf_bytes(title, content)
        supabase = get_supabase_admin()
        supabase.storage.from_("report-files").upload(
            file_path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        file_url = supabase.storage.from_("report-files").get_public_url(file_path)
    except Exception as exc:
        logger.warning("Report PDF storage unavailable: %s", exc)
        raise HTTPException(status_code=502, detail=f"Report PDF storage is not configured: {exc}")

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
