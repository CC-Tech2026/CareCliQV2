insert into public.users (
  id,
  organization_id,
  email,
  full_name,
  role
)
values
(
  'f6bfd46b-690b-4261-add5-4c98b0fa99c0',
  '11111111-1111-1111-1111-111111111111',
  'coordinator@demo.com',
  'Support Coordinator',
  'support_coordinator'
),
(
  'ca888eb8-479f-4873-b11e-a2fd8061bc09',
  '11111111-1111-1111-1111-111111111111',
  'worker@demo.com',
  'Worker One',
  'support_worker'
),
(
  '9ed24a17-fec5-4d35-b474-7fd909a951a1',
  '11111111-1111-1111-1111-111111111111',
  'ot@demo.com',
  'OT Practitioner',
  'allied_health'
);

select id from public.patients;

insert into public.practitioner_allocations (
  id,
  organization_id,
  patient_id,
  user_id,
  allocated_role,
  is_active,
  assigned_at
)
values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '9ed24a17-fec5-4d35-b474-7fd909a951a1',
  'support_worker',
  true,
 now()
);

select * from public.practitioner_allocations;