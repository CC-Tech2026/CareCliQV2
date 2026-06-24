# Deploy CARECLIQV2-303/304/305 Budget Ledger Migrations to Supabase
# This script copies each migration file to a deployment directory for manual execution

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$workingDir = "c:\Users\Chanm\OneDrive - University of South Australia\Desktop\Supabase-Python-Hub"
$deployDir = Join-Path $workingDir "deployment_ready"

# Create deployment directory
if (-not (Test-Path $deployDir)) {
    New-Item -ItemType Directory -Path $deployDir | Out-Null
}

$migrations = @(
    "backend/supabase/migrations/001_create_budget_transactions_ledger.sql",
    "backend/supabase/migrations/002_create_budget_resolution_functions.sql",
    "backend/supabase/migrations/003_integration_tests_budget_ledger.sql",
    "backend/supabase/migrations/004_budget_write_migrations.sql"
)

Write-Host "================================"
Write-Host "CARECLIQV2-303/304/305 Deployment"
Write-Host "================================"
Write-Host ""

foreach ($migration in $migrations) {
    $fullPath = Join-Path $workingDir $migration
    
    if (Test-Path $fullPath) {
        $fileName = Split-Path -Leaf $migration
        $size = (Get-Item $fullPath).Length
        $lineCount = @(Get-Content $fullPath).Count
        
        Write-Host "✅ $fileName"
        Write-Host "   Path: $migration"
        Write-Host "   Size: $size bytes"
        Write-Host "   Lines: $lineCount"
        
        # Copy to deployment directory
        Copy-Item $fullPath (Join-Path $deployDir $fileName)
        Write-Host "   ✓ Copied to deployment_ready/$fileName"
        Write-Host ""
    } else {
        Write-Host "❌ $migration - NOT FOUND"
        Write-Host ""
    }
}

Write-Host "================================"
Write-Host "Next Steps:"
Write-Host "1. Open Supabase SQL Editor"
Write-Host "2. Copy content from deployment_ready/ directory"
Write-Host "3. Paste each migration in order (001, 002, 003, 004)"
Write-Host "4. Run test: SELECT * FROM runtests();"
Write-Host "================================"
