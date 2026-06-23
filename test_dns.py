#!/usr/bin/env python3
"""Test DNS and network connectivity."""

import socket
import requests

print("Testing DNS resolution...")
try:
    ip = socket.gethostbyname('sndwllbtmguzduuazahd.supabase.co')
    print(f"✓ DNS resolved to: {ip}")
except Exception as e:
    print(f"✗ DNS failed: {e}")

print("\nTesting HTTP connection...")
try:
    response = requests.head('https://sndwllbtmguzduuazahd.supabase.co', timeout=5)
    print(f"✓ Connected successfully")
except Exception as e:
    print(f"✗ Connection failed: {e}")

print("\nTesting Supabase API...")
try:
    from supabase import create_client
    url = "https://sndwllbtmguzduuazahd.supabase.co"
    key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuZHdsbGJ0bWd1emR1dWF6YWhkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM1MzAwMSwiZXhwIjoyMDkyOTI5MDAxfQ.q7TNU0TFTYgGQUnq03KaU2ay0bhINHPHaJaBO8Rbmck"
    
    client = create_client(url, key)
    print(f"✓ Supabase client created")
except Exception as e:
    print(f"✗ Supabase client failed: {e}")
