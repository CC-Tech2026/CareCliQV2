-- Drop existing tables
DROP TABLE IF EXISTS ndis_price_items CASCADE;
DROP TABLE IF EXISTS ndis_price_schedules CASCADE;
DROP FUNCTION IF EXISTS public.resolve_ndis_price(TEXT, UUID, DATE, TEXT) CASCADE;

-- Recreate tables with correct schema
CREATE TABLE ndis_price_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    financial_year TEXT NOT NULL,
    effective_date DATE NOT NULL,
    source_document TEXT,
    version TEXT,
    source_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, financial_year)
);

CREATE TABLE ndis_price_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    schedule_id UUID NOT NULL REFERENCES ndis_price_schedules(id) ON DELETE CASCADE,
    item_code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    unit TEXT DEFAULT 'H',
    price_national DECIMAL(10, 2),
    price_remote DECIMAL(10, 2),
    price_very_remote DECIMAL(10, 2),
    effective_date DATE NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    day_type TEXT,
    time_type TEXT,
    support_intensity TEXT,
    support_purpose TEXT,
    support_category_number TEXT,
    support_category_name TEXT,
    category_number TEXT,
    registration_group TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_price_date CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);

-- Create indexes
CREATE INDEX idx_ndis_price_items_org_code ON ndis_price_items(organization_id, item_code);
CREATE INDEX idx_ndis_price_items_valid_dates ON ndis_price_items(valid_from, valid_to);
CREATE INDEX idx_ndis_price_schedules_org_year ON ndis_price_schedules(organization_id, financial_year);

-- Create resolve_ndis_price function
CREATE OR REPLACE FUNCTION public.resolve_ndis_price(
    p_item_code TEXT,
    p_org_id UUID,
    p_as_of_date DATE,
    p_location_type TEXT DEFAULT 'national'
)
RETURNS TABLE (
    id UUID,
    item_code TEXT,
    name TEXT,
    description TEXT,
    unit TEXT,
    price_national DECIMAL,
    price_remote DECIMAL,
    price_very_remote DECIMAL,
    effective_price DECIMAL,
    effective_price_source TEXT,
    day_type TEXT,
    time_type TEXT,
    support_intensity TEXT,
    support_purpose TEXT,
    category_number TEXT,
    registration_group TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        npi.id,
        npi.item_code,
        npi.name,
        npi.description,
        npi.unit,
        npi.price_national,
        npi.price_remote,
        npi.price_very_remote,
        CASE 
            WHEN p_location_type = 'national' THEN npi.price_national
            WHEN p_location_type = 'remote' THEN COALESCE(npi.price_remote, npi.price_national)
            WHEN p_location_type = 'very_remote' THEN COALESCE(npi.price_very_remote, npi.price_national)
            ELSE npi.price_national
        END AS effective_price,
        CASE 
            WHEN p_location_type = 'national' AND npi.price_national IS NOT NULL THEN 'explicit'
            WHEN p_location_type = 'remote' AND npi.price_remote IS NOT NULL THEN 'explicit'
            WHEN p_location_type = 'remote' AND npi.price_remote IS NULL AND npi.price_national IS NOT NULL THEN 'calculated_multiplier'
            WHEN p_location_type = 'very_remote' AND npi.price_very_remote IS NOT NULL THEN 'explicit'
            WHEN p_location_type = 'very_remote' AND npi.price_very_remote IS NULL AND npi.price_national IS NOT NULL THEN 'calculated_multiplier'
            ELSE 'explicit'
        END AS effective_price_source,
        npi.day_type,
        npi.time_type,
        npi.support_intensity,
        npi.support_purpose,
        npi.category_number,
        npi.registration_group
    FROM ndis_price_items npi
    WHERE npi.item_code = p_item_code
        AND npi.organization_id = p_org_id
        AND npi.valid_from <= p_as_of_date
        AND (npi.valid_to IS NULL OR npi.valid_to >= p_as_of_date)
    ORDER BY npi.valid_from DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.resolve_ndis_price(TEXT, UUID, DATE, TEXT) TO authenticated;
