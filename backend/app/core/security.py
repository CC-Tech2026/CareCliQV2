from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer_scheme = HTTPBearer(auto_error=False)

ROLE_ALIASES = {
    "admin": "support_coordinator",
    "allied_health": "allied_health_pro",
}


def normalize_role(role: Optional[str]) -> str:
    if not role:
        return "support_worker"
    return ROLE_ALIASES.get(role, role)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> dict:
    """FastAPI dependency — decodes JWT from Authorization header.

    Raises HTTP 401 when the token is missing or invalid.
    Returns the decoded payload dict (includes sub, email, role).
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Optional[dict]:
    """Like get_current_user but returns None instead of raising 401.

    Use on routes that should work unauthenticated but scope data by org when
    a valid token is present.
    """
    if not credentials:
        return None
    return decode_access_token(credentials.credentials)


def require_role(allowed_roles: list[str]):
    """FastAPI dependency factory — validates JWT and enforces role membership.

    Usage:
        @router.get("/protected")
        async def endpoint(user=Depends(require_role(["admin", "support_worker"]))):
            ...
    """
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        role = user.get("role", "support_worker")
        if role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied — required role(s): {', '.join(allowed_roles)}",
            )
        return user
    return dependency
