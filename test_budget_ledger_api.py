#!/usr/bin/env python3
"""
Test Budget Ledger API Endpoints

Tests all 8 budget ledger endpoints with proper authentication.
"""

import requests
import json
from uuid import uuid4
from datetime import datetime

BASE_URL = "http://127.0.0.1:5000"
API_PREFIX = "/api/ledger"

# Test UUIDs (same as in database tests)
TEST_ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
TEST_PARTICIPANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
TEST_PLAN_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"

# Create a test JWT token with proper claims
def create_test_jwt():
    """Create a test JWT token with Supabase-like claims."""
    import jwt
    import json
    
    payload = {
        "sub": TEST_PARTICIPANT_ID,
        "email": "test@example.com",
        "organization_id": TEST_ORG_ID,
        "role": "admin",
        "iat": int(datetime.utcnow().timestamp()),
        "exp": int(datetime.utcnow().timestamp()) + 3600,
    }
    
    # Use same secret as backend
    secret = "changeme-in-production"  # From config.py default
    token = jwt.encode(payload, secret, algorithm="HS256")
    return token

def test_endpoints():
    """Test all budget ledger endpoints."""
    
    try:
        token = create_test_jwt()
        headers = {"Authorization": f"Bearer {token}"}
        
        print("=" * 70)
        print("BUDGET LEDGER API TEST SUITE")
        print("=" * 70)
        
        # Test 1: Health check
        print("\n[1/8] Testing: GET /api/ledger/health")
        try:
            resp = requests.get(f"{BASE_URL}{API_PREFIX}/health", headers=headers)
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 200:
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        # Test 2: Record allocation
        print("\n[2/8] Testing: POST /api/ledger/transactions/allocation")
        allocation_data = {
            "participant_id": TEST_PARTICIPANT_ID,
            "amount_cents": 100000,  # $1000
            "description": "Test allocation",
            "plan_id": TEST_PLAN_ID,
            "category": "general"
        }
        try:
            resp = requests.post(
                f"{BASE_URL}{API_PREFIX}/transactions/allocation",
                json=allocation_data,
                headers=headers
            )
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 201:
                result = resp.json()
                print(f"      Transaction ID: {result.get('transaction_id', 'N/A')}")
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        # Test 3: Get remaining budget
        print("\n[3/8] Testing: GET /api/ledger/budget/remaining")
        try:
            params = {
                "participant_id": TEST_PARTICIPANT_ID,
                "plan_id": TEST_PLAN_ID,
                "category": "general"
            }
            resp = requests.get(
                f"{BASE_URL}{API_PREFIX}/budget/remaining",
                params=params,
                headers=headers
            )
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 200:
                result = resp.json()
                print(f"      Remaining: {result.get('remaining_dollars', 'N/A')}")
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        # Test 4: Record payment
        print("\n[4/8] Testing: POST /api/ledger/transactions/payment")
        payment_data = {
            "participant_id": TEST_PARTICIPANT_ID,
            "amount_cents": -25000,  # -$250 payment
            "invoice_id": "INV-001",
            "description": "Test payment",
            "plan_id": TEST_PLAN_ID,
            "category": "general"
        }
        try:
            resp = requests.post(
                f"{BASE_URL}{API_PREFIX}/transactions/payment",
                json=payment_data,
                headers=headers
            )
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 201:
                result = resp.json()
                print(f"      Transaction ID: {result.get('transaction_id', 'N/A')}")
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        # Test 5: Record adjustment
        print("\n[5/8] Testing: POST /api/ledger/transactions/adjustment")
        adjustment_data = {
            "participant_id": TEST_PARTICIPANT_ID,
            "adjustment_cents": 5000,  # +$50 adjustment
            "reason": "Plan review adjustment",
            "plan_id": TEST_PLAN_ID,
            "category": "general"
        }
        try:
            resp = requests.post(
                f"{BASE_URL}{API_PREFIX}/transactions/adjustment",
                json=adjustment_data,
                headers=headers
            )
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 201:
                result = resp.json()
                print(f"      Transaction ID: {result.get('transaction_id', 'N/A')}")
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        # Test 6: Get budget snapshot
        print("\n[6/8] Testing: GET /api/ledger/budget/snapshot")
        try:
            params = {
                "participant_id": TEST_PARTICIPANT_ID,
                "plan_id": TEST_PLAN_ID
            }
            resp = requests.get(
                f"{BASE_URL}{API_PREFIX}/budget/snapshot",
                params=params,
                headers=headers
            )
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 200:
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        # Test 7: Audit consistency
        print("\n[7/8] Testing: GET /api/ledger/audit/consistency")
        try:
            resp = requests.get(
                f"{BASE_URL}{API_PREFIX}/audit/consistency",
                headers=headers
            )
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 200:
                result = resp.json()
                print(f"      Consistent: {result.get('is_consistent', 'N/A')}")
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        # Test 8: Check direct writes
        print("\n[8/8] Testing: GET /api/ledger/audit/direct-writes")
        try:
            resp = requests.get(
                f"{BASE_URL}{API_PREFIX}/audit/direct-writes",
                headers=headers
            )
            print(f"      Status: {resp.status_code}")
            if resp.status_code == 200:
                print("      ✅ PASS")
            else:
                print(f"      ❌ FAIL: {resp.text}")
        except Exception as e:
            print(f"      ❌ ERROR: {e}")
        
        print("\n" + "=" * 70)
        print("TEST SUITE COMPLETE")
        print("=" * 70)
        
    except Exception as e:
        print(f"Fatal error: {e}")

if __name__ == "__main__":
    test_endpoints()
