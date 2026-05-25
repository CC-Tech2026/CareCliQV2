create type user_role as enum (
  'admin',
  'support_worker',
  'allied_health',
  'support_coordinator'
);

create type plan_status as enum (
  'active',
  'pending',
  'review',
  'completed'
);

create type risk_level as enum (
  'low',
  'medium',
  'high'
);

create type compliance_status as enum (
  'pending',
  'passed',
  'failed',
  'review'
);