-- ============================================================
-- CareCliQ — Feature Tables Patch
-- Run AFTER supabase_setup.sql AND supabase_patch_missing_tables.sql
--
--   Supabase Dashboard → SQL Editor → New query → paste → Run
--
-- All statements are idempotent (safe to re-run multiple times).
-- Pattern for every table:
--   Step A — column guards in DO block (safe if table pre-exists)
--   Step B — CREATE TABLE IF NOT EXISTS
--   Step C — DO-wrapped indexes (never abort the script)
--   Step D — RLS + service-role policy
-- ============================================================


-- ── 1. ACCESS LOGS ────────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.access_logs ADD COLUMN IF NOT EXISTS participant_id  UUID;
    ALTER TABLE public.access_logs ADD COLUMN IF NOT EXISTS user_id         UUID;
    ALTER TABLE public.access_logs ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.access_logs ADD COLUMN IF NOT EXISTS action          TEXT NOT NULL DEFAULT 'READ';
    ALTER TABLE public.access_logs ADD COLUMN IF NOT EXISTS purpose         TEXT NOT NULL DEFAULT 'Provision of NDIS Supports';
    ALTER TABLE public.access_logs ADD COLUMN IF NOT EXISTS ip_address      TEXT;
    ALTER TABLE public.access_logs ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.access_logs (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id   UUID        NOT NULL,
    user_id          UUID,
    organization_id  UUID,
    action           TEXT        NOT NULL DEFAULT 'READ',
    purpose          TEXT        NOT NULL DEFAULT 'Provision of NDIS Supports',
    ip_address       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_access_logs_participant ON public.access_logs(participant_id);   EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_access_logs_user        ON public.access_logs(user_id);          EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_access_logs_org         ON public.access_logs(organization_id);  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_access_logs_created     ON public.access_logs(created_at DESC);  EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='access_logs' AND policyname='access_logs_service_all') THEN
        CREATE POLICY access_logs_service_all ON public.access_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 2. SECURITY EVENTS ───────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS event_type      TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS description     TEXT NOT NULL DEFAULT '';
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS severity        TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS accessor_id     UUID;
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS participant_id  UUID;
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS ip_address      TEXT;
    ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.security_events (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type       TEXT        NOT NULL,
    description      TEXT        NOT NULL,
    severity         TEXT        NOT NULL DEFAULT 'medium'
                                 CHECK (severity IN ('low','medium','high','critical')),
    accessor_id      UUID,
    participant_id   UUID,
    organization_id  UUID,
    ip_address       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_security_events_org      ON public.security_events(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_security_events_severity ON public.security_events(severity);        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_security_events_created  ON public.security_events(created_at DESC); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='security_events' AND policyname='security_events_service_all') THEN
        CREATE POLICY security_events_service_all ON public.security_events FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 3. CREDENTIALS ───────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS user_id           UUID;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS organization_id   UUID;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS credential_type   TEXT;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS title             TEXT;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS credential_number TEXT;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS issuer            TEXT;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS issue_date        DATE;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS expiry_date       DATE;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS notes             TEXT;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'pending_review';
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS file_path         TEXT;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS file_url          TEXT;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS verified_at       TIMESTAMPTZ;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS verified_by       UUID;
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.credentials (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL,
    organization_id   UUID,
    credential_type   TEXT        NOT NULL,
    title             TEXT        NOT NULL,
    credential_number TEXT,
    issuer            TEXT,
    issue_date        DATE,
    expiry_date       DATE,
    notes             TEXT,
    status            TEXT        NOT NULL DEFAULT 'pending_review'
                                  CHECK (status IN ('pending_review','valid','expiring','expired','rejected')),
    file_path         TEXT,
    file_url          TEXT,
    verified_at       TIMESTAMPTZ,
    verified_by       UUID,
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON public.credentials(user_id);        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_credentials_org_id  ON public.credentials(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_credentials_expiry  ON public.credentials(expiry_date);     EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_credentials_status  ON public.credentials(status);          EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credentials' AND policyname='credentials_service_all') THEN
        CREATE POLICY credentials_service_all ON public.credentials FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 4. BILLING SUBSCRIPTIONS ─────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS organization_id          UUID;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS plan_name                TEXT NOT NULL DEFAULT 'starter';
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS status                   TEXT NOT NULL DEFAULT 'trialing';
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS billing_email            TEXT;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS seats                    INT  NOT NULL DEFAULT 1;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS price_cents              INT  NOT NULL DEFAULT 0;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS currency                 TEXT NOT NULL DEFAULT 'AUD';
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS renewal_date             TIMESTAMPTZ;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS payment_provider         TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS external_customer_id     TEXT;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS external_subscription_id TEXT;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS notes                    TEXT;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS updated_by               UUID;
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE public.billing_subscriptions ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           UUID        NOT NULL UNIQUE,
    plan_name                 TEXT        NOT NULL DEFAULT 'starter'
                                          CHECK (plan_name IN ('starter','team','pro','enterprise')),
    status                    TEXT        NOT NULL DEFAULT 'trialing'
                                          CHECK (status IN ('trialing','active','past_due','cancelled','manual_review')),
    billing_email             TEXT,
    seats                     INT         NOT NULL DEFAULT 1 CHECK (seats >= 1),
    price_cents               INT         NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    currency                  TEXT        NOT NULL DEFAULT 'AUD',
    renewal_date              TIMESTAMPTZ,
    payment_provider          TEXT        NOT NULL DEFAULT 'manual',
    external_customer_id      TEXT,
    external_subscription_id  TEXT,
    notes                     TEXT,
    updated_by                UUID,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_billing_subs_org ON public.billing_subscriptions(organization_id); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='billing_subscriptions' AND policyname='billing_subs_service_all') THEN
        CREATE POLICY billing_subs_service_all ON public.billing_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 5. INVOICES ──────────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS organization_id   UUID;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issued_by         UUID;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS participant_id    UUID;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS session_id        UUID;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_number    TEXT;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS recipient_name    TEXT NOT NULL DEFAULT '';
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS recipient_email   TEXT;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS line_items        JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS subtotal_cents    INT  NOT NULL DEFAULT 0;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tax_cents         INT  NOT NULL DEFAULT 0;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS total_cents       INT  NOT NULL DEFAULT 0;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS currency          TEXT NOT NULL DEFAULT 'AUD';
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'draft';
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS due_date          DATE;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issued_at         TIMESTAMPTZ;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS finalized_at      TIMESTAMPTZ;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_date      DATE;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_reference TEXT;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS notes             TEXT;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_path          TEXT;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_url           TEXT;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS cancelled_by      UUID;
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.invoices (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID        NOT NULL,
    issued_by           UUID,
    participant_id      UUID,
    session_id          UUID,
    invoice_number      TEXT        NOT NULL UNIQUE,
    recipient_name      TEXT        NOT NULL DEFAULT '',
    recipient_email     TEXT,
    line_items          JSONB       NOT NULL DEFAULT '[]',
    subtotal_cents      INT         NOT NULL DEFAULT 0,
    tax_cents           INT         NOT NULL DEFAULT 0,
    total_cents         INT         NOT NULL DEFAULT 0,
    currency            TEXT        NOT NULL DEFAULT 'AUD',
    status              TEXT        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN (
                                        'draft','finalized','issued','sent',
                                        'paid','void','overdue','cancelled'
                                    )),
    due_date            DATE,
    issued_at           TIMESTAMPTZ,
    finalized_at        TIMESTAMPTZ,
    paid_at             TIMESTAMPTZ,
    payment_date        DATE,
    payment_reference   TEXT,
    notes               TEXT,
    pdf_path            TEXT,
    pdf_url             TEXT,
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        UUID,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invoices_org       ON public.invoices(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invoices_status    ON public.invoices(status);          EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invoices_session   ON public.invoices(session_id);      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invoices_issued_by ON public.invoices(issued_by);       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_invoices_created   ON public.invoices(created_at DESC); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='invoices' AND policyname='invoices_service_all') THEN
        CREATE POLICY invoices_service_all ON public.invoices FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 6. PRACTITIONER SETTINGS ─────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS user_id          UUID;
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS name             TEXT;
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS credentials      TEXT;
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS signature        TEXT;
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS avatar_id        TEXT;
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS provider         JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS session_defaults JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS compliance       JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE public.practitioner_settings ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.practitioner_settings (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL UNIQUE,
    name             TEXT,
    credentials      TEXT,
    signature        TEXT,
    avatar_id        TEXT,
    provider         JSONB       NOT NULL DEFAULT '{}',
    session_defaults JSONB       NOT NULL DEFAULT '{}',
    compliance       JSONB       NOT NULL DEFAULT '{}',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_practitioner_settings_user ON public.practitioner_settings(user_id); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.practitioner_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practitioner_settings' AND policyname='practitioner_settings_service_all') THEN
        CREATE POLICY practitioner_settings_service_all ON public.practitioner_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 7. PRACTITIONER ALLOCATIONS ──────────────────────────────────────────────
-- This table pre-exists in many deployments — column guards run first.
DO $$ BEGIN
    ALTER TABLE public.practitioner_allocations ADD COLUMN IF NOT EXISTS patient_id     UUID;
    ALTER TABLE public.practitioner_allocations ADD COLUMN IF NOT EXISTS user_id        UUID;
    ALTER TABLE public.practitioner_allocations ADD COLUMN IF NOT EXISTS allocated_role TEXT    NOT NULL DEFAULT 'support_worker';
    ALTER TABLE public.practitioner_allocations ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE public.practitioner_allocations ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.practitioner_allocations ADD COLUMN IF NOT EXISTS assigned_by    UUID;
    ALTER TABLE public.practitioner_allocations ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.practitioner_allocations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID        NOT NULL,
    user_id         UUID        NOT NULL,
    allocated_role  TEXT        NOT NULL DEFAULT 'support_worker',
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    organization_id UUID,
    assigned_by     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_practitioner_allocation UNIQUE (patient_id, user_id)
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_practitioner_alloc_patient ON public.practitioner_allocations(patient_id);      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_practitioner_alloc_user    ON public.practitioner_allocations(user_id);          EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_practitioner_alloc_org     ON public.practitioner_allocations(organization_id);  EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.practitioner_allocations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practitioner_allocations' AND policyname='practitioner_alloc_service_all') THEN
        CREATE POLICY practitioner_alloc_service_all ON public.practitioner_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 8. SESSION ATTACHMENTS ───────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS session_id      UUID;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS uploaded_by     UUID;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS file_name       TEXT;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS file_path       TEXT;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS public_url      TEXT;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS mime_type       TEXT;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS size_bytes      INT;
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS attachment_type TEXT NOT NULL DEFAULT 'photo';
    ALTER TABLE public.session_attachments ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.session_attachments (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID        NOT NULL,
    organization_id  UUID,
    uploaded_by      UUID,
    file_name        TEXT        NOT NULL,
    file_path        TEXT        NOT NULL,
    public_url       TEXT,
    mime_type        TEXT,
    size_bytes       INT,
    attachment_type  TEXT        NOT NULL DEFAULT 'photo',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_session_attachments_session ON public.session_attachments(session_id);      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_session_attachments_org     ON public.session_attachments(organization_id); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.session_attachments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='session_attachments' AND policyname='session_attachments_service_all') THEN
        CREATE POLICY session_attachments_service_all ON public.session_attachments FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 9. SESSION MESSAGES ───────────────────────────────────────────────────────
-- This table pre-exists in many deployments — column guards run first.
DO $$ BEGIN
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS session_id           UUID;
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS message_type         TEXT NOT NULL DEFAULT 'text';
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS content              TEXT NOT NULL DEFAULT '';
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS sender_role          TEXT NOT NULL DEFAULT 'worker';
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS media_url            TEXT;
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS translated_content   TEXT;
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS detected_language    TEXT;
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS translation_status   TEXT;
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS translation_metadata JSONB;
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS attachment_id        UUID;
    ALTER TABLE public.session_messages ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.session_messages (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id           UUID        NOT NULL,
    message_type         TEXT        NOT NULL DEFAULT 'text',
    content              TEXT        NOT NULL DEFAULT '',
    sender_role          TEXT        NOT NULL DEFAULT 'worker',
    media_url            TEXT,
    translated_content   TEXT,
    detected_language    TEXT,
    translation_status   TEXT,
    translation_metadata JSONB,
    attachment_id        UUID,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_session_messages_session ON public.session_messages(session_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_session_messages_created ON public.session_messages(created_at); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.session_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='session_messages' AND policyname='session_messages_service_all') THEN
        CREATE POLICY session_messages_service_all ON public.session_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 10. TOOLKIT ITEMS ─────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS organization_id  UUID;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS name             TEXT;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS category         TEXT NOT NULL DEFAULT 'general';
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS sku              TEXT;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS quantity         NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS unit             TEXT NOT NULL DEFAULT 'item';
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS minimum_quantity NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS expiry_date      DATE;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS batch_number     TEXT;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS assigned_user_id UUID;
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE public.toolkit_items ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.toolkit_items (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL,
    name             TEXT        NOT NULL,
    category         TEXT        NOT NULL DEFAULT 'general',
    sku              TEXT,
    quantity         NUMERIC     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit             TEXT        NOT NULL DEFAULT 'item',
    minimum_quantity NUMERIC     NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
    expiry_date      DATE,
    batch_number     TEXT,
    assigned_user_id UUID,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_toolkit_items_org  ON public.toolkit_items(organization_id);  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_toolkit_items_user ON public.toolkit_items(assigned_user_id); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.toolkit_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='toolkit_items' AND policyname='toolkit_items_service_all') THEN
        CREATE POLICY toolkit_items_service_all ON public.toolkit_items FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 11. TOOLKIT MOVEMENTS ─────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.toolkit_movements ADD COLUMN IF NOT EXISTS item_id         UUID;
    ALTER TABLE public.toolkit_movements ADD COLUMN IF NOT EXISTS user_id         UUID;
    ALTER TABLE public.toolkit_movements ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.toolkit_movements ADD COLUMN IF NOT EXISTS movement_type   TEXT NOT NULL DEFAULT 'use';
    ALTER TABLE public.toolkit_movements ADD COLUMN IF NOT EXISTS quantity        NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE public.toolkit_movements ADD COLUMN IF NOT EXISTS notes           TEXT;
    ALTER TABLE public.toolkit_movements ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.toolkit_movements (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID        NOT NULL,
    user_id         UUID,
    organization_id UUID,
    movement_type   TEXT        NOT NULL DEFAULT 'use'
                                CHECK (movement_type IN ('use','adjust','assign','restock','dispose')),
    quantity        NUMERIC     NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_toolkit_movements_item ON public.toolkit_movements(item_id);         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_toolkit_movements_user ON public.toolkit_movements(user_id);         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_toolkit_movements_org  ON public.toolkit_movements(organization_id); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.toolkit_movements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='toolkit_movements' AND policyname='toolkit_movements_service_all') THEN
        CREATE POLICY toolkit_movements_service_all ON public.toolkit_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 12. RESTOCK REQUESTS ─────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS organization_id    UUID;
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS item_id            UUID;
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS requested_by       UUID;
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS quantity_requested NUMERIC NOT NULL DEFAULT 1;
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS notes              TEXT;
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.restock_requests (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    UUID        NOT NULL,
    item_id            UUID        NOT NULL,
    requested_by       UUID        NOT NULL,
    quantity_requested NUMERIC     NOT NULL DEFAULT 1 CHECK (quantity_requested > 0),
    notes              TEXT,
    status             TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','approved','fulfilled','rejected')),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_restock_requests_org  ON public.restock_requests(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_restock_requests_item ON public.restock_requests(item_id);         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_restock_requests_user ON public.restock_requests(requested_by);    EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.restock_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='restock_requests' AND policyname='restock_requests_service_all') THEN
        CREATE POLICY restock_requests_service_all ON public.restock_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 13. REPORT HISTORY ───────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS organization_id UUID;
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS participant_id  UUID;
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS generated_by    UUID;
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS report_type     TEXT;
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS title           TEXT;
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS content         JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS file_path       TEXT;
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS file_url        TEXT;
    ALTER TABLE public.report_history ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.report_history (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID,
    participant_id  UUID,
    generated_by    UUID,
    report_type     TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    content         JSONB       NOT NULL DEFAULT '{}',
    file_path       TEXT,
    file_url        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_report_history_org          ON public.report_history(organization_id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_report_history_participant   ON public.report_history(participant_id);  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_report_history_generated_by ON public.report_history(generated_by);    EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_report_history_created      ON public.report_history(created_at DESC); EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.report_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='report_history' AND policyname='report_history_service_all') THEN
        CREATE POLICY report_history_service_all ON public.report_history FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;


-- ── 14. Additional column guards on existing tables ───────────────────────────
-- sessions: translation fields referenced by dashboards.py and session service
DO $$ BEGIN
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS translation_status           TEXT;
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS translated_english_note      TEXT;
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS compliance_input_text        TEXT;
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS compliance_flags             JSONB;
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS restrictive_practice_detected BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS support_worker_id            UUID;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- patients: fields referenced by dashboard / participant service
DO $$ BEGIN
    ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS plan_management_type TEXT;
    ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS plan_management      TEXT;
    ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS goals_met            BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS risk_level           TEXT DEFAULT 'low';
    ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS risk_triggers        TEXT[];
    ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS risk_management_plan TEXT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- users: extra profile fields referenced by reports and community features
DO $$ BEGIN
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS full_name                 TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active                 BOOLEAN DEFAULT TRUE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login                TIMESTAMPTZ;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS date_of_birth             DATE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discipline                TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ahpra_registration_number TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_name             TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone                     TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url                TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS photo_url                 TEXT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Done! All 13 feature tables and column guards applied.
