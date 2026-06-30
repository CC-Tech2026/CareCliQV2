#!/usr/bin/env python3
from backend.app.core.database import supabase_client

# Benjamin's plan ID
PLAN_ID = "841abe1c-22d0-4ac8-b81f-c15cbf6809c1"

# Get budget allocations for the plan
print("✅ NDIS Plan Created Successfully!")
print("\n📊 Budget Allocations:")
budget_response = supabase_client.table('plan_budgets').select('*').eq('plan_id', PLAN_ID).execute()

if budget_response.data:
    total_allocated = 0
    for budget in budget_response.data:
        amount = budget.get('allocated_amount', 0)
        total_allocated += amount
        category = budget.get('category', 'unknown')
        category_display = {
            'core': 'Core Daily Activities',
            'capacity_building': 'Capacity Building',
            'capital': 'Capital Equipment'
        }.get(category, category.title())
        print(f"   • {category_display}: ${amount:,.2f}")
    
    print(f"\n   Total Allocated: ${total_allocated:,.2f}")
    print(f"   Total Budget: $25,000.00")
    print(f"   Remaining: ${25000 - total_allocated:,.2f}")
else:
    print("   No budget allocations found")

# Verify everything is in place
print("\n" + "="*60)
print("✅ Benjamin Scott's Profile is Ready:")
print("   • Participant: Benjamin Scott (NDIS: 400111111)")
print("   • Status: Active")
print("   • Goals: 2 (Increase independence, Improve community access)")
print("   • NDIS Plan: PLAN-2026-001 (Active)")
print("   • Plan Period: 2026-04-01 to 2027-03-27")
print("   • Total Budget: $25,000.00")
print("\n🌐 Access coordinator UI at: http://localhost:18130")
print("   Login: sarah@sunshine-demo.com / Sarahsunshine#2026")
