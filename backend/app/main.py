from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .api import auth, participants, sessions, alerts, plans, reports, ai, compliance, budget_api
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _apply_startup_migrations():
    """Apply additive schema migrations on startup (idempotent ALTER TABLE … ADD COLUMN IF NOT EXISTS)."""
    try:
        from .services.supabase_client import get_supabase_admin
        supabase = get_supabase_admin()
        # Verify the structured note columns exist by attempting to select them.
        # Supabase/PostgREST does not support raw DDL via REST, so we detect missing
        # columns and log a clear message for the operator to run the SQL setup script.
        try:
            supabase.table("sessions").select(
                "activities_performed, outcomes, participant_response, progress_toward_goals"
            ).limit(1).execute()
            logger.info("Structured note columns verified in sessions table.")
        except Exception as col_err:
            err_str = str(col_err)
            if "does not exist" in err_str or "42703" in err_str:
                logger.warning(
                    "Structured note columns are missing from the sessions table. "
                    "Run the SQL in backend/supabase_setup.sql in your Supabase SQL editor to add them: "
                    "activities_performed, outcomes, participant_response, progress_toward_goals"
                )
            else:
                logger.warning(f"Could not verify structured note columns: {col_err}")
    except Exception as e:
        logger.warning(f"Startup migration check failed (non-critical): {e}")


@asynccontextmanager
async def lifespan(application: FastAPI):
    await _apply_startup_migrations()
    yield


app = FastAPI(
    title="AI Clinical Companion API",
    description="NDIS Provider Clinical Management System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(participants.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(compliance.router, prefix="/api")
app.include_router(budget_api.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "AI Clinical Companion API"}


@app.get("/")
async def root():
    return {"message": "AI Clinical Companion API", "docs": "/docs"}
