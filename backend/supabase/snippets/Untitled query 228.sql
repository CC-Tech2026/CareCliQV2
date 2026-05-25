create or replace function public.current_role()
returns text
language sql
stable
as $$
  select role
  from public.users
  where id = auth.uid()
$$;