# DeploymentCenter Unit Tests

## Mô tả

Unit tests cho DeploymentCenter service, bao gồm tests cho Services, Controllers, và Utils.

**Tổng số tests:** 52 tests
- Services: 16 tests (DeployService: 10, GetPodsJob: 7)
- Controllers: 23 tests (ChallengeController: 13, StatusCheckController: 10)
- Utils: 7 tests (DeploymentCenterConfigHelper)

**Coverage hiện tại:**
- Line Coverage: 44.31%
- Branch Coverage: 48.48%
- Method Coverage: 71.79%

## Yêu cầu

- .NET 8.0 SDK
- Packages đã được cài đặt:
  - xUnit 2.8.0
  - Moq 4.20.70
  - FluentAssertions 6.12.0
  - Coverlet.msbuild 6.0.4
  - ReportGenerator (để tạo HTML report)

## Cài đặt ReportGenerator (để xuất HTML report)

```bash
# Cài đặt ReportGenerator global tool
dotnet tool install -g dotnet-reportgenerator-globaltool

# Hoặc update nếu đã cài
dotnet tool update -g dotnet-reportgenerator-globaltool
```

## Các lệnh test

### 1. Chạy tất cả tests

```bash
cd /home/ubuntu/FCTF-Platform-Deploy/ControlCenterAndChallengeHostingServer
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj
```

### 2. Chạy tests với chi tiết

```bash
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj --verbosity normal
```

### 3. Chạy một test cụ thể

```bash
# Chạy một test method
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj --filter "FullyQualifiedName~Start_WhenChallengeNotFound_ReturnsNotFound"

# Chạy tất cả tests trong một class
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj --filter "FullyQualifiedName~DeployServiceTests"
```

### 4. Đo code coverage (terminal output)

```bash
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj \
  /p:CollectCoverage=true \
  /p:CoverletOutputFormat=cobertura \
  /p:Include="[DeploymentCenter]*"
```

### 5. Tạo coverage report dạng HTML

#### Cách 1: Sử dụng OpenCover format + ReportGenerator

```bash
# Bước 1: Chạy tests và tạo coverage file
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj \
  /p:CollectCoverage=true \
  /p:CoverletOutputFormat=opencover \
  /p:Include="[DeploymentCenter]*"

# Bước 2: Tạo HTML report từ coverage file
reportgenerator \
  -reports:"DeploymentCenter.Tests/coverage.opencover.xml" \
  -targetdir:"DeploymentCenter.Tests/coverage-report" \
  -reporttypes:Html

# Bước 3: Mở HTML report
# Trên Linux/Mac:
xdg-open DeploymentCenter.Tests/coverage-report/index.html
# Hoặc:
firefox DeploymentCenter.Tests/coverage-report/index.html
```

#### Cách 2: Script tự động (khuyến nghị)

```bash
#!/bin/bash
# File: run-coverage.sh

cd /home/ubuntu/FCTF-Platform-Deploy/ControlCenterAndChallengeHostingServer

echo "Running tests with coverage..."
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj \
  /p:CollectCoverage=true \
  /p:CoverletOutputFormat=opencover \
  /p:Include="[DeploymentCenter]*"

echo "Generating HTML report..."
reportgenerator \
  -reports:"DeploymentCenter.Tests/coverage.opencover.xml" \
  -targetdir:"DeploymentCenter.Tests/coverage-report" \
  -reporttypes:Html

echo "Coverage report generated at: DeploymentCenter.Tests/coverage-report/index.html"
```

Chạy script:
```bash
chmod +x run-coverage.sh
./run-coverage.sh
```

### 6. Tạo coverage report với nhiều format

```bash
# Tạo HTML + HTML Summary + Badges
reportgenerator \
  -reports:"DeploymentCenter.Tests/coverage.opencover.xml" \
  -targetdir:"DeploymentCenter.Tests/coverage-report" \
  -reporttypes:"Html;HtmlSummary;Badges;TextSummary"

# Các report types khác:
# - Html: Full HTML report với chi tiết từng file
# - HtmlSummary: Tóm tắt HTML ngắn gọn
# - HtmlInline: HTML report trong 1 file
# - Badges: SVG badges cho README
# - TextSummary: Text summary trong console
# - Cobertura: XML format cho CI/CD
```

## Cấu trúc Tests

