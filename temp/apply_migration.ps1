# Apply Supabase Migration via HTTP API

Write-Host ("=" * 70)
Write-Host "Supabase Migration Applicator"
Write-Host ("=" * 70)
Write-Host ""

# Read .env file for configuration
$supabaseUrl = ""
$serviceRoleKey = ""

if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match "VITE_SUPABASE_URL=(.*)") {
            $supabaseUrl = $matches[1]
        }
        if ($_ -match "SUPABASE_SERVICE_ROLE_KEY=(.*)") {
            $serviceRoleKey = $matches[1]
        }
    }
}

# Extract project ID from URL
$ProjectId = ""
if ($supabaseUrl -match "https://(.+?)\.supabase\.co") {
    $ProjectId = $matches[1]
}

$ApiKey = $serviceRoleKey
$MigrationFile = "backend/supabase/migrations/056_participant_tasks_instances.sql"

if (-not $ProjectId -or -not $ApiKey) {
    Write-Host "Error: Could not read configuration from .env"
    Write-Host ""
    Write-Host "Please ensure .env contains:"
    Write-Host "  VITE_SUPABASE_URL=https://PROJECT_ID.supabase.co"
    Write-Host "  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key"
    exit 1
}

Write-Host "Project ID: $ProjectId"
Write-Host "Migration File: $MigrationFile"
Write-Host ""

# Read migration file
if (-not (Test-Path $MigrationFile)) {
    Write-Host "Error: Migration file not found: $MigrationFile"
    exit 1
}

$sqlContent = Get-Content -Path $MigrationFile -Raw

Write-Host "File loaded successfully"
Write-Host "File size: $($sqlContent.Length) bytes"
Write-Host ""

Write-Host "Attempting to execute migration via Supabase SQL endpoint..."
Write-Host ""

try {
    # Headers for authentication
    $headers = @{
        "Authorization" = "Bearer $ApiKey"
        "apikey" = $ApiKey
        "Content-Type" = "application/json"
    }
    
    # Try using the sql() RPC function
    $uri = "https://$ProjectId.supabase.co/rest/v1/rpc/sql"
    $body = @{
        query = $sqlContent
    } | ConvertTo-Json
    
    Write-Host "Endpoint: POST $uri"
    Write-Host ""
    
    $response = Invoke-WebRequest -Uri $uri -Method POST -Headers $headers -Body $body -SkipCertificateCheck
    
    if ($response.StatusCode -eq 200) {
        Write-Host "Success! Migration executed."
        Write-Host "Response: " $response.Content
        exit 0
    }
    
} catch {
    Write-Host "API request failed: $($_.Exception.Message)"
    Write-Host ""
}

# If API method didn't work, show manual instructions
Write-Host ("=" * 70)
Write-Host "MANUAL MIGRATION REQUIRED"
Write-Host ("=" * 70)
Write-Host ""
Write-Host "The automated migration could not be applied."
Write-Host "Please apply manually using the Supabase Web Dashboard:"
Write-Host ""
Write-Host "1. Open: https://supabase.com/dashboard/projects"
Write-Host ""
Write-Host "2. Select project: $ProjectId"
Write-Host ""
Write-Host "3. Click 'SQL Editor' in the left sidebar"
Write-Host ""
Write-Host "4. Click '+ New Query' button"
Write-Host ""
Write-Host "5. Copy and paste this SQL:"
Write-Host ""
Write-Host $sqlContent
Write-Host ""
Write-Host "6. Click the 'Run' button"
Write-Host ""
Write-Host "7. Wait for 'Success' message"
Write-Host ""
Write-Host ("=" * 70)
Write-Host ""

exit 1
