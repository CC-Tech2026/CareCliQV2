create or replace function public.is_coordinator()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'support_coordinator'
      and u.organization_id = (
        select organization_id from public.users where id = auth.uid()
      )
  );
$$;

create or replace function public.same_org(org_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.organization_id = org_id
  );
$$;

alter table public.users enable row level security;

create policy "self access"
on public.users
for select
using (id = auth.uid());

create policy "coordinator org users"
on public.users
for select
using (
  public.same_org(organization_id)
);

alter table public.users enable row level security;

create policy "self access"
on public.users
for select
using (id = auth.uid());

create policy "coordinator org users"
on public.users
for select
using (
  public.same_org(organization_id)
);

alter table public.organizations enable row level security;

create policy "org access only"
on public.organizations
for select
using (
  id in (
    select organization_id from public.users where id = auth.uid()
  )
);

alter table public.patients enable row level security;

create policy "coordinator full patient access"
on public.patients
for all
using (public.is_coordinator());

create policy "assigned patient access"
on public.patients
for select
using (
  exists (
    select 1
    from public.practitioner_allocations pa
    where pa.patient_id = patients.id
      and pa.user_id = auth.uid()
  )
);

alter table public.sessions enable row level security;

create policy "session access"
on public.sessions
for select
using (
  public.is_coordinator()
  OR
  exists (
    select 1
    from public.practitioner_allocations pa
    where pa.patient_id = sessions.patient_id
      and pa.user_id = auth.uid()
  )
);

alter table public.session_messages enable row level security;

create policy "message access"
on public.session_messages
for select
using (
  public.is_coordinator()
  OR
  exists (
    select 1
    from public.sessions s
    join public.practitioner_allocations pa
      on pa.patient_id = s.patient_id
    where s.id = session_messages.session_id
      and pa.user_id = auth.uid()
  )
);

alter table public.alerts enable row level security;

create policy "alerts org scoped"
on public.alerts
for all
using (public.same_org(organization_id));

alter table public.incidents enable row level security;

create policy "incidents org scoped"
on public.incidents
for all
using (public.same_org(organization_id));

alter table public.ndis_plans enable row level security;

create policy "ndis org access"
on public.ndis_plans
for all
using (public.same_org(organization_id));

alter table public.plan_budgets enable row level security;
alter table public.budget_usage enable row level security;

create policy "budget org access"
on public.plan_budgets
for all
using (
  exists (
    select 1
    from public.ndis_plans p
    where p.id = plan_budgets.plan_id
      and public.same_org(p.organization_id)
  )
);

alter table public.audit_logs enable row level security;
alter table public.access_logs enable row level security;
alter table public.security_events enable row level security;

create policy "audit org access"
on public.audit_logs
for select
using (public.same_org(organization_id));

create policy "access logs org access"
on public.access_logs
for select
using (public.same_org(organization_id));

create policy "security events org access"
on public.security_events
for select
using (public.same_org(organization_id));


alter table public.practitioner_allocations enable row level security;

create policy "self allocations"
on public.practitioner_allocations
for select
using (user_id = auth.uid());


select unnest(enum_range(null::user_role));