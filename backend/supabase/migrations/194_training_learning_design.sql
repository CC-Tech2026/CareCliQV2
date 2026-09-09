BEGIN;
ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS material_layout text NOT NULL DEFAULT 'list',
  ADD COLUMN IF NOT EXISTS learning_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE public.training_modules
  ADD CONSTRAINT training_material_layout_valid CHECK (material_layout IN ('list', 'cards')),
  ADD CONSTRAINT training_learning_steps_valid CHECK (jsonb_typeof(learning_steps) = 'array' AND jsonb_array_length(learning_steps) <= 30),
  ADD CONSTRAINT training_duration_valid CHECK (estimated_minutes BETWEEN 1 AND 1440);
COMMIT;
