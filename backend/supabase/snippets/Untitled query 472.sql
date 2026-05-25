create policy "worker own user row"
on public.users
for select
using (id = auth.uid());