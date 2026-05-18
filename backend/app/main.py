from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .api import auth, participants, sessions, alerts, plans, reports, ai, compliance, budget_api, incidents, assignments
from .services import migration_state
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_MIGRATION_URL = "https://supabase.com/dashboard/project/_/sql/new"

_USERS_COLUMNS_BANNER = """
╔═══════════════════════════════════════════════════════════════════════════╗
║  MIGRATION REQUIRED — onboarding columns missing from public.users        ║
║                                                                           ║
║  Run the complete backend/supabase_setup.sql in your Supabase SQL editor  ║
║  to add: account_type, onboarding_data, onboarding_complete,             ║
║           organization_id, and the organizations table.                   ║
║                                                                           ║
║  Auth registration and onboarding will still work but account_type       ║
║  and onboarding_complete will not be persisted until columns exist.       ║
╚═══════════════════════════════════════════════════════════════════════════╝
"""

_BIOLOGICAL_SEX_BANNER = """
╔══════════════════════════════════════════════════════════════════════════╗
║  MIGRATION REQUIRED — patients.biological_sex column missing             ║
║  Run backend/supabase_setup.sql in your Supabase SQL editor.            ║
╚══════════════════════════════════════════════════════════════════════════╝
"""

_SESSION_MESSAGES_BANNER = """
╔══════════════════════════════════════════════════════════════════════════╗
║  MIGRATION REQUIRED — session_messages table missing                     ║
║  Run backend/supabase_setup.sql in your Supabase SQL editor.            ║
║  Chat-style session messages will not be persisted until created.        ║
╚══════════════════════════════════════════════════════════════════════════╝
"""


async def _check_column(supabase, table: str, columns: str, label: str) -> bool:
    """Probe a table select.  Returns True if columns exist, False otherwise."""
    try:
        supabase.table(table).select(columns).limit(1).execute()
        return True
    except Exception as e:
        err = str(e)
        if "does not exist" in err or "42703" in err or "PGRST" in err:
            return False
        logger.warning(f"Could not verify {label}: {e}")
        return True   # assume OK on unknown errors


async def _apply_startup_migrations():
    """Verify schema on startup, set migration_state flags, print banners for missing pieces."""
    try:
        from .services.supabase_client import get_supabase_admin
        supabase = get_supabase_admin()

        # --- sessions structured note columns ---
        ok = await _check_column(
            supabase, "sessions",
            "activities_performed, outcomes, participant_response, progress_toward_goals",
            "sessions structured note columns",
        )
        if ok:
            logger.info("sessions: structured note columns OK")
        else:
            logger.warning(
                "sessions: structured note columns missing — "
                "run backend/supabase_setup.sql to add them."
            )

        # --- sessions RP + compliance columns ---
        await _check_column(
            supabase, "sessions",
            "restrictive_practice_detected, compliance_flags",
            "sessions compliance columns",
        )

        # --- patients.biological_sex ---
        ok = await _check_column(supabase, "patients", "biological_sex", "patients.biological_sex")
        if ok:
            logger.info("patients.biological_sex column OK")
            migration_state.biological_sex_column_missing = False
        else:
            migration_state.biological_sex_column_missing = True
            logger.warning(_BIOLOGICAL_SEX_BANNER)

        # --- users onboarding columns ---
        ok = await _check_column(
            supabase, "users",
            "account_type, onboarding_complete, organization_id",
            "users onboarding columns",
        )
        if ok:
            logger.info("users: onboarding columns OK")
            migration_state.users_onboarding_columns_missing = False
        else:
            migration_state.users_onboarding_columns_missing = True
            logger.warning(_USERS_COLUMNS_BANNER)

        # --- session_messages table ---
        ok = await _check_column(
            supabase, "session_messages",
            "id, session_id, message_type, content",
            "session_messages table",
        )
        if ok:
            logger.info("session_messages table OK")
            migration_state.session_messages_table_missing = False
        else:
            migration_state.session_messages_table_missing = True
            logger.warning(_SESSION_MESSAGES_BANNER)

        # --- organizations table ---
        ok = await _check_column(
            supabase, "organizations",
            "id, owner_user_id, organization_name",
            "organizations table",
        )
        if ok:
            logger.info("organizations table OK")
            migration_state.organizations_table_missing = False
        else:
            migration_state.organizations_table_missing = True
            logger.warning("organizations table missing — run backend/supabase_setup.sql")

        # --- patient_goals table ---
        ok = await _check_column(supabase, "patient_goals", "id, plan_id, description", "patient_goals table")
        if ok:
            logger.info("patient_goals table OK")
            migration_state.patient_goals_table_missing = False
        else:
            migration_state.patient_goals_table_missing = True
            logger.warning("patient_goals table missing — run backend/supabase_setup.sql")

        # --- practitioner_allocations table ---
        ok = await _check_column(
            supabase, "practitioner_allocations",
            "id, patient_id, user_id, allocated_role",
            "practitioner_allocations table",
        )
        if ok:
            logger.info("practitioner_allocations table OK")
            migration_state.practitioner_allocations_table_missing = False
        else:
            migration_state.practitioner_allocations_table_missing = True
            logger.warning("practitioner_allocations table missing — run backend/supabase_setup.sql")

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
app.include_router(incidents.router, prefix="/api")
app.include_router(assignments.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "AI Clinical Companion API"}


@app.get("/api/admin/migration-status")
async def migration_status_endpoint():
    """Return current migration state so operators can verify schema readiness."""
    return {
        "biological_sex_column_missing":     migration_state.biological_sex_column_missing,
        "users_onboarding_columns_missing":  migration_state.users_onboarding_columns_missing,
        "organizations_table_missing":       migration_state.organizations_table_missing,
        "session_messages_table_missing":    migration_state.session_messages_table_missing,
        "migration_sql_file":                "backend/supabase_setup.sql",
        "supabase_sql_editor":               _MIGRATION_URL,
        "patient_goals_table_missing":                migration_state.patient_goals_table_missing,
        "practitioner_allocations_table_missing":    migration_state.practitioner_allocations_table_missing,
        "all_ok": not any([
            migration_state.biological_sex_column_missing,
            migration_state.users_onboarding_columns_missing,
            migration_state.organizations_table_missing,
            migration_state.session_messages_table_missing,
            migration_state.patient_goals_table_missing,
            migration_state.practitioner_allocations_table_missing,
        ]),
    }


@app.get("/")
async def root():
    return {"message": "AI Clinical Companion API", "docs": "/docs"}
