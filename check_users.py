#!/usr/bin/env python3
from backend.app.core.database import supabase_client

response = supabase_client.table('users').select('email,role').eq('organization_id', 'a1111111-1111-1111-1111-111111111111').execute()
print(f"Users in org a1111111:")
for user in response.data:
    print(f"  {user['email']} - {user['role']}")
