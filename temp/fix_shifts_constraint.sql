-- This SQL creates a function to update the shifts status constraint
-- It can be executed in the Supabase SQL editor

CREATE OR REPLACE FUNCTION update_shifts_status_constraint()
RETURNS text AS $$
DECLARE
    result text;
BEGIN
    -- Drop and recreate the constraint with new values
    BEGIN
        ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    
    ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check
        CHECK (status IN ('unassigned','scheduled','in_progress','clocked_in','completed','cancelled'));
    
    result := 'Constraint updated successfully. unassigned status is now allowed.';
    RETURN result;
    
EXCEPTION WHEN OTHERS THEN
    RETURN 'Error updating constraint: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- To use this, run: SELECT update_shifts_status_constraint();
