-- Vault folder structure: Governance records and Policy & Procedures modules.
--
-- The vault now opens in four folders: Governance, Participant Folder,
-- Policy & Procedures and Staff Folder. The nine Practice Standards policy
-- folders keep their keys and sit under Policy & Procedures > Core Module,
-- so no existing document, ID or share link changes. This adds:
--
--   - folder keys for the organisation's own records under Governance
--     (gov_*: business and continuity plan, insurances, NDIS registration,
--     meeting minutes and so on), and for the Practice Standards modules
--     under Policy & Procedures (policy_module_*), on both
--     governance_documents (uploads) and policy_documents (in-app drafts);
--   - an optional expiry date on governance uploads, so an insurance
--     certificate or NDIS registration is flagged before it lapses.
--
-- Safe to re-run (a migration may be applied by hand before the deploy
-- runner records it).

BEGIN;

ALTER TABLE public.governance_documents
    DROP CONSTRAINT IF EXISTS governance_documents_folder_key_check;
ALTER TABLE public.governance_documents
    ADD CONSTRAINT governance_documents_folder_key_check CHECK (folder_key IN (
        'governance_operational', 'risk_management', 'quality_management',
        'information_management', 'feedback_complaints', 'incident_management_system',
        'human_resource_management', 'continuity_of_supports', 'emergency_disaster_management',
        'policy_module_1', 'policy_module_2', 'policy_module_3', 'policy_module_4',
        'policy_module_5', 'policy_module_5a',
        'gov_business_continuity', 'gov_conflict_of_interest', 'gov_emergency_management',
        'gov_feedback_complaints', 'gov_incident_management', 'gov_insurances',
        'gov_meeting_minutes', 'gov_ndis_registration', 'gov_quality_management',
        'gov_risk_management', 'gov_training'
    ));

ALTER TABLE public.policy_documents
    DROP CONSTRAINT IF EXISTS policy_documents_folder_key_check;
ALTER TABLE public.policy_documents
    ADD CONSTRAINT policy_documents_folder_key_check CHECK (folder_key IN (
        'governance_operational', 'risk_management', 'quality_management',
        'information_management', 'feedback_complaints', 'incident_management_system',
        'human_resource_management', 'continuity_of_supports', 'emergency_disaster_management',
        'policy_module_1', 'policy_module_2', 'policy_module_3', 'policy_module_4',
        'policy_module_5', 'policy_module_5a',
        'gov_business_continuity', 'gov_conflict_of_interest', 'gov_emergency_management',
        'gov_feedback_complaints', 'gov_incident_management', 'gov_insurances',
        'gov_meeting_minutes', 'gov_ndis_registration', 'gov_quality_management',
        'gov_risk_management', 'gov_training'
    ));

ALTER TABLE public.governance_documents
    ADD COLUMN IF NOT EXISTS expiry_date DATE;

COMMENT ON COLUMN public.governance_documents.expiry_date IS
    'When the document lapses (an insurance certificate, an NDIS registration). '
    'Optional; the vault flags it as expiring 60 days before and expired after.';

COMMIT;
