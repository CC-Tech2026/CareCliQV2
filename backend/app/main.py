from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .api import auth, participants, sessions, alerts, plans, reports, ai, compliance, budget_api, incidents, assignments, billing, dashboards, worker, coordinator, security, users, onboarding, credentials, toolkit
from .core.security import get_current_user
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


def _sync_check_column(supabase, table: str, columns: str) -> bool:
    """Probe a table select synchronously. Returns True if columns exist."""
    try:
        supabase.table(table).select(columns).limit(1).execute()
        return True
    except Exception as e:
        err = str(e)
        if "does not exist" in err or "42703" in err or "PGRST" in err:
            return False
        return True  # assume OK on unknown errors


async def _apply_startup_migrations():
    """Verify schema on startup in parallel, set migration_state flags."""
    import asyncio
    try:
        from .services.supabase_client import get_supabase_admin
        supabase = get_supabase_admin()

        # Define all probes as (flag_name, table, columns, ok_msg, warn_msg)
        _PROBES = [
            ("sessions_notes",       "sessions",                "activities_performed, outcomes, participant_response, progress_toward_goals", "sessions: structured note columns OK",  "sessions: structured note columns missing"),
            ("sessions_rp",          "sessions",                "restrictive_practice_detected, compliance_flags",                             None,                                    None),
            ("biological_sex",       "patients",                "biological_sex",                                                              "patients.biological_sex column OK",     _BIOLOGICAL_SEX_BANNER),
            ("users_onboarding",     "users",                   "account_type, onboarding_complete, organization_id",                          "users: onboarding columns OK",          _USERS_COLUMNS_BANNER),
            ("session_messages",     "session_messages",        "id, session_id, message_type, content",                                       "session_messages table OK",             _SESSION_MESSAGES_BANNER),
            ("organizations",        "organizations",           "id, owner_user_id, organization_name",                                        "organizations table OK",                "organizations table missing — run backend/supabase_patch_missing_tables.sql"),
            ("org_members",          "organization_members",    "id, user_id, organization_id, role",                                          "organization_members table OK",         "organization_members table missing — run backend/supabase_patch_missing_tables.sql"),
            ("invitations",          "invitations",             "id, organization_id, email, token, expires_at",                               "invitations table OK",                  "invitations table missing — run backend/supabase_patch_missing_tables.sql"),
            ("patient_goals",        "patient_goals",           "id, plan_id, description",                                                    "patient_goals table OK",                "patient_goals table missing — run backend/supabase_setup.sql"),
            ("practitioner_allocs",  "practitioner_allocations","id, patient_id, user_id, allocated_role",                                     "practitioner_allocations table OK",     "practitioner_allocations table missing — run backend/supabase_setup.sql"),
        ]

        # Fire all probes in parallel via thread pool (supabase client is sync)
        results = await asyncio.gather(
            *[
                asyncio.to_thread(_sync_check_column, supabase, table, columns)
                for _, table, columns, _, _ in _PROBES
            ],
            return_exceptions=True,
        )

        for (key, _, _, ok_msg, warn_msg), result in zip(_PROBES, results):
            ok = result if isinstance(result, bool) else True

            if ok_msg:
                if ok:
                    logger.info(ok_msg)
                elif warn_msg:
                    logger.warning(warn_msg)

            # Update migration_state flags
            if key == "biological_sex":
                migration_state.biological_sex_column_missing = not ok
            elif key == "users_onboarding":
                migration_state.users_onboarding_columns_missing = not ok
            elif key == "session_messages":
                migration_state.session_messages_table_missing = not ok
            elif key == "organizations":
                migration_state.organizations_table_missing = not ok
            elif key == "org_members":
                migration_state.organization_members_table_missing = not ok
            elif key == "invitations":
                migration_state.invitations_table_missing = not ok
            elif key == "patient_goals":
                migration_state.patient_goals_table_missing = not ok
            elif key == "practitioner_allocs":
                migration_state.practitioner_allocations_table_missing = not ok

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
app.include_router(billing.router, prefix="/api")
app.include_router(dashboards.router, prefix="/api")
app.include_router(worker.router, prefix="/api")
app.include_router(coordinator.router, prefix="/api")
app.include_router(security.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(onboarding.router, prefix="/api")
app.include_router(credentials.router, prefix="/api")
app.include_router(toolkit.router, prefix="/api")
from .api import invitations as invitations_api
app.include_router(invitations_api.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "AI Clinical Companion API"}


@app.get("/api/system/migration-status")
async def migration_status_endpoint(current_user: dict = Depends(get_current_user)):
    """Return current migration state so operators can verify schema readiness."""
    if current_user.get("role") != "support_coordinator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can view migration status",
        )
    return {
        "biological_sex_column_missing":              migration_state.biological_sex_column_missing,
        "users_onboarding_columns_missing":           migration_state.users_onboarding_columns_missing,
        "organizations_table_missing":                migration_state.organizations_table_missing,
        "organization_members_table_missing":         migration_state.organization_members_table_missing,
        "invitations_table_missing":                  migration_state.invitations_table_missing,
        "session_messages_table_missing":             migration_state.session_messages_table_missing,
        "patient_goals_table_missing":                migration_state.patient_goals_table_missing,
        "practitioner_allocations_table_missing":     migration_state.practitioner_allocations_table_missing,
        "migration_sql_file":                         "backend/supabase_setup.sql",
        "patch_sql_file":                             "backend/supabase_patch_missing_tables.sql",
        "supabase_sql_editor":                        _MIGRATION_URL,
        "all_ok": not any([
            migration_state.biological_sex_column_missing,
            migration_state.users_onboarding_columns_missing,
            migration_state.organizations_table_missing,
            migration_state.organization_members_table_missing,
            migration_state.invitations_table_missing,
            migration_state.session_messages_table_missing,
            migration_state.patient_goals_table_missing,
            migration_state.practitioner_allocations_table_missing,
        ]),
    }


@app.get("/")
async def root():
    return {"message": "AI Clinical Companion API", "docs": "/docs"}
