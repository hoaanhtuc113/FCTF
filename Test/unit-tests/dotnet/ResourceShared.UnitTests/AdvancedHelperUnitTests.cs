using System.Reflection;
using System.Text.Json;
using ResourceShared;
using ResourceShared.DTOs.Auth;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using ResourceShared.Utils;
using Xunit;

namespace ResourceShared.UnitTests;

public class AdvancedHelperUnitTests
{
    [Fact]
    public void HashPasswordPythonStyle_ReturnsExpectedPrefixAndMetadata()
    {
        var hash = SHA256Helper.HashPasswordPythonStyle("p@ssw0rd");

        Assert.StartsWith("$bcrypt-sha256$v=2,t=", hash);
        Assert.Matches(@"^\$bcrypt-sha256\$v=2,t=2[ab],r=\d{1,2}\$[./A-Za-z0-9]{22}\$[./A-Za-z0-9]{31}$", hash);
    }

    [Fact]
    public void HashPasswordPythonStyle_SamePlaintext_GeneratesDifferentHashes()
    {
        var h1 = SHA256Helper.HashPasswordPythonStyle("same-value");
        var h2 = SHA256Helper.HashPasswordPythonStyle("same-value");

        Assert.NotEqual(h1, h2);
    }

    [Fact]
    public void VerifyPassword_CorrectAndWrongPassword_BehaveAsExpected()
    {
        var hash = SHA256Helper.HashPasswordPythonStyle("TopSecret!");

        Assert.True(SHA256Helper.VerifyPassword("TopSecret!", hash));
        Assert.False(SHA256Helper.VerifyPassword("WrongSecret!", hash));
    }

