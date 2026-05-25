create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  ndis_number text unique not null,
  date_of_birth date not null,
  email text,
  phone text,
  plan_status plan_status,
  total_budget numeric default 0,
  used_budget numeric default 0,
  primary_disability text,
  organization_id uuid references public.organizations(id),
  risk_level risk_level default 'low',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);