# Run Tests in Order with Config Support
$TestDir = "Test"
$SystemTestNhatDir = "Test/SystemTest-Nhat/tests"
$SystemTestNhatConfig = "Test/SystemTest-Nhat/playwright.config.ts"
$LastTests = @("import-export-csv-test.spec.ts", "admin-reset-test.spec.ts")

# 1. System tests
$SystemTests = Get-ChildItem -Path $SystemTestNhatDir -Filter "*.spec.ts" | Select-Object -ExpandProperty Name | ForEach-Object { "$SystemTestNhatDir/$_" }

# 2. Top-level tests excluding last tests
$TopLevelTests = Get-ChildItem -Path $TestDir -Filter "*.spec.ts" | 
    Where-Object { -not $LastTests.Contains($_.Name) } |
    Select-Object -ExpandProperty Name | ForEach-Object { "$TestDir/$_" }

# 3. Final lists
$FinalTests = ($LastTests | ForEach-Object { "$TestDir/$_" })

Write-Host "--- Order of Execution ---"
$i = 1
foreach ($test in $SystemTests) { Write-Host "$i. [SystemTest-Nhat] $test"; $i++ }
foreach ($test in $TopLevelTests) { Write-Host "$i. [Top-Level] $test"; $i++ }
foreach ($test in $FinalTests) { Write-Host "$i. [Final] $test"; $i++ }
Write-Host "--------------------------"

# Execution Category 1
$sysConfig = if (Test-Path $SystemTestNhatConfig) { "--config=""$SystemTestNhatConfig""" } else { "" }
foreach ($testFile in $SystemTests) {
    Write-Host "`n[RUNNING] $testFile..." -ForegroundColor Cyan
    cmd /c "npx playwright test ""$testFile"" $sysConfig --headed"
}

# Execution Category 2
foreach ($testFile in $TopLevelTests) {
    Write-Host "`n[RUNNING] $testFile..." -ForegroundColor Cyan
    cmd /c "npx playwright test ""$testFile"" --headed"
}

# Execution Category 3
foreach ($testFile in $FinalTests) {
    Write-Host "`n[RUNNING] $testFile..." -ForegroundColor Cyan
    cmd /c "npx playwright test ""$testFile"" --headed"
}
