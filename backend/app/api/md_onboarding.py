from __future__ import annotations

from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from ..core.access import (
    get_user_id,
    get_user_organization_id,
    is_managing_director,
)
from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/md/onboarding", tags=["md-onboarding"])


def _require_md(current_user: dict) -> None:
    if not is_managing_director(current_user):
        raise HTTPException(status_code=403, detail="Managing Director access required.")


def _require_org(current_user: dict) -> str:
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=400, detail="User has no organisation.")
    return org_id


# ── Overview ─────────────────────────────────────────────────────────────────

@router.get("/overview")
async def get_overview(current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()

    try:
        assignments_res = (
            supabase.table("onboarding_assignments")
            .select("id, user_id, status, assigned_at, program_id")
            .eq("org_id", org_id)
            .execute()
        )
        assignments = assignments_res.data or []

        total = len(assignments)
        in_progress = sum(1 for a in assignments if a.get("status") == "active")
        completed = sum(1 for a in assignments if a.get("status") == "completed")
        overdue = sum(1 for a in assignments if a.get("status") == "overdue")

        progress_res = (
            supabase.table("onboarding_stage_progress")
            .select("id, assignment_id, stage_id, status")
            .eq("org_id", org_id)
            .eq("status", "submitted")
            .execute()
        )
        awaiting = len(set(p.get("assignment_id") for p in (progress_res.data or [])))

        user_ids = list({a["user_id"] for a in assignments if a.get("user_id")})
        users_map: dict[str, dict] = {}
        if user_ids:
            users_res = (
                supabase.table("users")
                .select("id, full_name, role")
                .in_("id", user_ids)
                .execute()
            )
            for u in (users_res.data or []):
                users_map[u["id"]] = u

        program_ids = list({a["program_id"] for a in assignments if a.get("program_id")})
        programs_map: dict[str, dict] = {}
        if program_ids:
            prog_res = (
                supabase.table("onboarding_programs")
                .select("id, name")
                .in_("id", program_ids)
                .execute()
            )
            for p in (prog_res.data or []):
                programs_map[p["id"]] = p

        all_progress = (
            supabase.table("onboarding_stage_progress")
            .select("assignment_id, stage_id, status")
            .eq("org_id", org_id)
            .execute()
        ).data or []

        progress_by_assignment: dict[str, dict] = {}
        for p in all_progress:
            aid = p.get("assignment_id")
            if not aid:
                continue
            if aid not in progress_by_assignment:
                progress_by_assignment[aid] = {"total": 0, "done": 0, "in_progress_stage": None}
            progress_by_assignment[aid]["total"] += 1
            if p.get("status") in ("approved", "completed"):
                progress_by_assignment[aid]["done"] += 1
            elif p.get("status") == "in_progress" and not progress_by_assignment[aid]["in_progress_stage"]:
                progress_by_assignment[aid]["in_progress_stage"] = p.get("stage_id")

        # Collect all stage IDs needed for current-stage lookup
        all_stage_ids: set[str] = set()
        for pdata in progress_by_assignment.values():
            sid = pdata.get("in_progress_stage")
            if sid:
                all_stage_ids.add(sid)
        # Also collect first-stage per program for starters with no progress yet
        stage_first_by_program: dict[str, str] = {}
        if program_ids:
            first_stages_res = (
                supabase.table("onboarding_stages")
                .select("id, program_id, title")
                .in_("program_id", program_ids)
                .order("stage_order")
                .execute()
            )
            for s in (first_stages_res.data or []):
                pid = s["program_id"]
                if pid not in stage_first_by_program:
                    stage_first_by_program[pid] = s["title"]
                if s.get("id"):
                    all_stage_ids.add(s["id"])

        stage_titles: dict[str, str] = {}
        if all_stage_ids:
            st_res = supabase.table("onboarding_stages").select("id, title").in_("id", list(all_stage_ids)).execute()
            for s in (st_res.data or []):
                stage_titles[s["id"]] = s["title"]

        new_starters = []
        for a in assignments:
            uid = a.get("user_id", "")
            user_info = users_map.get(uid, {})
            prog_info = programs_map.get(a.get("program_id", ""), {})
            pdata = progress_by_assignment.get(a["id"], {"total": 0, "done": 0, "in_progress_stage": None})
            pct = round((pdata["done"] / pdata["total"]) * 100) if pdata["total"] else 0
            in_prog_sid = pdata.get("in_progress_stage")
            current_stage = (
                stage_titles.get(in_prog_sid, "In Progress") if in_prog_sid
                else stage_first_by_program.get(a.get("program_id", ""), "Not Started")
            )
            new_starters.append({
                "assignment_id": a["id"],
                "user_id": uid,
                "name": user_info.get("full_name", "Unknown"),
                "role": user_info.get("role", ""),
                "program_name": prog_info.get("name", ""),
                "current_stage": current_stage,
                "completion_pct": pct,
                "status": a.get("status", "active"),
                "assigned_at": a.get("assigned_at"),
            })

        return {
            "new_starters": total,
            "in_progress": in_progress,
            "completed": completed,
            "overdue": overdue,
            "awaiting_approval": awaiting,
            "new_starter_table": new_starters,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Programs ─────────────────────────────────────────────────────────────────

class ProgramCreate(BaseModel):
    name: str
    description: Optional[str] = None


@router.get("/programs")
async def list_programs(current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    res = get_supabase_admin().table("onboarding_programs").select("*").eq("org_id", org_id).order("created_at").execute()
    return res.data or []


@router.post("/programs")
async def create_program(body: ProgramCreate, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    res = get_supabase_admin().table("onboarding_programs").insert({
        "org_id": org_id,
        "name": body.name,
        "description": body.description,
        "created_by": get_user_id(current_user),
    }).execute()
    return res.data[0] if res.data else {}


# ── Stages ────────────────────────────────────────────────────────────────────

class StageCreate(BaseModel):
    title: str
    instructions: Optional[str] = None
    stage_order: int = 0
    completion_requirements: Optional[dict] = None


class StageUpdate(BaseModel):
    title: Optional[str] = None
    instructions: Optional[str] = None
    stage_order: Optional[int] = None
    completion_requirements: Optional[dict] = None


class StageReorderItem(BaseModel):
    stage_id: str
    new_order: int


@router.get("/programs/{program_id}/stages")
async def list_stages(program_id: str, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    res = (
        get_supabase_admin()
        .table("onboarding_stages")
        .select("*")
        .eq("program_id", program_id)
        .eq("org_id", org_id)
        .order("stage_order")
        .execute()
    )
    return res.data or []


@router.post("/programs/{program_id}/stages")
async def create_stage(program_id: str, body: StageCreate, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    res = get_supabase_admin().table("onboarding_stages").insert({
        "program_id": program_id,
        "org_id": org_id,
        "title": body.title,
        "instructions": body.instructions,
        "stage_order": body.stage_order,
        "completion_requirements": body.completion_requirements or {},
    }).execute()
    return res.data[0] if res.data else {}


@router.patch("/programs/{program_id}/stages/{stage_id}")
async def update_stage(program_id: str, stage_id: str, body: StageUpdate, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update.")
    res = (
        get_supabase_admin()
        .table("onboarding_stages")
        .update(payload)
        .eq("id", stage_id)
        .eq("program_id", program_id)
        .eq("org_id", org_id)
        .execute()
    )
    return res.data[0] if res.data else {}


@router.delete("/programs/{program_id}/stages/{stage_id}")
async def delete_stage(program_id: str, stage_id: str, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    get_supabase_admin().table("onboarding_stages").delete().eq("id", stage_id).eq("org_id", org_id).execute()
    return {"deleted": stage_id}


@router.post("/programs/{program_id}/stages/reorder")
async def reorder_stages(program_id: str, body: List[StageReorderItem], current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    for item in body:
        supabase.table("onboarding_stages").update({"stage_order": item.new_order}).eq("id", item.stage_id).eq("org_id", org_id).execute()
    return {"reordered": len(body)}


# ── Resources ─────────────────────────────────────────────────────────────────

@router.get("/resources")
async def list_resources(category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    q = get_supabase_admin().table("onboarding_stage_resources").select("*").eq("org_id", org_id)
    if category:
        q = q.eq("category", category)
    res = q.order("created_at", desc=True).execute()
    return res.data or []


class ResourceAttach(BaseModel):
    stage_id: str


@router.post("/resources/{resource_id}/attach")
async def attach_resource_to_stage(resource_id: str, body: ResourceAttach, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    res = (
        supabase.table("onboarding_stage_resources")
        .update({"stage_id": body.stage_id})
        .eq("id", resource_id)
        .eq("org_id", org_id)
        .execute()
    )
    return res.data[0] if res.data else {"resource_id": resource_id, "stage_id": body.stage_id}


@router.post("/resources/upload")
async def upload_resource(
    file: UploadFile = File(...),
    name: str = Form(...),
    category: str = Form("General"),
    stage_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    _require_md(current_user)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()

    content = await file.read()
    file_size = len(content)
    content_type = file.content_type or "application/octet-stream"

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext in ("mp4", "mov", "avi", "webm"):
        resource_type = "video"
    elif ext == "pdf":
        resource_type = "pdf"
    elif ext in ("doc", "docx", "txt", "xlsx", "xls"):
        resource_type = "document"
    else:
        resource_type = "document"

    import uuid as uuid_module
    safe_filename = (file.filename or "file").replace(" ", "_")
    file_key = f"{org_id}/{uuid_module.uuid4()}/{safe_filename}"

    # Storage upload — fail fast if the upload itself fails so no orphaned DB row is created
    try:
        supabase.storage.from_("onboarding-resources").upload(
            path=file_key,
            file=content,
            file_options={"content-type": content_type},
        )
    except Exception as upload_err:
        raise HTTPException(status_code=502, detail=f"Storage upload failed: {upload_err}")

    row = {
        "org_id": org_id,
        "name": name,
        "resource_type": resource_type,
        "file_key": file_key,          # stored key used to generate signed URLs on download
        "file_size_bytes": file_size,
        "category": category,
    }
    if stage_id:
        row["stage_id"] = stage_id

    res = supabase.table("onboarding_stage_resources").insert(row).execute()
    return res.data[0] if res.data else {"file_key": file_key}


@router.get("/resources/{resource_id}/download")
async def download_resource(resource_id: str, current_user: dict = Depends(get_current_user)):
    """Return a short-lived signed URL for the private onboarding-resources bucket."""
    _require_md(current_user)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    row_res = (
        supabase.table("onboarding_stage_resources")
        .select("id, file_key, org_id")
        .eq("id", resource_id)
        .eq("org_id", org_id)
        .limit(1)
        .execute()
    )
    if not row_res.data:
        raise HTTPException(status_code=404, detail="Resource not found")
    file_key = row_res.data[0].get("file_key")
    if not file_key:
        raise HTTPException(status_code=422, detail="Resource has no stored file key")
    try:
        signed = supabase.storage.from_("onboarding-resources").create_signed_url(
            path=file_key,
            expires_in=300,  # 5-minute window
        )
        signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url") or ""
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not generate signed URL: {e}")
    if not signed_url:
        raise HTTPException(status_code=502, detail="Signed URL generation returned empty result")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=signed_url, status_code=302)


# ── Assignments ───────────────────────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    program_id: str
    user_id: str


@router.get("/assignments")
async def list_assignments(current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()
    assignments = (
        supabase.table("onboarding_assignments")
        .select("*")
        .eq("org_id", org_id)
        .order("assigned_at", desc=True)
        .execute()
    ).data or []

    if not assignments:
        return []

    assignment_ids = [a["id"] for a in assignments]
    all_progress = (
        supabase.table("onboarding_stage_progress")
        .select("assignment_id, status")
        .in_("assignment_id", assignment_ids)
        .execute()
    ).data or []

    progress_map: dict[str, dict] = {}
    for p in all_progress:
        aid = p.get("assignment_id")
        if not aid:
            continue
        if aid not in progress_map:
            progress_map[aid] = {"total": 0, "done": 0}
        progress_map[aid]["total"] += 1
        if p.get("status") in ("approved", "completed"):
            progress_map[aid]["done"] += 1

    result = []
    for a in assignments:
        pdata = progress_map.get(a["id"], {"total": 0, "done": 0})
        pct = round((pdata["done"] / pdata["total"]) * 100) if pdata["total"] else 0
        result.append({**a, "completion_pct": pct, "stages_total": pdata["total"], "stages_done": pdata["done"]})
    return result


@router.post("/assignments")
async def create_assignment(body: AssignmentCreate, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    res = get_supabase_admin().table("onboarding_assignments").insert({
        "program_id": body.program_id,
        "user_id": body.user_id,
        "org_id": org_id,
        "assigned_by": get_user_id(current_user),
        "status": "active",
    }).execute()
    return res.data[0] if res.data else {}


# ── Approvals ─────────────────────────────────────────────────────────────────

@router.get("/approvals")
async def list_approvals(current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    supabase = get_supabase_admin()

    progress_res = (
        supabase.table("onboarding_stage_progress")
        .select("*")
        .eq("org_id", org_id)
        .eq("status", "submitted")
        .order("submitted_at", desc=True)
        .execute()
    )
    items = progress_res.data or []

    assignment_ids = list({i["assignment_id"] for i in items if i.get("assignment_id")})
    stage_ids = list({i["stage_id"] for i in items if i.get("stage_id")})

    assignments_map: dict[str, dict] = {}
    if assignment_ids:
        asgn = supabase.table("onboarding_assignments").select("id, user_id").in_("id", assignment_ids).execute()
        for a in (asgn.data or []):
            assignments_map[a["id"]] = a

    user_ids = list({a["user_id"] for a in assignments_map.values() if a.get("user_id")})
    users_map: dict[str, dict] = {}
    if user_ids:
        u_res = supabase.table("users").select("id, full_name").in_("id", user_ids).execute()
        for u in (u_res.data or []):
            users_map[u["id"]] = u

    stages_map: dict[str, dict] = {}
    if stage_ids:
        s_res = supabase.table("onboarding_stages").select("id, title").in_("id", stage_ids).execute()
        for s in (s_res.data or []):
            stages_map[s["id"]] = s

    # Compute completion % per assignment
    if assignment_ids:
        all_progress_for_pct = (
            supabase.table("onboarding_stage_progress")
            .select("assignment_id, status")
            .in_("assignment_id", assignment_ids)
            .execute()
        ).data or []
        pct_map: dict[str, dict] = {}
        for p in all_progress_for_pct:
            aid = p.get("assignment_id")
            if not aid:
                continue
            if aid not in pct_map:
                pct_map[aid] = {"total": 0, "done": 0}
            pct_map[aid]["total"] += 1
            if p.get("status") in ("approved", "completed"):
                pct_map[aid]["done"] += 1
    else:
        pct_map = {}

    # Count resources per stage
    resource_counts: dict[str, int] = {}
    if stage_ids:
        res_count_res = (
            supabase.table("onboarding_stage_resources")
            .select("stage_id")
            .in_("stage_id", stage_ids)
            .execute()
        ).data or []
        for r in res_count_res:
            sid = r.get("stage_id")
            if sid:
                resource_counts[sid] = resource_counts.get(sid, 0) + 1

    result = []
    for item in items:
        asgn = assignments_map.get(item.get("assignment_id", ""), {})
        user = users_map.get(asgn.get("user_id", ""), {})
        stage = stages_map.get(item.get("stage_id", ""), {})
        aid = item.get("assignment_id", "")
        pdata = pct_map.get(aid, {"total": 0, "done": 0})
        pct = round((pdata["done"] / pdata["total"]) * 100) if pdata["total"] else 0
        result.append({
            "progress_id": item["id"],
            "assignment_id": aid,
            "stage_id": item.get("stage_id"),
            "staff_name": user.get("full_name", "Unknown"),
            "stage_name": stage.get("title", "Unknown Stage"),
            "submitted_at": item.get("submitted_at"),
            "notes": item.get("notes"),
            "status": item.get("status"),
            "completion_pct": pct,
            "resource_count": resource_counts.get(item.get("stage_id", ""), 0),
        })
    return result


class ApprovalAction(BaseModel):
    notes: Optional[str] = None


@router.post("/approvals/{progress_id}/approve")
async def approve_stage(progress_id: str, body: ApprovalAction = ApprovalAction(), current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    from datetime import datetime, timezone
    res = (
        get_supabase_admin()
        .table("onboarding_stage_progress")
        .update({
            "status": "approved",
            "approved_by": get_user_id(current_user),
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "notes": body.notes,
        })
        .eq("id", progress_id)
        .eq("org_id", org_id)
        .execute()
    )
    return res.data[0] if res.data else {"status": "approved"}


@router.post("/approvals/{progress_id}/request-changes")
async def request_changes(progress_id: str, body: ApprovalAction, current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    org_id = _require_org(current_user)
    if not body.notes or not body.notes.strip():
        raise HTTPException(status_code=422, detail="Notes are required when requesting changes.")
    res = (
        get_supabase_admin()
        .table("onboarding_stage_progress")
        .update({"status": "changes_requested", "notes": body.notes})
        .eq("id", progress_id)
        .eq("org_id", org_id)
        .execute()
    )
    return res.data[0] if res.data else {"status": "changes_requested"}
