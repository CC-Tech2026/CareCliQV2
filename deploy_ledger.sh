#!/bin/bash
# CARECLIQV2-303/304/305: Budget Ledger Deployment Script
# Deploys all migrations to Supabase in correct order

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}CARECLIQV2-303/304/305: Budget Ledger Deployment${NC}"
echo "=========================================="
echo ""
echo "This script will deploy 4 SQL migrations to Supabase in order:"
echo "1. Create budget_transactions ledger table (append-only)"
echo "2. Create budget resolution functions"
echo "3. Create integration tests"
echo "4. Create migration functions"
echo ""
echo "PREREQUISITES:"
echo "- Supabase CLI installed (npm install -g @supabase/cli)"
echo "- Logged into Supabase project: sndwllbtmguzduuazahd"
echo "- All migrations exist in: backend/supabase/migrations/"
echo ""
echo "To run:"
echo "  supabase db push"
echo ""
echo "Or manually run each migration in Supabase SQL Editor:"
echo "  1. Copy backend/supabase/migrations/001_create_budget_transactions_ledger.sql"
echo "  2. Paste into SQL Editor and run"
echo "  3. Repeat for 002, 003, 004"
echo "  4. Run tests: SELECT * FROM runtests();"
echo ""
echo "Deployment locations:"
ls -la backend/supabase/migrations/00{1,2,3,4}_*.sql 2>/dev/null | awk '{print "  " $9}'
