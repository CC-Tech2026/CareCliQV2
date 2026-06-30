import os
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .api import auth, participants, sessions, alerts, plans, reports, ai, compliance, budget_api, incidents, assignments, billing, dashboards, worker, coordinator, security, users, onboarding, credentials, toolkit, settings, hub, md_onboarding, ndis_pricing, notifications, budget_ledger, privacy, worker_help, worker_scheduling, worker_performance, worker_travel, calendar_feed, tasks, ai_suggestions
from .core.security import get_current_user
from .middleware.org_context import OrgContextMiddleware
from .services import migration_state
from .services.email_queue import start_email_queue, stop_email_queue
from .services.notification_scheduler import start_notification_scheduler, stop_notification_scheduler
from .jobs import start_scheduler, stop_scheduler
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


async def _validate_supabase_region_startup():
    """Block startup when hosted Supabase is not in ap-southeast-2 (Sydney)."""
    import asyncio
    from .core.config import settings
    from .core.supabase_region import SupabaseRegionError, validate_supabase_region

    try:
        await asyncio.to_thread(
            validate_supabase_region,
            supabase_url=settings.supabase_url,
            declared_region=settings.supabase_region or None,
            access_token=settings.supabase_access_token or None,
            region_check_mode=settings.supabase_region_check,
        )
    except SupabaseRegionError as exc:
        logger.critical("%s", exc)
        raise RuntimeError(str(exc)) from exc


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
            ("upcoming_review_date", "patients",                "upcoming_review_date",                                                        "patients.upcoming_review_date column OK", "patients.upcoming_review_date missing — run backend/supabase_setup.sql"),
            ("progress_delta",     "sessions",                "progress_delta",                                                              "sessions.progress_delta column OK",     "sessions.progress_delta missing — run backend/supabase/migrations/028_progress_delta.sql"),
            ("shifts",             "shifts",                  "id, organization_id, worker_id, scheduled_start, duration_minutes, status", "shifts table OK",                       "shifts table missing — run backend/supabase/migrations/029_shifts.sql"),
            ("sessions_shift_id",  "sessions",                "shift_id",                                                                    "sessions.shift_id column OK",           "sessions.shift_id missing — run backend/supabase/migrations/029_shifts.sql"),
            ("ai_detected_patterns", "ai_detected_patterns",  "id, organization_id, pattern_type, title, message",                           "ai_detected_patterns table OK",         "ai_detected_patterns missing — run backend/supabase/migrations/030_ai_detected_patterns.sql"),
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
            elif key == "upcoming_review_date":
                migration_state.upcoming_review_date_column_missing = not ok
            elif key == "progress_delta":
                migration_state.progress_delta_column_missing = not ok
            elif key == "shifts":
                migration_state.shifts_table_missing = not ok
            elif key == "sessions_shift_id":
                migration_state.sessions_shift_id_column_missing = not ok
            elif key == "ai_detected_patterns":
                migration_state.ai_detected_patterns_table_missing = not ok

    except Exception as e:
        logger.warning(f"Startup migration check failed (non-critical): {e}")


@asynccontextmanager
async def lifespan(application: FastAPI):
    await _validate_supabase_region_startup()
    start_email_queue()
    await _apply_startup_migrations()
    start_notification_scheduler()
    start_scheduler()
    yield
    stop_scheduler()
    await stop_notification_scheduler()
    stop_email_queue()


app = FastAPI(
    title="AI Clinical Companion API",
    description="NDIS Provider Clinical Management System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "*")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# CCQ-104: attach organisation_id to every request from the JWT claim.
# Runs after CORS so preflight OPTIONS requests pass through unaffected.
app.add_middleware(OrgContextMiddleware)

app.include_router(auth.router, prefix="/api")
app.include_router(participants.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(ai_suggestions.router)  # Uses /api/ai prefix internally
app.include_router(compliance.router, prefix="/api")
app.include_router(budget_api.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(assignments.router, prefix="/api")
app.include_router(billing.router, prefix="/api")
app.include_router(dashboards.router, prefix="/api")
# worker_scheduling must register before worker — /worker/shifts/calendar must not match /shifts/{shift_id}
app.include_router(worker_scheduling.router, prefix="/api")
app.include_router(worker_performance.router, prefix="/api")
app.include_router(worker_travel.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(worker.router, prefix="/api")
app.include_router(privacy.router, prefix="/api")
app.include_router(worker_help.router, prefix="/api")
app.include_router(calendar_feed.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(coordinator.router, prefix="/api")
app.include_router(security.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(onboarding.router, prefix="/api")
app.include_router(credentials.router, prefix="/api")
app.include_router(toolkit.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(hub.router, prefix="/api")
app.include_router(md_onboarding.router, prefix="/api")
app.include_router(ndis_pricing.router, prefix="/api")
# app.include_router(ndis_tasks.router, prefix="/api")  # Disabled: causes import issues on Render
app.include_router(budget_ledger.router)  # Uses internal /api/ledger prefix
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
        "progress_delta_column_missing":              migration_state.progress_delta_column_missing,
        "shifts_table_missing":                       migration_state.shifts_table_missing,
        "sessions_shift_id_column_missing":           migration_state.sessions_shift_id_column_missing,
        "ai_detected_patterns_table_missing":         migration_state.ai_detected_patterns_table_missing,
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
            migration_state.progress_delta_column_missing,
            migration_state.shifts_table_missing,
            migration_state.sessions_shift_id_column_missing,
            migration_state.ai_detected_patterns_table_missing,
        ]),
    }


@app.get("/")
async def root():
    return {"message": "AI Clinical Companion API", "docs": "/docs"}
