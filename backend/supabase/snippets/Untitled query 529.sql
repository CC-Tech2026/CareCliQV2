alter table public.users enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

alter table public.patients enable row level security;
alter table public.sessions enable row level security;
alter table public.session_messages enable row level security;

alter table public.alerts enable row level security;
alter table public.incidents enable row level security;

alter table public.ndis_plans enable row level security;
alter table public.plan_budgets enable row level security;
alter table public.budget_usage enable row level security;

alter table public.practitioner_allocations enable row level security;

alter table public.media_files enable row level security;

alter table public.access_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.security_events enable row level security;