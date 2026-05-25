create table public.access_logs (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references public.users(id),

  organization_id uuid references public.organizations(id),
  patient_id uuid references public.patients(id),

  action text default 'READ',
  ip_address text,

  purpose text default 'Provision of NDIS Supports',

  created_at timestamptz default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references public.users(id),

  organization_id uuid references public.organizations(id),

  action text not null,
  resource_type text not null,
  resource_id text,

  details jsonb,

  before_state jsonb,
  after_state jsonb,

  ip_address text,

  created_at timestamptz default now()
);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid references public.organizations(id),

  event_type text not null,

  accessor_id uuid references public.users(id),

  patient_id uuid references public.patients(id),

  ip_address text,

  description text,

  severity text default 'medium'
    check (severity in ('low','medium','high','critical')),

  is_reported boolean default false,

  created_at timestamptz default now()
);