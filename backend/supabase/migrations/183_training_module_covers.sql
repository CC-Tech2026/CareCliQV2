BEGIN;
ALTER TABLE public.training_modules
    ADD COLUMN IF NOT EXISTS cover_color text,
    ADD COLUMN IF NOT EXISTS cover_path text;
ALTER TABLE public.training_modules
    DROP CONSTRAINT IF EXISTS training_module_cover_color_valid;
ALTER TABLE public.training_modules
    ADD CONSTRAINT training_module_cover_color_valid
    CHECK (cover_color IS NULL OR cover_color ~ '^#[0-9a-fA-F]{6}$');
COMMIT;
