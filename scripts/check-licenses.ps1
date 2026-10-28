# License Check Script for HealthTrack-X (both frontend and backend)
# Outputs license reports to /docs/ for static documentation generation.

Write-Host "=== License Check for HealthTrack-X ===" -ForegroundColor Cyan
Write-Host ""

$DocsDir = "$PSScriptRoot\..\docs"

# Frontend License Check
Write-Host "Generating Frontend License Report..." -ForegroundColor Yellow
Set-Location -Path "$PSScriptRoot\..\frontend"
npx license-checker --json --relativeLicensePath --excludePrivatePackages --out "$DocsDir\licenses-frontend.json"
$FrontendLicenses = Get-Content "$DocsDir\licenses-frontend.json" -Raw | ConvertFrom-Json
$FrontendLicenses.PSObject.Properties | ForEach-Object {
    $_.Value.PSObject.Properties.Remove('path')
}
$FrontendLicenseJson = $FrontendLicenses | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText("$DocsDir\licenses-frontend.json", "$FrontendLicenseJson`n", (New-Object System.Text.UTF8Encoding($false)))
npx license-checker --summary --excludePrivatePackages

Write-Host ""
Write-Host "Frontend license report saved to: docs\licenses-frontend.json" -ForegroundColor Green
Write-Host ""

# Backend License Check
Write-Host "Generating Backend License Report..." -ForegroundColor Yellow
Set-Location -Path "$PSScriptRoot\..\backend"

# Check if pip-licenses is installed
if (-not (Test-Path ".\venv\Scripts\pip-licenses.exe")) {
    Write-Host "Installing pip-licenses..." -ForegroundColor Yellow
    .\venv\Scripts\pip.exe install pip-licenses
}

.\venv\Scripts\pip-licenses.exe --format=json | Out-File -Encoding utf8 "$DocsDir\licenses-backend.json"
.\venv\Scripts\pip-licenses.exe --format=markdown --with-urls

Write-Host ""
Write-Host "Backend license report saved to: docs\licenses-backend.json" -ForegroundColor Green
Write-Host ""

# Return to root
Set-Location -Path "$PSScriptRoot\.."

Write-Host "=== License Check Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To regenerate the static documentation:" -ForegroundColor White
Write-Host "  backend\venv\Scripts\python.exe scripts\generate-docs.py" -ForegroundColor Gray
