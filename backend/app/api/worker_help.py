"""Worker help & support API — CARECLIQV2-273."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ..core.access import get_user_id, is_support_worker
from ..core.security import get_current_user
from ..services import help_support_service

router = APIRouter(prefix="/worker/help", tags=["worker-help"])


class TutorialStepBody(BaseModel):
    step_key: str
    skipped: bool = False


def _require_worker(user: dict) -> None:
    if not is_support_worker(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support worker access required.")


@router.get("/config")
async def get_help_config(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return help_support_service.get_support_config()


@router.get("/faq")
async def list_faq(
    q: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return {"articles": help_support_service.list_faq_articles(q)}


@router.get("/known-issues")
async def list_known_issues(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return {"issues": help_support_service.list_known_issues()}


@router.get("/tutorial")
async def get_tutorial_progress(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return help_support_service.get_tutorial_progress(get_user_id(current_user))


@router.post("/tutorial/step")
async def complete_tutorial_step(
    body: TutorialStepBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return help_support_service.upsert_tutorial_step(
        get_user_id(current_user),
        body.step_key,
        skipped=body.skipped,
    )


@router.post("/tutorial/reset")
async def reset_tutorial(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return help_support_service.reset_tutorial_progress(get_user_id(current_user))
