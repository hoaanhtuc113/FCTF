using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ResourceShared.Models;
using ResourceShared.Utils;
using Xunit;

namespace ResourceShared.UnitTests;

public class HelperUnitTests
{
    [Fact]
    public void GenerateMD5Hash_KnownInputs_ReturnExpectedHex()
    {
        var helloHash = MD5Helper.GenerateMD5Hash("hello");
        var emptyHash = MD5Helper.GenerateMD5Hash(string.Empty);

        Assert.Equal("5d41402abc4b2a76b9719d911017c592", helloHash);
        Assert.Equal("d41d8cd98f00b204e9800998ecf8427e", emptyHash);
    }

    [Fact]
    public void ConvertToUnixTimestamp_UsesProvidedDateTime()
    {
        var epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var oneMinute = new DateTime(1970, 1, 1, 0, 1, 0, DateTimeKind.Utc);

        Assert.Equal(0, DateTimeHelper.ConvertToUnixTimestamp(epoch));
        Assert.Equal(60, DateTimeHelper.ConvertToUnixTimestamp(oneMinute));
    }

    [Fact]
    public void GetDateTimeNowInUnix_ReturnsNearCurrentTime()
    {
        var before = DateTimeOffset.Now.ToUnixTimeSeconds();
        var now = DateTimeHelper.GetDateTimeNowInUnix();
        var after = DateTimeOffset.Now.ToUnixTimeSeconds();

        Assert.InRange(now, before - 1, after + 1);
    }

    [Fact]
    public void ParseAlphaNumeric_RemovesAccentsSymbolsAndNormalizesWhitespace()
    {
        var parsed = ChallengeHelper.ParseAlphaNumeric("Café   42!!!");

        Assert.Equal("cafe---42", parsed);
    }

    [Fact]
    public void ParseDeploymentAppName_ParsesValidNameAndMapsZeroTeamToMinusOne()
    {
        var (teamId, challengeId) = ChallengeHelper.ParseDeploymentAppName("team-0-321-example");

        Assert.Equal(-1, teamId);
        Assert.Equal(321, challengeId);
    }

    [Fact]
    public void ParseDeploymentAppName_InvalidPrefix_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() => ChallengeHelper.ParseDeploymentAppName("invalid-1-2"));
    }

    [Fact]
    public void ParseDeploymentAppName_InvalidNumericSegments_ThrowFormatException()
    {
        Assert.Throws<FormatException>(() => ChallengeHelper.ParseDeploymentAppName("team-x-2"));
        Assert.Throws<FormatException>(() => ChallengeHelper.ParseDeploymentAppName("team-1-y"));
    }

    [Fact]
    public void GetCacheKeys_ReturnDeterministicValues()
    {
        Assert.Equal("deploy_challenge_9_3", ChallengeHelper.GetCacheKey(9, 3));
        Assert.Equal("active_deploys_team_3", ChallengeHelper.GetZSetKKey(3));
    }

    [Fact]
    public void ModifyDescription_MultipleChoiceFormat_BuildsRadioMarkup()
    {
        var challenge = new Challenge
        {
            Type = "multiple_choice",
            Description = "What is 2 + 2?\n* () 3\n* () 4"
        };

        var html = ChallengeHelper.ModifyDescription(challenge);

        Assert.Contains("What is 2 + 2?", html);
        Assert.Contains("type=\"radio\"", html);
        Assert.Contains("> 3<", html);
        Assert.Contains("> 4<", html);
    }

    [Fact]
    public void ModifyDescription_InvalidMultipleChoiceFormat_ReturnsOriginalDescription()
    {
        var challenge = new Challenge
        {
            Type = "multiple_choice",
            Description = "Question without options"
        };

        var output = ChallengeHelper.ModifyDescription(challenge);

        Assert.Equal("Question without options", output);
    }

    [Fact]
    public void GenerateChallengeToken_ContainsSignedPayload()
    {
        SharedConfig.PRIVATE_KEY = "unit-test-secret";
        var expiry = DateTimeOffset.FromUnixTimeSeconds(1_700_000_000);

        var token = ChallengeHelper.GenerateChallengeToken("team-1-2-svc.ns.svc.cluster.local:3333", expiry);
        var parts = token.Split('.');

        Assert.Equal(2, parts.Length);

        var payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(parts[0]));
        using var payloadDoc = JsonDocument.Parse(payloadJson);

        Assert.Equal("team-1-2-svc.ns.svc.cluster.local:3333", payloadDoc.RootElement.GetProperty("route").GetString());
        Assert.Equal(1_700_000_000, payloadDoc.RootElement.GetProperty("exp").GetInt64());

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes("unit-test-secret"));
        var expectedSignature = Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(parts[0])));
        Assert.Equal(expectedSignature, parts[1]);
    }

    [Fact]
    public void GetDeploymentAppName_BuildsParsableLowercaseName()
    {
        var appName = ChallengeHelper.GetDeploymentAppName(-1, 8, "Café Name");

        Assert.StartsWith("team-0-8-cafe-name-", appName);
        Assert.Equal(appName.ToLowerInvariant(), appName);

        var (teamId, challengeId) = ChallengeHelper.ParseDeploymentAppName(appName);
        Assert.Equal(-1, teamId);
        Assert.Equal(8, challengeId);
    }

    private static string Base64UrlEncode(byte[] data)
    {
        return Convert.ToBase64String(data)
            .Replace("+", "-")
            .Replace("/", "_")
            .TrimEnd('=');
    }

    private static byte[] Base64UrlDecode(string data)
    {
        var normalized = data.Replace("-", "+").Replace("_", "/");
        normalized = normalized.PadRight(normalized.Length + ((4 - normalized.Length % 4) % 4), '=');
        return Convert.FromBase64String(normalized);
    }
}
