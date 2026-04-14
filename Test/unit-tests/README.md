# Unit Tests (Python, Go, .NET)

This folder contains automation unit test assets for the FCTF system.

## Structure

- `python/`: Python unit tests targeting:
  - `database-migration/migrator.py`
  - `FCTF-ManagementPlatform/CTFd/utils/rewards/*`
  - `FCTF-ManagementPlatform/CTFd/plugins/dynamic_challenges/decay.py`
- `dotnet/ResourceShared.UnitTests/`: .NET xUnit tests targeting `ResourceShared` helpers
- Go unit tests are located in package paths required by Go `internal` visibility rules:
  - `ChallengeGateway/internal/token/token_test.go`
  - `ChallengeGateway/internal/gateway/util_test.go`

## Run all tests

From `FCTF/`:

```powershell
./Test/unit-tests/run-all-unit-tests.ps1
```

If PowerShell blocks scripts, run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
./Test/unit-tests/run-all-unit-tests.ps1
```

## Run each stack manually

```powershell
# Python
python -m unittest discover -s Test/unit-tests/python -p "test_*.py" -v

# Go
cd ChallengeGateway
go test ./... -v

# .NET
cd Test/unit-tests/dotnet/ResourceShared.UnitTests
dotnet test --configuration Debug --verbosity minimal
```
