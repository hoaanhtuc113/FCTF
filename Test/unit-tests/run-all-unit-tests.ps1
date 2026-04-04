$ErrorActionPreference = "Stop"

Write-Host "Running Python unit tests..." -ForegroundColor Cyan
$pythonInPath = Get-Command python -ErrorAction SilentlyContinue
if ($pythonInPath) {
	python -m unittest discover -s "Test/unit-tests/python" -p "test_*.py" -v
}
elseif (Test-Path "C:/Users/$env:USERNAME/AppData/Local/Programs/Python/Python314/python.exe") {
	& "C:/Users/$env:USERNAME/AppData/Local/Programs/Python/Python314/python.exe" -m unittest discover -s "Test/unit-tests/python" -p "test_*.py" -v
}
else {
	throw "Python CLI not found. Install Python or add it to PATH."
}

Write-Host "Running Go unit tests..." -ForegroundColor Cyan
Push-Location "ChallengeGateway"
$goInPath = Get-Command go -ErrorAction SilentlyContinue
if ($goInPath) {
	go test ./... -v
}
elseif (Test-Path "C:/Program Files/Go/bin/go.exe") {
	& "C:/Program Files/Go/bin/go.exe" test ./... -v
}
else {
	throw "Go CLI not found. Install Go or add it to PATH."
}
Pop-Location

Write-Host "Running .NET unit tests..." -ForegroundColor Cyan
Push-Location "Test/unit-tests/dotnet/ResourceShared.UnitTests"
dotnet test --configuration Debug --verbosity minimal
Pop-Location

Write-Host "All unit test commands completed." -ForegroundColor Green
