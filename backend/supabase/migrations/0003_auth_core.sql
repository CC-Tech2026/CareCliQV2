create table public.users (
  id uuid primary key references auth.users(id),
  organization_id uuid,
  email text not null,
  full_name text,
  role user_role not null,
  is_active boolean default true,
  created_at timestamptz default now()
);