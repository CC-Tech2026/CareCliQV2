-- Incident Management spec — corrective actions -> training linkage. Lets a training
-- assignment record which incident's corrective action it closes the loop on, reusing the
-- existing worker_training_recommendations table/notification (063_worker_performance.sql)
-- rather than building a parallel assignment mechanism.

BEGIN;

ALTER TABLE public.worker_training_recommendations
    ADD COLUMN IF NOT EXISTS related_incident_id UUID REFERENCES public.incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_training_recommendations_incident
    ON public.worker_training_recommendations(related_incident_id)
    WHERE related_incident_id IS NOT NULL;

COMMIT;
