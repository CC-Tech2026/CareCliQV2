from fastapi import APIRouter, Depends
from ..core.security import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/practitioner")
async def get_practitioner_settings(current_user: dict = Depends(get_current_user)):
    """
    Returns practitioner settings for logged-in user.
    FIX: resolves frontend 404
    """

    return {
        "user_id": current_user.get("sub"),
        "role": current_user.get("role"),
        "account_type": current_user.get("account_type"),
        "notification_preferences": {
            "email": True,
            "push": True
        },
        "theme": "light"
    }