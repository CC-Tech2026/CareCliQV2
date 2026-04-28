from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from ..services.supabase_client import get_supabase
from ..core.security import create_access_token
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str


@router.post("/login")
async def login(body: LoginRequest):
    supabase = get_supabase()
    try:
        result = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password
        })
        user = result.user
        session = result.session
        if not user or not session:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        token = create_access_token({"sub": user.id, "email": user.email})
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.user_metadata.get("full_name", "")
            }
        }
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid email or password")


@router.post("/register")
async def register(body: RegisterRequest):
    supabase = get_supabase()
    try:
        result = supabase.auth.sign_up({
            "email": body.email,
            "password": body.password,
            "options": {
                "data": {"full_name": body.full_name}
            }
        })
        user = result.user
        if not user:
            raise HTTPException(status_code=400, detail="Registration failed")
        return {"message": "Registration successful. Please check your email to verify.", "user_id": user.id}
    except Exception as e:
        logger.error(f"Register error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/logout")
async def logout():
    return {"message": "Logged out successfully"}
