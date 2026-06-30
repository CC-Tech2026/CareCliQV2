#!/usr/bin/env python3
from backend.app.core.database import supabase_client
import json

# Check if Benjamin's NDIS plan was created
response = supabase_client.table('ndis_plans').select('*').eq('patient_id', '9d9f895f-4612-4833-8e64-cd07d29fe7b9').execute()

if response.data:
    print("✅ NDIS Plans found for Benjamin Scott:")
    for plan in response.data:
        print(f"\n   Plan Details:")
        print(f"   • ID: {plan.get('id')}")
        print(f"   • Plan Number: {plan.get('plan_number')}")
        print(f"   • Status: {plan.get('status')}")
        print(f"   • Period: {plan.get('plan_start')} to {plan.get('plan_end')}")
        print(f"   • Total Funding: ${plan.get('total_funding', 0)}")
else:
    print("❌ No NDIS plans found for Benjamin Scott")

# Check budget allocations
print(f"\n📊 Checking budget allocations...")
budget_response = supabase_client.table('plan_budgets').select('*').eq('patient_id', '9d9f895f-4612-4833-8e64-cd07d29fe7b9').execute()

if budget_response.data:
    print(f"✅ Budget allocations found:")
    for budget in budget_response.data:
        print(f"   • {budget.get('budget_category')}: ${budget.get('allocated_amount', 0)}")
else:
    print("ℹ️  No budget allocations found (may be stored differently)")
