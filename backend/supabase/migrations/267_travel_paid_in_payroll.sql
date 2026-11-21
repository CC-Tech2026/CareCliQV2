-- Travel claims are paid with wages: kilometres as a vehicle allowance and
-- fares as a reimbursement, through the Payroll page's export, Xero Payroll
-- or Employment Hero. Each claim remembers how it was paid and where.

BEGIN;

ALTER TABLE public.shift_travel_expenses
    ADD COLUMN IF NOT EXISTS paid_via TEXT
        CHECK (paid_via IS NULL OR paid_via IN ('payroll_export', 'xero_payroll', 'employment_hero', 'manual')),
    ADD COLUMN IF NOT EXISTS payroll_reference TEXT,
    ADD COLUMN IF NOT EXISTS payroll_error TEXT;

COMMENT ON COLUMN public.shift_travel_expenses.paid_via IS
    'How an approved claim reached the worker''s pay: payroll_export, xero_payroll, employment_hero or manual.';
COMMENT ON COLUMN public.shift_travel_expenses.payroll_reference IS
    'The payroll system''s record for it (Xero timesheet or payslip id, Employment Hero expense request id).';
COMMENT ON COLUMN public.shift_travel_expenses.payroll_error IS
    'Why it last could not be sent to payroll, for the office to fix.';

CREATE INDEX IF NOT EXISTS idx_shift_travel_expenses_to_pay
    ON public.shift_travel_expenses (organization_id, status)
    WHERE status = 'approved';

COMMIT;
