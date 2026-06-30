#!/usr/bin/env python3
from backend.app.core.database import supabase_client

# Check if Benjamin Scott exists with goals
response = supabase_client.table('patients').select('id,full_name,ndis_number,goals').eq('ndis_number', '400111111').execute()

if response.data:
    patient = response.data[0]
    print(f"✅ Patient found: {patient['full_name']} (ID: {patient['id']})")
    print(f"   NDIS Number: {patient['ndis_number']}")
    print(f"   Goals: {patient.get('goals', [])}")
else:
    print("❌ Patient not found")
