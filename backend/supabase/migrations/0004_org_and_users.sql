create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ndis_provider_number text,
  owner_user_id uuid references public.users(id),
  created_at timestamptz default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  organization_id uuid references public.organizations(id),
  role text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);