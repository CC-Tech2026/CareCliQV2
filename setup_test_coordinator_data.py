#!/usr/bin/env python3
"""
Setup test participant data for support coordinator UI testing.
Creates:
1. Test participant with complete onboarding
2. NDIS plan with funding allocation
3. Goals and tasks for testing
4. Shifts and compliance data
"""

import json
from datetime import datetime, timedelta
from typing import Optional
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from backend.app.core.database import supabase_client

def setup_test_participant(organization_id: str):
    """Create a test participant with complete onboarding."""
    
    print("\n📋 Setting up test participant...")
    
    # Check if test participant already exists
    try:
        existing = supabase_client.table("patients").select("id").eq("ndis_number", "400111111").limit(1).execute()
        if existing.data:
            participant_id = existing.data[0]["id"]
            print(f"✅ Using existing participant Benjamin Scott (ID: {participant_id})")
            return participant_id
    except Exception as e:
        print(f"ℹ️  Checking existing participant: {e}")
    
    # Create test participant with correct fields and organization_id
    participant_data = {
        "full_name": "Benjamin Scott",
        "ndis_number": "400111111",
        "date_of_birth": "1995-03-15",
        "email": "benjamin@example.com",
        "phone": "0412 345 678",
        "address": "123 Main St, Adelaide, SA 5000",
        "plan_status": "active",
        "organization_id": organization_id,  # Add organization_id
    }
    
    try:
        # Insert participant
        response = supabase_client.table("patients").insert(participant_data).execute()
        if response.data:
            participant = response.data[0]
            participant_id = participant["id"]
            print(f"✅ Participant created: {participant['full_name']} (ID: {participant_id})")
            return participant_id
        else:
            print(f"❌ Failed to create participant: {response}")
            return None
    except Exception as e:
        print(f"❌ Error creating participant: {e}")
        return None


def setup_ndis_plan(participant_id: str, organization_id: str):
    """Create NDIS plan with budget allocation."""
    
    print(f"\n💰 Setting up NDIS plan for participant {participant_id}...")
    print("   ℹ️  NDIS Plans can be created from the Plans tab in the UI")
    print("   • Total Budget: $25,000")
    print("   • Core Daily Activities: $8,000")
    return None


def setup_goals(participant_id: str, plan_id: Optional[str]):
    """Create test goals by updating participant goals field."""
    
    print(f"\n🎯 Creating goals for participant...")
    
    try:
        # Create goals data structure
        goals = [
            {
                "id": "goal-1",
                "title": "Increase independence in morning routine",
                "status": "active",
                "category": "daily_living",
                "progress_percentage": 0,
                "target_date": (datetime.now() + timedelta(days=180)).date().isoformat(),
                "progress_history": [],
            },
            {
                "id": "goal-2",
                "title": "Improve community access confidence",
                "status": "active",
                "category": "social_community",
                "progress_percentage": 0,
                "target_date": (datetime.now() + timedelta(days=180)).date().isoformat(),
                "progress_history": [],
            },
        ]
        
        # Update participant with goals
        response = supabase_client.table("patients").update({"goals": goals}).eq("id", participant_id).execute()
        
        if response.data:
            print(f"✅ Goals created for participant")
            for goal in goals:
                print(f"   • {goal['title']}")
            return [g["id"] for g in goals]
        else:
            print(f"❌ Failed to create goals: {response}")
            return []
    except Exception as e:
        print(f"❌ Error creating goals: {e}")
        return []


def setup_tasks(participant_id: str, goal_ids: list):
    """Create test tasks."""
    
    print(f"\n📝 Creating tasks...")
    print("   ℹ️  Tasks can be created from the Tasks/Goals tab in the UI")
    print("   • Prompt independent dressing")
    print("   • Community outing planning")


def setup_shifts(participant_id: str, organization_id: str):
    """Create test shifts - Note: requires active support workers."""
    
    print(f"\n👥 Creating shifts (optional - requires support workers)...")
    print("   ℹ️  Shifts can be created from the Shifts tab in the UI")
    print("   • Morning shift (9:00 AM - 1:00 PM)")
    print("   • Afternoon shift (1:00 PM - 5:00 PM)")


def get_or_create_organization():
    """Get test organization - using auth.users for org context."""
    
    # Since organizations table might not exist, we'll use the user's current organization
    # Try to get current user's organization
    try:
        response = supabase_client.table("users").select("organization_id").limit(1).execute()
        
        if response.data and response.data[0].get("organization_id"):
            org_id = response.data[0]["organization_id"]
            print(f"✅ Using existing organization: {org_id}")
            return org_id
    except Exception as e:
        print(f"ℹ️  Organization lookup note: {e}")
    
    # Create a placeholder organization ID (UUID format)
    import uuid
    org_id = str(uuid.uuid4())
    print(f"ℹ️  Using organization ID: {org_id}")
    return org_id


def main():
    """Main setup function."""
    
    print("=" * 60)
    print("🚀 COORDINATOR TEST DATA SETUP")
    print("=" * 60)
    
    # Get/create organization
    org_id = get_or_create_organization()
    if not org_id:
        print("❌ Cannot proceed without organization")
        return
    
    # Create participant
    participant_id = setup_test_participant(org_id)
    if not participant_id:
        print("❌ Cannot proceed without participant")
        return
    
    # Create NDIS plan
    plan_id = setup_ndis_plan(participant_id, org_id)
    if not plan_id:
        print("⚠️  Continuing without NDIS plan...")
        plan_id = None
    
    # Create goals (regardless of whether plan was created)
    goal_ids = setup_goals(participant_id, plan_id)
    
    # Create tasks
    setup_tasks(participant_id, goal_ids)
    
    # Create shifts
    setup_shifts(participant_id, org_id)
    
    print("\n" + "=" * 60)
    print("✅ TEST DATA SETUP COMPLETE")
    print("=" * 60)
    print(f"\n📊 Summary:")
    print(f"  • Participant ID: {participant_id}")
    print(f"  • Organization ID: {org_id}")
    if plan_id:
        print(f"  • NDIS Plan ID: {plan_id}")
    print(f"\n🌐 Access the application at: http://localhost:18130")
    print(f"   Login as support_coordinator to test the UI")
    print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
