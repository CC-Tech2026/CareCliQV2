BEGIN;

ALTER TABLE public.ndis_price_items
  ADD COLUMN IF NOT EXISTS category_number text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ndis_price_items'
      AND column_name = 'support_category_number'
  ) THEN
    EXECUTE $sql$
      UPDATE public.ndis_price_items
      SET category_number = support_category_number
      WHERE category_number IS NULL
        AND COALESCE(support_category_number, '') <> ''
    $sql$;
  END IF;
END $$;

UPDATE public.ndis_price_items
SET category_number = substring(item_code FROM '^([0-9]+)')
WHERE category_number IS NULL
  AND COALESCE(item_code, '') <> '';

CREATE INDEX IF NOT EXISTS idx_ndis_price_items_category_number
  ON public.ndis_price_items (organization_id, category_number)
  WHERE category_number IS NOT NULL;

COMMIT;
