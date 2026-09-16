"""Branch (office) administration — managing director only.

Branches carry the timezone for their staff and participants
(198_branches.sql). Anyone in the org may list them (the UI needs the
names and zones to label times); only the MD can change them.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.access import get_user_organization_id, is_managing_director
from ..core.security import get_current_user
from ..core.timezone import AUSTRALIAN_STATE_TIMEZONES
from ..services import branch_service

router = APIRouter(prefix="/branches", tags=["branches"])


class BranchCreate(BaseModel):
    name: str
    state: str


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    state: Optional[str] = None


class BranchAssignment(BaseModel):
    branch_id: str


def _org_id(current_user: dict) -> str:
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id


def _require_md(current_user: dict) -> str:
    if not is_managing_director(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managing Director access required.")
    return _org_id(current_user)


@router.get("")
async def list_branches(current_user: dict = Depends(get_current_user)):
    return {
        "branches": branch_service.list_branches(_org_id(current_user)),
        "states": [{"code": code, "timezone": tz} for code, tz in AUSTRALIAN_STATE_TIMEZONES.items()],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_branch(body: BranchCreate, current_user: dict = Depends(get_current_user)):
    return branch_service.create_branch(_require_md(current_user), name=body.name, state=body.state)


@router.patch("/{branch_id}")
async def update_branch(branch_id: str, body: BranchUpdate, current_user: dict = Depends(get_current_user)):
    return branch_service.update_branch(_require_md(current_user), branch_id, name=body.name, state=body.state)


@router.delete("/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(branch_id: str, current_user: dict = Depends(get_current_user)):
    branch_service.delete_branch(_require_md(current_user), branch_id)
    return None


@router.put("/members/{user_id}")
async def assign_member(user_id: str, body: BranchAssignment, current_user: dict = Depends(get_current_user)):
    return branch_service.set_member_branch(_require_md(current_user), user_id, body.branch_id)


@router.put("/participants/{participant_id}")
async def assign_participant(participant_id: str, body: BranchAssignment, current_user: dict = Depends(get_current_user)):
    return branch_service.set_participant_branch(_require_md(current_user), participant_id, body.branch_id)
