from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .api import auth, participants, sessions, alerts, plans, reports, ai, compliance, budget_api
from .services import migration_state
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


_MIGRATION_BANNER = """
╔══════════════════════════════════════════════════════════════════════════╗
║  DATABASE MIGRATION REQUIRED — biological_sex column missing             ║
║                                                                          ║
║  Run this SQL in your Supabase SQL editor:                               ║
║  https://supabase.com/dashboard/project/_/sql/new                        ║
║                                                                          ║
║  ALTER TABLE patients                                                    ║
║    ADD COLUMN IF NOT EXISTS biological_sex TEXT DEFAULT 'unspecified';   ║
║                                                                          ║
║  Biological sex selection on participant forms will be silently skipped  ║
║  until the column exists.                                                ║
╚══════════════════════════════════════════════════════════════════════════╝
"""


async def _apply_startup_migrations():
    """Verify schema columns on startup and log actionable warnings when missing.

    Supabase/PostgREST does not support raw DDL via its REST API, so this
    function detects missing columns and prints clear instructions rather than
    attempting to alter the table automatically.
    """
    try:
        from .services.supabase_client import get_supabase_admin
        supabase = get_supabase_admin()

        # --- sessions structured note columns ---
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
                    "Run backend/supabase_setup.sql in your Supabase SQL editor."
                )
            else:
                logger.warning(f"Could not verify structured note columns: {col_err}")

        # --- patients.biological_sex column ---
        try:
            supabase.table("patients").select("biological_sex").limit(1).execute()
            logger.info("patients.biological_sex column verified.")
            migration_state.biological_sex_column_missing = False
        except Exception as bio_err:
            err_str = str(bio_err)
            if "does not exist" in err_str or "42703" in err_str:
                migration_state.biological_sex_column_missing = True
                logger.warning(_MIGRATION_BANNER)
            else:
                logger.warning(f"Could not verify biological_sex column: {bio_err}")

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


@app.get("/api/admin/migration-status")
async def migration_status_endpoint():
    """Return current migration status so operators can check schema readiness."""
    missing = migration_state.biological_sex_column_missing
    return {
        "biological_sex_column_missing": missing,
        "migration_sql": (
            "ALTER TABLE patients ADD COLUMN IF NOT EXISTS biological_sex TEXT DEFAULT 'unspecified';"
            if missing else None
        ),
        "supabase_sql_editor": "https://supabase.com/dashboard/project/_/sql/new",
    }


@app.get("/")
async def root():
    return {"message": "AI Clinical Companion API", "docs": "/docs"}
