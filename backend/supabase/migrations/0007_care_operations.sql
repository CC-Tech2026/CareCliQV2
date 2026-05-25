create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid references public.organizations(id),
  patient_id uuid references public.patients(id),
  session_id uuid references public.sessions(id),

  alert_type text not null,
  severity text default 'medium',

  title text not null,
  message text not null,

  is_read boolean default false,
  read_at timestamptz,

  priority int default 1,
  escalated boolean default false,

  created_by uuid references public.users(id),

  created_at timestamptz default now()
);

create table if not exists public.practitioner_allocations (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid references public.organizations(id),
  patient_id uuid references public.patients(id),
  user_id uuid references public.users(id),

  allocated_role text not null
    check (allocated_role in (
      'primary_ot',
      'support_worker',
      'supervisor',
      'allied_health'
    )),

  is_active boolean default true,

  assigned_at timestamptz default now(),
  assigned_by uuid references public.users(id)
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid references public.organizations(id),
  patient_id uuid references public.patients(id),
  session_id uuid references public.sessions(id),

  title text not null,
  description text not null,

  incident_type text default 'other',
  severity text default 'medium',
  status text default 'reported',

  incident_date timestamptz default now(),
  reported_date timestamptz default now(),
  resolved_date timestamptz,

  location text,
  witnesses text,

  ndis_reportable boolean default false,
  ndis_reported_at timestamptz,

  practice_standard text,
  participant_impact text,
  worker_actions text,
  investigation_notes text,
  corrective_actions text,

  follow_up_required boolean default false,
  follow_up_date date,

  created_by uuid references public.users(id),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.session_messages (
  id uuid primary key default gen_random_uuid(),

  session_id uuid references public.sessions(id) not null,

  sender_role text default 'worker',

  message_type text default 'text',

  content text,
  media_url text,

  metadata jsonb default '{}'::jsonb,

  translated_content text,
  detected_language text,

  ai_processed boolean default false,

  created_at timestamptz default now()
);

create table if not exists public.media_files (
  id uuid primary key default gen_random_uuid(),

  session_id uuid references public.sessions(id),

  file_url text,
  file_type text,

  created_at timestamptz default now()
);