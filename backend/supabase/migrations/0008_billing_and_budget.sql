create table if not exists public.ndis_plans (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid references public.organizations(id),
  patient_id uuid references public.patients(id),

  plan_number text,
  plan_start date not null,
  plan_end date not null,

  total_funding numeric default 0,

  status text default 'active',

  created_at timestamptz default now()
);

create table if not exists public.budget_usage (
  id uuid primary key default gen_random_uuid(),

  plan_id uuid references public.ndis_plans(id),
  session_id uuid references public.sessions(id),

  category text not null,

  amount numeric default 0,
  hourly_rate numeric default 0,
  duration_minutes int default 0,

  description text,

  created_at timestamptz default now()
);

create table if not exists public.plan_budgets (
  id uuid primary key default gen_random_uuid(),

  plan_id uuid references public.ndis_plans(id),

  category text check (category in (
    'core',
    'capacity_building',
    'capital'
  )),

  allocated_amount numeric default 0,
  used_amount numeric default 0,

  created_at timestamptz default now()
);