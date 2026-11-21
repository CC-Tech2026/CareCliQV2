"""Settings > Privacy: switching voice recording and transcription on or off
for the organisation (services/voice_access.py). Coordinators and directors
can see where it stands; only the managing director changes it, after
agreeing that audio is sent overseas to be transcribed."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access, is_managing_director
from ..core.security import get_current_user
from ..services import audit_service, voice_access

router = APIRouter(prefix="/organization/voice-transcription", tags=["voice-settings"])


class VoiceSettingBody(BaseModel):
    enabled: bool
    agreed: bool = False


def _org(user: dict) -> str:
    if not has_org_wide_access(user):
        raise HTTPException(status_code=403, detail="Coordinator or managing director access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organisation membership required.")
    return str(org_id)


@router.get("")
async def voice_setting(current_user: dict = Depends(get_current_user)):
    status = voice_access.opt_in_status(_org(current_user))
    return {**status, "can_change": is_managing_director(current_user)}


@router.put("")
async def change_voice_setting(body: VoiceSettingBody, current_user: dict = Depends(get_current_user)):
    org_id = _org(current_user)
    if not is_managing_director(current_user):
        raise HTTPException(status_code=403, detail="Only the managing director can switch voice recording on or off.")
    status = voice_access.set_opt_in(org_id, str(get_user_id(current_user)), body.enabled, body.agreed)
    try:
        await audit_service.log_action(
            action_type="organization.voice_transcription_" + ("enabled" if body.enabled else "disabled"),
            entity_type="organization", entity_id=org_id, user_id=str(get_user_id(current_user)),
            organization_id=org_id,
            details={"terms_version": voice_access.TERMS_VERSION if body.enabled else None},
        )
    except Exception:
        pass
    return {**status, "can_change": True}
