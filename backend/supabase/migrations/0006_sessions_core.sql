create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id),
  organization_id uuid references public.organizations(id),
  session_date date,
  duration_minutes int,
  notes text,
  transcription text,
  status text default 'draft',
  created_at timestamptz default now()
);