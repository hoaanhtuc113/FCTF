# FCTF regression tests

Keep test source files and this guide in Git. Generated frontend bundles,
`bin/`, `obj/`, logs, caches and local audit reports are ignored.

The suites cover authentication and revocation, model and input validation,
scoring transactions, challenge and flag handling, Gateway access, activity logs,
tickets, CSV exports and pagination. Python and .NET tests use isolated SQLite
databases and mocked external services. Go tests use local Redis/upstream fixtures;
Node tests use built-in modules. They do not access production data. Passing them
does not replace staging checks against MySQL, Redis ACLs, Kubernetes and KYPO.

## Python

Install the management application's Python dependencies in its virtual
environment. From `FCTF-ManagementPlatform`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -v
```

Keep all files in `FCTF-ManagementPlatform/tests/`: several suites reuse fixtures
from `test_model_types.py` and `test_password_token_revocation.py`.

## .NET

Use a .NET SDK supporting .NET 8. From the repository root:

```powershell
dotnet run --project Test/Auth/TokenRevocationTests/TokenRevocationTests.csproj
```

The first run restores NuGet dependencies. Keep the `.csproj` and all `.cs` files
in `TokenRevocationTests/`; `Program.cs` invokes the other regression modules.

## Gateway

Use the Go version required by `ChallengeGateway/go.mod`. From `ChallengeGateway`:

```powershell
go test ./... -count=1
```

Keep the Go test files alongside their implementation and retain `go.mod`/`go.sum`.

## Admin JavaScript

Use Node.js with ES module and Web Crypto support. From the repository root:

```powershell
node Test/Auth/test_csp_nonce.mjs
node Test/Auth/test_award_request_key.mjs
```

These scripts check AJAX nonce handling and award idempotency keys without a
browser or additional test dependencies.
