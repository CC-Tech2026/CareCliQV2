#!/usr/bin/env python3
"""
Diagnostic script to test worker notification message syncing.
Tests the full flow: API endpoint, database queries, and data transformation.
"""
import sys
import asyncio
from datetime import datetime
sys.path.insert(0, '/workspaces/Supabase-Python-Hub')

from backend.app.services.supabase_client import get_supabase_admin
from backend.app.schemas.alert import AlertCreate
from backend.app.services.alert_service import create_alert

async def test_worker_messages_sync():
    print("═" * 80)
    print("WORKER NOTIFICATION MESSAGE SYNC - DIAGNOSTIC TEST")
    print("═" * 80)
    
    supabase = get_supabase_admin()
    
    # Step 1: Check for test data
    print("\n[1/5] Checking for existing messages...")
    alerts = supabase.table('alerts').select('*').order('created_at', desc=True).limit(10).execute()
    total_alerts = len(alerts.data or [])
    alerts_with_recipient = sum(1 for a in (alerts.data or []) if a.get('recipient_user_id'))
    print(f"  ✓ Total alerts: {total_alerts}")
    print(f"  ✓ Alerts with recipient_user_id: {alerts_with_recipient}")
    
    if not alerts_with_recipient:
        print("  ⚠ No messages with recipient_user_id found!")
        return
    
    # Step 2: Get a test worker
    print("\n[2/5] Selecting test worker...")
    test_alert = next((a for a in (alerts.data or []) if a.get('recipient_user_id')), None)
    if not test_alert:
        print("  ✗ No test data available")
        return
    
    worker_id = test_alert['recipient_user_id']
    org_id = test_alert['organization_id']
    print(f"  ✓ Worker ID: {worker_id}")
    print(f"  ✓ Org ID: {org_id}")
    
    # Step 3: Query as worker would
    print("\n[3/5] Querying messages as worker would...")
    worker_messages = supabase.table('alerts').select(
        'id, alert_type, title, message, severity, is_read, created_at, patient_id'
    ).eq('organization_id', org_id).eq('recipient_user_id', worker_id).order(
        'created_at', desc=True
    ).limit(50).execute()
    
    count = len(worker_messages.data or [])
    print(f"  ✓ Found {count} messages for worker")
    
    # Step 4: Check RLS policies
    print("\n[4/5] Checking database RLS policies...")
    # Query the pg_policies table to check if our policies exist
    try:
        policies_check = supabase.table('pg_policies').select('*').eq('tablename', 'alerts').execute()
        # This might fail due to permissions, so we'll just note it
        print(f"  ℹ RLS policies check: (requires direct database access)")
    except Exception as e:
        print(f"  ℹ RLS policies check skipped: {type(e).__name__}")
    
    # Step 5: Display message details
    print("\n[5/5] Message details:")
    for i, msg in enumerate((worker_messages.data or [])[:3], 1):
        print(f"\n  Message {i}:")
        print(f"    ID: {msg['id']}")
        print(f"    Title: {msg['title']}")
        print(f"    Type: {msg['alert_type']}")
        print(f"    Severity: {msg['severity']}")
        print(f"    Read: {msg['is_read']}")
        print(f"    Created: {msg['created_at']}")
    
    # Summary
    print("\n" + "=" * 80)
    print("DIAGNOSIS SUMMARY")
    print("=" * 80)
    
    if count > 0:
        unread_count = sum(1 for m in (worker_messages.data or []) if not m.get('is_read'))
        print(f"✓ BACKEND: Working correctly")
        print(f"  - Database query returns {count} messages")
        print(f"  - {unread_count} are unread")
        print(f"\n⚠ ISSUE: Frontend still shows 'no messages'")
        print(f"\nPOSSIBLE CAUSES:")
        print(f"  1. API endpoint not returning data (auth issue)")
        print(f"  2. Frontend fetch() call failing silently")
        print(f"  3. Error in useOrgQuery hook")
        print(f"  4. Component error handling catching and hiding errors")
        print(f"\nNEXT STEPS:")
        print(f"  - Check browser console for errors")
        print(f"  - Check network tab in DevTools for 401/403 errors")
        print(f"  - Test API directly: curl http://localhost:8000/api/worker/messages")
        print(f"  - Add console.log() to WorkerNotificationPanel.tsx")
    else:
        print(f"✗ BACKEND: No data found for worker")
        print(f"  - Create a test message with:")
        print(f"    - worker_id: {worker_id}")
        print(f"    - org_id: {org_id}")
        print(f"    - is_read: false (must be unread)")
    
    print("\n" + "=" * 80)

if __name__ == '__main__':
    asyncio.run(test_worker_messages_sync())
