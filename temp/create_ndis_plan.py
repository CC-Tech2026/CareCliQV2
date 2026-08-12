#!/usr/bin/env python3
"""
Create NDIS plan for Benjamin Scott using the correct API endpoint.
"""

import requests
import json
from datetime import datetime, timedelta

# Benjamin's ID
BENJAMIN_ID = "9d9f895f-4612-4833-8e64-cd07d29fe7b9"

# Get auth token for Sarah (coordinator)
print("🔐 Authenticating as Sarah (coordinator)...")
auth_response = requests.post(
    "http://localhost:8000/api/auth/login",
    json={
        "email": "sarah@sunshine-demo.com",
        "password": "Sarahsunshine#2026"
    }
)

if auth_response.status_code != 200:
    print(f"❌ Auth failed: {auth_response.json()}")
    exit(1)

auth_data = auth_response.json()
token = auth_data.get("access_token")
print(f"✅ Authenticated: {auth_data.get('user', {}).get('email')}")

# Create NDIS plan
print(f"\n💰 Creating NDIS plan for Benjamin Scott ({BENJAMIN_ID})...")

plan_data = {
    "plan_number": "PLAN-2026-001",
    "plan_start": (datetime.now() - timedelta(days=90)).date().isoformat(),
    "plan_end": (datetime.now() + timedelta(days=270)).date().isoformat(),
    "total_funding": 25000.00,
    "status": "active",
    "core_budget": 8000.00,
    "capacity_budget": 10000.00,
    "capital_budget": 7000.00,
}

plan_response = requests.post(
    f"http://localhost:8000/api/participants/{BENJAMIN_ID}/plan",
    json=plan_data,
    headers={"Authorization": f"Bearer {token}"}
)

if plan_response.status_code in [200, 201]:
    plan = plan_response.json()
    print(f"✅ NDIS Plan created!")
    print(f"   Plan ID: {plan.get('id')}")
    print(f"   Plan Number: {plan.get('plan_number')}")
    print(f"   Period: {plan.get('plan_start')} to {plan.get('plan_end')}")
    print(f"   Total Funding: ${plan.get('total_funding', 0):,.2f}")
    print(f"\n   Budget Allocation:")
    print(f"   • Core: ${plan_data['core_budget']:,.2f}")
    print(f"   • Capacity Building: ${plan_data['capacity_budget']:,.2f}")
    print(f"   • Capital: ${plan_data['capital_budget']:,.2f}")
else:
    print(f"❌ Plan creation failed: {plan_response.status_code}")
    print(f"   Response: {plan_response.json()}")
