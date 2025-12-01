using ContestantBE.Services;
using Moq;
using ResourceShared.DTOs.Challenge;
using Xunit;

namespace UnitTest.CanNotTest
{
    public class Challenge_CheckChallengeStatus
    {
        // ===== Helpers =====

        private ChallengeDeployResponeDTO Resp(
            int status,
            bool success,
            string message,
            object? url = null,
            int timeLimit = 0)
            => new ChallengeDeployResponeDTO
            {
                status = status,
                success = success,
                message = message,
                challenge_url = url,
                time_limit = timeLimit
            };

        private Mock<IChallengeServices> Setup(
            int challengeId,
            int teamId,
            ChallengeDeployResponeDTO output)
        {
            var mock = new Mock<IChallengeServices>();

            mock.Setup(s => s.CheckChallengeStatus(
                    It.Is<int>(cid => cid == challengeId),
                    It.Is<int>(tid => tid == teamId)))
                .ReturnsAsync(output);

            return mock;
        }

        private async Task<ChallengeDeployResponeDTO> Call(
            Mock<IChallengeServices> mock,
            int challengeId,
            int teamId)
            => await mock.Object.CheckChallengeStatus(challengeId, teamId);

        private void VerifyOnce(Mock<IChallengeServices> mock, int challengeId, int teamId)
        {
            mock.Verify(s => s.CheckChallengeStatus(
                    It.Is<int>(cid => cid == challengeId),
                    It.Is<int>(tid => tid == teamId)),
                Times.Once);

            mock.VerifyNoOtherCalls();
        }

        // =========================================
        // 1️⃣ Success – challenge đang RUNNING
        // =========================================
        [Fact]
        public async Task TC01_CheckStatus_Success_Running()
        {
            int challengeId = 200;
            int teamId = 10;

            var output = Resp(
                status: 200,
                success: true,
                message: "Challenge is running",
                url: "http://challenge-url",
                timeLimit: 300);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.True(res.success);
            Assert.Equal(200, res.status);
            Assert.Equal("Challenge is running", res.message);
            Assert.Equal("http://challenge-url", res.challenge_url);
            Assert.Equal(300, res.time_limit);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 2️⃣ Success – challenge đã hoàn thành
        // =========================================
        [Fact]
        public async Task TC02_CheckStatus_Success_Finished()
        {
            int challengeId = 201;
            int teamId = 20;

            var output = Resp(
                status: 200,
                success: true,
                message: "Challenge finished",
                url: "http://challenge-url",
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.True(res.success);
            Assert.Equal(200, res.status);
            Assert.Equal("Challenge finished", res.message);
            Assert.Equal("http://challenge-url", res.challenge_url);
            Assert.Equal(0, res.time_limit);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 3️⃣ body == null → No response from server when checking challenge status
        // =========================================
        [Fact]
        public async Task TC03_CheckStatus_Fail_NoResponseFromServer()
        {
            int challengeId = 202;
            int teamId = 30;

            var output = Resp(
                status: 400,
                success: false,
                message: "No response from server when checking challenge status",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.False(res.success);
            Assert.Equal(400, res.status);
            Assert.Equal("No response from server when checking challenge status", res.message);
            Assert.Null(res.challenge_url);
            Assert.Equal(0, res.time_limit);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 4️⃣ Deserialize thất bại → Failed to parse server response
        // =========================================
        [Fact]
        public async Task TC04_CheckStatus_Fail_FailedToParseServerResponse()
        {
            int challengeId = 203;
            int teamId = 40;

            var output = Resp(
                status: 500,
                success: false,
                message: "Failed to parse server response",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.False(res.success);
            Assert.Equal(500, res.status);
            Assert.Equal("Failed to parse server response", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 5️⃣ HttpRequestException → Connection url failed
        // =========================================
        [Fact]
        public async Task TC05_CheckStatus_Fail_ConnectionUrlFailed()
        {
            int challengeId = 204;
            int teamId = 50;

            var output = Resp(
                status: 502,
                success: false,
                message: "Connection url failed",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.False(res.success);
            Assert.Equal(502, res.status);
            Assert.Equal("Connection url failed", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 6️⃣ 400 BadRequest – Invalid challengeId or teamId
        // =========================================
        [Fact]
        public async Task TC06_CheckStatus_Fail_BadRequestFromApi()
        {
            int challengeId = 205;
            int teamId = 60;

            var output = Resp(
                status: 400,
                success: false,
                message: "Invalid challengeId or teamId",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.False(res.success);
            Assert.Equal(400, res.status);
            Assert.Equal("Invalid challengeId or teamId", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 7️⃣ 403 Forbidden – SecretKey invalid
        // =========================================
        [Fact]
        public async Task TC07_CheckStatus_Fail_Forbidden_SecretKeyInvalid()
        {
            int challengeId = 206;
            int teamId = 70;

            var output = Resp(
                status: 403,
                success: false,
                message: "Forbidden - SecretKey invalid",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.False(res.success);
            Assert.Equal(403, res.status);
            Assert.Equal("Forbidden - SecretKey invalid", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 8️⃣ 404 NotFound – Challenge instance not found
        // =========================================
        [Fact]
        public async Task TC08_CheckStatus_Fail_ChallengeInstanceNotFound()
        {
            int challengeId = 207;
            int teamId = 80;

            var output = Resp(
                status: 404,
                success: false,
                message: "Challenge instance not found",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.False(res.success);
            Assert.Equal(404, res.status);
            Assert.Equal("Challenge instance not found", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 9️⃣ 429 Too Many Requests – bị spam check
        // =========================================
        [Fact]
        public async Task TC09_CheckStatus_Fail_TooManyRequests()
        {
            int challengeId = 208;
            int teamId = 90;

            var output = Resp(
                status: 429,
                success: false,
                message: "Too many status requests. Please try again later.",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.False(res.success);
            Assert.Equal(429, res.status);
            Assert.Equal("Too many status requests. Please try again later.", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, teamId);
        }

        // =========================================
        // 🔟 202 Accepted – Challenge đang được deploy
        // =========================================
        [Fact]
        public async Task TC10_CheckStatus_Success_Accepted_Pending()
        {
            int challengeId = 209;
            int teamId = 100;

            var output = Resp(
                status: 202,
                success: true,
                message: "Challenge deployment is in progress.",
                url: "http://pending-url",
                timeLimit: 0);

            var mock = Setup(challengeId, teamId, output);

            var res = await Call(mock, challengeId, teamId);

            Assert.True(res.success);
            Assert.Equal(202, res.status);
            Assert.Equal("Challenge deployment is in progress.", res.message);
            Assert.Equal("http://pending-url", res.challenge_url);

            VerifyOnce(mock, challengeId, teamId);
        }
    }
}
