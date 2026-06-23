#!/usr/bin/env python3
"""
Add missing columns to ndis_price_schedules using direct PostgreSQL connection.
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

# Try using psycopg2 directly to Supabase PostgreSQL
try:
    import psycopg2
    from psycopg2 import sql
    
    # Construct Supabase PostgreSQL connection string
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    
    # Extract host from Supabase URL: https://sndwllbtmguzduuazahd.supabase.co
    if SUPABASE_URL:
        project_id = SUPABASE_URL.split("//")[1].split(".")[0]
        host = f"{project_id}.supabase.co"
    else:
        host = "sndwllbtmguzduuazahd.supabase.co"
    
    # Get credentials from environment
    db_user = os.getenv("DB_USER", "postgres")
    db_password = os.getenv("DB_PASSWORD", "")
    db_name = os.getenv("DB_NAME", "postgres")
    
    print(f"Attempting to connect to: {host}")
    print(f"User: {db_user}")
    
    if not db_password:
        print("❌ DB_PASSWORD not found in .env")
        print("   Please set DB_PASSWORD to your Supabase database password")
        sys.exit(1)
    
    # Connect
    conn = psycopg2.connect(
        host=host,
        port=5432,
        database=db_name,
        user=db_user,
        password=db_password
    )
    
    cursor = conn.cursor()
    
    # Execute ALTER TABLE statements
    statements = [
        "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS source_document TEXT;",
        "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS version TEXT;",
        "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS source_json JSONB;",
        "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;",
        "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;",
    ]
    
    for stmt in statements:
        try:
            cursor.execute(stmt)
            conn.commit()
            col_name = stmt.split("COLUMN")[1].split("IF")[0].strip().split()[0]
            print(f"✅ Added column: {col_name}")
        except Exception as e:
            print(f"⚠️  {stmt[:50]}... : {str(e)[:80]}")
            conn.rollback()
    
    cursor.close()
    conn.close()
    
    print("\n✅ ALTER TABLE statements executed!")
    print("   Now try: python load_pricing_data.py")
    
except ImportError:
    print("❌ psycopg2 not found. Installing...")
    os.system(".venv\\Scripts\\pip install psycopg2-binary -q")
    print("   Please run this script again.")

except Exception as e:
    print(f"❌ Connection error: {str(e)}")
    print(f"   Make sure DB_PASSWORD is set correctly in .env")
    print(f"   Password should be your Supabase database password, not the API key")
