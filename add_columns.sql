ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS source_document TEXT;
ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS version TEXT;
ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS source_json JSONB;
ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;
ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