```
DeploymentCenter.Tests/
├── Services/
│   ├── DeployServiceTests.cs          # 10 tests
│   └── GetPodsJobTests.cs             # 7 tests
├── Controllers/
│   ├── ChallengeControllerTests.cs    # 13 tests
│   └── StatusCheckControllerTests.cs  # 10 tests
├── Utils/
│   └── DeploymentCenterConfigHelperTests.cs  # 7 tests
└── README.md
```

## Test Patterns

Tất cả tests follow AAA pattern:
- **Arrange:** Setup test data và mocks
- **Act:** Thực thi method cần test
- **Assert:** Verify kết quả

Example:
```csharp
[Fact]
public async Task Start_WhenChallengeNotFound_ReturnsNotFound()
{
    // Arrange: Setup data
    var startReq = new ChallengeStartStopReqDTO { challengeId = 999 };
    
    // Act: Execute method
    var result = await _deployService.Start(startReq);
    
    // Assert: Verify result
    result.status.Should().Be(404);
    result.success.Should().BeFalse();
}
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run tests with coverage
  run: |
    cd ControlCenterAndChallengeHostingServer
    dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj \
      /p:CollectCoverage=true \
      /p:CoverletOutputFormat=cobertura \
      /p:Include="[DeploymentCenter]*"

- name: Generate coverage report
  run: |
    dotnet tool install -g dotnet-reportgenerator-globaltool
    reportgenerator \
      -reports:"DeploymentCenter.Tests/coverage.cobertura.xml" \
      -targetdir:"coverage-report" \
      -reporttypes:"Html;Cobertura"

- name: Upload coverage report
  uses: actions/upload-artifact@v3
  with:
    name: coverage-report
    path: coverage-report/
```

## Troubleshooting

### Lỗi: "No executable found matching command 'dotnet-reportgenerator'"

```bash
# Kiểm tra reportgenerator đã cài chưa
dotnet tool list -g

# Nếu chưa có, cài đặt:
dotnet tool install -g dotnet-reportgenerator-globaltool
```

### Lỗi: Coverage file không tìm thấy

```bash
# Kiểm tra file coverage đã được tạo chưa
ls -la DeploymentCenter.Tests/coverage.*.xml

# Nếu không có, chạy lại với verbose để xem lỗi
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj \
  /p:CollectCoverage=true \
  /p:CoverletOutputFormat=opencover \
  /p:Include="[DeploymentCenter]*" \
  --verbosity detailed
```

### Tests bị fail

```bash
# Chạy với verbose để xem chi tiết lỗi
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj --verbosity normal

# Chạy một test cụ thể để debug
dotnet test --filter "FullyQualifiedName~<TestName>" --verbosity normal
```

## Viewing Coverage Report

Sau khi generate HTML report, mở file `DeploymentCenter.Tests/coverage-report/index.html` trong browser:

### Trên Linux:
```bash
xdg-open DeploymentCenter.Tests/coverage-report/index.html
# Hoặc
firefox DeploymentCenter.Tests/coverage-report/index.html
```

### Trên WSL (Windows Subsystem for Linux):
```bash
# Cách 1: Dùng explorer.exe (khuyến nghị)
explorer.exe DeploymentCenter.Tests/coverage-report/index.html

# Cách 2: Dùng wslview (cần cài wslu)
wslview DeploymentCenter.Tests/coverage-report/index.html

# Cách 3: Mở trong VS Code và click chuột phải -> "Open in Default Browser"
code DeploymentCenter.Tests/coverage-report/index.html
```

### Nội dung HTML Report:

- **Summary**: Tổng quan coverage (line, branch, method)
- **Risk Hotspots**: Các file có coverage thấp
- **Coverage by File**: Chi tiết coverage từng file
- **Source Code View**: Xem code với highlight dòng đã test (xanh) và chưa test (đỏ)

## Mục tiêu Coverage

- **Current:** 44.31% line coverage
- **Target:** 80%+ line coverage
- **Focus Areas:** 
  - Edge cases cho DeployService methods
  - Error handling scenarios
  - Complex branching logic

## Links

- [xUnit Documentation](https://xunit.net/)
- [Moq Documentation](https://github.com/moq/moq4)
- [FluentAssertions Documentation](https://fluentassertions.com/)
- [Coverlet Documentation](https://github.com/coverlet-coverage/coverlet)
- [ReportGenerator Documentation](https://github.com/danielpalme/ReportGenerator)
