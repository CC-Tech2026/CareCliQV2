-- USERS (same org)
create policy "coordinator full access users"
on public.users
for all
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'coordinator'
      and u.organization_id = users.organization_id
  )
);