    [Fact]
    public void VerifyPassword_InvalidHash_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() => SHA256Helper.VerifyPassword("abc", "not-a-passlib-hash"));
    }

    [Fact]
    public void CreateSecretKey_SortsInputByKeyForDeterministicOutput()
    {
        SharedConfig.PRIVATE_KEY = "unit-private";
        var unix = 1_700_000_000L;
        var input = new Dictionary<string, string>
        {
            ["z"] = "last",
            ["a"] = "first",
            ["m"] = "middle",
        };

        var result = SecretKeyHelper.CreateSecretKey(unix, input);

        var expectedRaw = "1700000000unit-privatefirstmiddlelast";
        Assert.Equal(MD5Helper.GenerateMD5Hash(expectedRaw), result);
    }

    [Fact]
    public void CreateSecretKey_NullValue_UsesFallbackLiteralOne()
    {
        SharedConfig.PRIVATE_KEY = "unit-private";
        var unix = 7L;
        var input = new Dictionary<string, string>
        {
            ["a"] = null!,
            ["b"] = "B"
        };

        var result = SecretKeyHelper.CreateSecretKey(unix, input);

        var expectedRaw = "7unit-private1B";
        Assert.Equal(MD5Helper.GenerateMD5Hash(expectedRaw), result);
    }

    [Fact]
    public void GetDeploymentStatus_MapsKnownValuesCaseInsensitive()
    {
        Assert.Equal(Enums.DeploymentStatus.DEPLOY_FAILED, Enums.GetDeploymentStatus("FAILED"));
        Assert.Equal(Enums.DeploymentStatus.DEPLOY_SUCCEEDED, Enums.GetDeploymentStatus("succeeded"));
    }

    [Fact]
    public void GetDeploymentStatus_UnknownOrEmpty_ReturnsPendingDeploy()
    {
        Assert.Equal(Enums.DeploymentStatus.PENDING_DEPLOY, Enums.GetDeploymentStatus(""));
        Assert.Equal(Enums.DeploymentStatus.PENDING_DEPLOY, Enums.GetDeploymentStatus("other"));
    }

    [Fact]
    public void NumberOrStringConverter_ReadsStringAndNumberIntoStringProperty()
    {
        var fromString = JsonSerializer.Deserialize<ChallengeImageDTO>("{\"imageLink\":\"img\",\"exposedPort\":\"8080\"}");
        var fromNumber = JsonSerializer.Deserialize<ChallengeImageDTO>("{\"imageLink\":\"img\",\"exposedPort\":8080}");

        Assert.Equal("8080", fromString!.exposedPort);
        Assert.Equal("8080", fromNumber!.exposedPort);
    }

    [Fact]
    public void NumberOrStringConverter_ReadsNullAndRejectsUnexpectedToken()
    {
        var fromNull = JsonSerializer.Deserialize<ChallengeImageDTO>("{\"imageLink\":\"img\",\"exposedPort\":null}");
        Assert.Null(fromNull!.exposedPort);

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ChallengeImageDTO>("{\"imageLink\":\"img\",\"exposedPort\":true}"));
    }

    [Fact]
    public void NumberOrStringConverter_WritesNumericStringAsJsonNumber()
    {
        var dto = new ChallengeImageDTO { imageLink = "img", exposedPort = "9000" };
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(dto));
        var portElement = doc.RootElement.GetProperty("exposedPort");

        Assert.Equal(JsonValueKind.Number, portElement.ValueKind);
        Assert.Equal(9000, portElement.GetInt32());
    }

    [Fact]
    public void NumberOrStringConverter_WritesNonNumericAndNullAsExpected()
    {
        var textDto = new ChallengeImageDTO { imageLink = "img", exposedPort = "9000/tcp" };
        using var textDoc = JsonDocument.Parse(JsonSerializer.Serialize(textDto));
        Assert.Equal(JsonValueKind.String, textDoc.RootElement.GetProperty("exposedPort").ValueKind);
        Assert.Equal("9000/tcp", textDoc.RootElement.GetProperty("exposedPort").GetString());

        var nullDto = new ChallengeImageDTO { imageLink = "img", exposedPort = null };
        using var nullDoc = JsonDocument.Parse(JsonSerializer.Serialize(nullDto));
        Assert.Equal(JsonValueKind.Null, nullDoc.RootElement.GetProperty("exposedPort").ValueKind);
    }

    [Fact]
    public void TimestampSignAndUnsign_ReturnOriginalValue()
    {
        var token = ItsDangerousCompatHelper.TimestampSign("payload-value", "my-secret", salt: "unit-salt");

        var original = ItsDangerousCompatHelper.TimestampUnsign(token, "my-secret", maxAgeSeconds: 60, salt: "unit-salt");

        Assert.Equal("payload-value", original);
    }

    [Fact]
    public void TimestampUnsign_InvalidSignature_Throws()
    {
        var token = ItsDangerousCompatHelper.TimestampSign("payload", "my-secret", salt: "unit-salt");
        var tampered = token[..^1] + (token[^1] == 'A' ? "B" : "A");

        var ex = Assert.Throws<InvalidOperationException>(
            () => ItsDangerousCompatHelper.TimestampUnsign(tampered, "my-secret", maxAgeSeconds: 60, salt: "unit-salt")
        );

        Assert.Contains("BadSignature", ex.Message);
    }

    [Fact]
    public void TimestampUnsign_Expired_Throws()
    {
        var token = ItsDangerousCompatHelper.TimestampSign("payload", "my-secret", salt: "unit-salt");

        var ex = Assert.Throws<InvalidOperationException>(
            () => ItsDangerousCompatHelper.TimestampUnsign(token, "my-secret", maxAgeSeconds: -1, salt: "unit-salt")
        );

        Assert.Contains("SignatureExpired", ex.Message);
    }

    [Fact]
    public void BuildArgoPayload_HandlesNonPositiveTimeLimitAndMutatesValue()
    {
        SharedConfig.START_CHALLENGE_TEMPLATE = "wf-template";
        var challenge = new Challenge
        {
            Id = 15,
            Name = "Pwn Test",
            TimeLimit = 0,
            State = "visible",
            UserId = 1,
        };

        var challengeImage = new ChallengeImageDTO
        {
            imageLink = "repo/image:latest",
            exposedPort = "8080",
        };

        var (payload, appName) = ChallengeHelper.BuildArgoPayload(
            challenge,
            -1,
            challengeImage,
            "500m",
            "250m",
            "1Gi",
            "512Mi",
            use_gvisor: true,
            harden_container: false,
            pow_difficulty: "3"
        );

        var parameters = ExtractWorkflowParameters(payload);

        Assert.StartsWith("team-0-15-", appName);
        Assert.Contains("CHALLENGE_TIMEOUT=1m", parameters);
        Assert.Equal(2, challenge.TimeLimit);
    }

    [Fact]
    public void BuildArgoPayload_ContainsSecurityAndResourceParameters()
    {
        SharedConfig.START_CHALLENGE_TEMPLATE = "wf-template";
        var challenge = new Challenge
        {
            Id = 2,
            Name = "Web 101",
            TimeLimit = 5,
            State = "visible",
            UserId = 1,
        };

        var image = new ChallengeImageDTO { imageLink = "repo/web:1", exposedPort = "8081" };
        var (payload, _) = ChallengeHelper.BuildArgoPayload(
            challenge,
            9,
            image,
            "1000m",
            "500m",
            "2Gi",
            "1Gi",
            use_gvisor: false,
            harden_container: true,
            pow_difficulty: "5"
        );

        var parameters = ExtractWorkflowParameters(payload);

        Assert.Contains("USE_GVISOR=false", parameters);
        Assert.Contains("HARDEN_CONTAINER=true", parameters);
        Assert.Contains("CPU_LIMIT=1000m", parameters);
        Assert.Contains("MEMORY_LIMIT=2Gi", parameters);
        Assert.Contains("POW_DIFFICULTY_SECONDS=5", parameters);
        Assert.Contains("CONTAINER_PORT=8081", parameters);
    }

    [Fact]
    public void GenerateChallengeToken_MissingPrivateKey_Throws()
    {
        SharedConfig.PRIVATE_KEY = "   ";

        Assert.Throws<InvalidOperationException>(() =>
            ChallengeHelper.GenerateChallengeToken("route", DateTimeOffset.UtcNow.AddMinutes(1))
        );
    }

    [Fact]
    public void CreateToken_EmbedsExpectedClaims()
    {
        SharedConfig.PRIVATE_KEY = "jwt-secret-key-at-least-16-bytes";
        var helper = new TokenHelper(null!);
        var payload = new AuthInfo { userId = 12, teamId = 34 };

        var jwt = helper.CreateToken(payload, tokenUuid: "uuid-123", expireMinutes: 15);

        var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
        var parsed = handler.ReadJwtToken(jwt);

        Assert.Equal("12", parsed.Claims.First(c => c.Type == "userId").Value);
        Assert.Equal("34", parsed.Claims.First(c => c.Type == "teamId").Value);
        Assert.Equal("uuid-123", parsed.Claims.First(c => c.Type == "tokenUuid").Value);
        Assert.Equal("12", parsed.Claims.First(c => c.Type == System.Security.Claims.ClaimTypes.NameIdentifier).Value);
    }

    [Fact]
    public void CtfTimeHelper_UnixTimeConversions_WorkAsExpected()
    {
        var helper = new CtfTimeHelper(null!);
        var epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var plusTwoSeconds = new DateTime(1970, 1, 1, 0, 0, 2, DateTimeKind.Utc);

        Assert.Equal(0, helper.UnixTime(epoch));
        Assert.Equal(2, helper.UnixTime(plusTwoSeconds));
        Assert.Equal(2000, helper.UnixTimeMillis(plusTwoSeconds));
        Assert.Equal(plusTwoSeconds, helper.UnixTimeToUtc(2));
    }

    [Fact]
    public void CtfTimeHelper_UnixTimeAndIsoFormat_RejectDefaultDate()
    {
        var helper = new CtfTimeHelper(null!);

        Assert.Throws<ArgumentException>(() => helper.UnixTime(default));
        Assert.Throws<ArgumentException>(() => helper.IsoFormat(default));
    }

    [Fact]
    public void DynamicChallengeHelper_LinearCalculation_MatchesExpectedBehavior()
    {
        var challenge = new DynamicChallenge { Initial = 500, Decay = 40, Minimum = 100 };

        var atZero = InvokeDynamicCalculation("Linear", challenge, 0);
        var atThree = InvokeDynamicCalculation("Linear", challenge, 3);

        Assert.Equal(500, atZero);
        Assert.Equal(420, atThree);
    }

    [Fact]
    public void DynamicChallengeHelper_Linear_ClampsToMinimum()
    {
        var challenge = new DynamicChallenge { Initial = 120, Decay = 50, Minimum = 30 };

        var value = InvokeDynamicCalculation("Linear", challenge, 10);

        Assert.Equal(30, value);
    }

    [Fact]
    public void DynamicChallengeHelper_Logarithmic_CalculationAndDecayZeroCase()
    {
        var challenge = new DynamicChallenge { Initial = 500, Decay = 0, Minimum = 100 };

        var value = InvokeDynamicCalculation("Logarithmic", challenge, 2);

        Assert.Equal(100, value);
    }

    [Fact]
    public void DynamicChallengeHelper_Logarithmic_FirstSolverGetsInitialValue()
    {
        var challenge = new DynamicChallenge { Initial = 400, Decay = 7, Minimum = 50 };

        var value = InvokeDynamicCalculation("Logarithmic", challenge, 1);

        Assert.Equal(400, value);
    }

    private static string[] ExtractWorkflowParameters(object payload)
    {
        var submitOptions = payload.GetType().GetProperty("submitOptions")!.GetValue(payload);
        var parameters = submitOptions!.GetType().GetProperty("parameters")!.GetValue(submitOptions);
        return ((IEnumerable<string>)parameters!).ToArray();
    }

    private static int InvokeDynamicCalculation(string methodName, DynamicChallenge challenge, int solveCount)
    {
        var method = typeof(DynamicChallengeHelper).GetMethod(methodName, BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);

        return (int)method!.Invoke(null, new object[] { challenge, solveCount })!;
    }
}