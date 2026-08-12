#!/usr/bin/env python3
from backend.app.core.database import supabase_client

# Get all budget allocations to see the structure
print("Checking plan_budgets table structure...")
budget_response = supabase_client.table('plan_budgets').select('*').limit(1).execute()

if budget_response.data:
    print("Sample budget record:")
    import json
    print(json.dumps(budget_response.data[0], indent=2, default=str))
else:
    print("No budget records found yet")

# Also check the ndis_plans table for Benjamin's plan details
print("\n" + "="*60)
print("Benjamin's NDIS Plan:")
plan_response = supabase_client.table('ndis_plans').select('*').eq('patient_id', '9d9f895f-4612-4833-8e64-cd07d29fe7b9').execute()

if plan_response.data:
    import json
    print(json.dumps(plan_response.data[0], indent=2, default=str))
