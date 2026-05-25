create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (
    id,
    email,
    role,
    organization_id
  )
  values (
    new.id,
    new.email,
    'support_worker',
    null
  );

  return new;
end;
$$;