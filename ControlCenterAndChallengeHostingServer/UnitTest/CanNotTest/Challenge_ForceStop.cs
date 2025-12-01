using ContestantBE.Services;
using Moq;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using Xunit;

namespace UnitTest.CanNotTest
{
    public class Challenge_ForceStop
    {
        // ===== Helpers =====

        private User MakeUser(int id, int teamId)
            => new User
            {
                Id = id,
                Name = $"user_{id}",
                TeamId = teamId,
                Team = new Team
                {
                    Id = teamId,
                    Name = $"Team_{teamId}",
                    CaptainId = id
                }
            };

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
            User user,
            ChallengeDeployResponeDTO output)
        {
            var mock = new Mock<IChallengeServices>();

            mock.Setup(s => s.ForceStopChallenge(
                    It.Is<int>(id => id == challengeId),
                    It.Is<User>(u => u.Id == user.Id && u.TeamId == user.TeamId)))
                .ReturnsAsync(output);

            return mock;
        }

        private async Task<ChallengeDeployResponeDTO> Call(
            Mock<IChallengeServices> mock,
            int challengeId,
            User user)
            => await mock.Object.ForceStopChallenge(challengeId, user);

        private void VerifyOnce(Mock<IChallengeServices> mock, int challengeId, User user)
        {
            mock.Verify(s => s.ForceStopChallenge(
                    It.Is<int>(id => id == challengeId),
                    It.Is<User>(u => u.Id == user.Id && u.TeamId == user.TeamId)),
                Times.Once);

            mock.VerifyNoOtherCalls();
        }

        // =========================================
        // 1️⃣ Stop thành công: 200, success=true
        // =========================================
        [Fact]
        public async Task TC01_ForceStop_Success_ValidResponse()
        {
            var user = MakeUser(1, 10);
            int challengeId = 100;

            var output = Resp(
                status: 200,
                success: true,
                message: "Challenge stopped and resources cleaned up successfully.",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.True(res.success);
            Assert.Equal(200, res.status);
            Assert.Equal("Challenge stopped and resources cleaned up successfully.", res.message);
            Assert.Null(res.challenge_url);
            Assert.Equal(0, res.time_limit);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 2️⃣ body == null → No response from server when stopping challenge
        // =========================================
        [Fact]
        public async Task TC02_ForceStop_Fail_NoResponseFromServer()
        {
            var user = MakeUser(2, 20);
            int challengeId = 101;

            var output = Resp(
                status: 400,
                success: false,
                message: "No response from server when stopping challenge",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(400, res.status);
            Assert.Equal("No response from server when stopping challenge", res.message);
            Assert.Null(res.challenge_url);
            Assert.Equal(0, res.time_limit);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 3️⃣ Deserialize thất bại → Failed to parse server response
        // =========================================
        [Fact]
        public async Task TC03_ForceStop_Fail_FailedToParseServerResponse()
        {
            var user = MakeUser(3, 30);
            int challengeId = 102;

            var output = Resp(
                status: 500,
                success: false,
                message: "Failed to parse server response",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(500, res.status);
            Assert.Equal("Failed to parse server response", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 4️⃣ HttpRequestException → Connection url failed
        // =========================================
        [Fact]
        public async Task TC04_ForceStop_Fail_ConnectionUrlFailed()
        {
            var user = MakeUser(4, 40);
            int challengeId = 103;

            var output = Resp(
                status: 502,
                success: false,
                message: "Connection url failed",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(502, res.status);
            Assert.Equal("Connection url failed", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 5️⃣ API trả về 400 BadRequest (tham số sai)
        // =========================================
        [Fact]
        public async Task TC05_ForceStop_Fail_BadRequestFromApi()
        {
            var user = MakeUser(5, 50);
            int challengeId = 104;

            var output = Resp(
                status: 400,
                success: false,
                message: "Invalid challengeId or teamId",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(400, res.status);
            Assert.Equal("Invalid challengeId or teamId", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 6️⃣ 403 Forbidden – SecretKey invalid
        // =========================================
        [Fact]
        public async Task TC06_ForceStop_Fail_Forbidden_SecretKeyInvalid()
        {
            var user = MakeUser(6, 60);
            int challengeId = 105;

            var output = Resp(
                status: 403,
                success: false,
                message: "Forbidden - SecretKey invalid",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(403, res.status);
            Assert.Equal("Forbidden - SecretKey invalid", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 7️⃣ 404 NotFound – challenge instance không tồn tại / đã stop
        // =========================================
        [Fact]
        public async Task TC07_ForceStop_Fail_ChallengeNotFoundOrStopped()
        {
            var user = MakeUser(7, 70);
            int challengeId = 106;

            var output = Resp(
                status: 404,
                success: false,
                message: "Challenge instance not found or already stopped",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(404, res.status);
            Assert.Equal("Challenge instance not found or already stopped", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 8️⃣ 409 Conflict – Challenge already stopped
        // =========================================
        [Fact]
        public async Task TC08_ForceStop_Fail_AlreadyStopped()
        {
            var user = MakeUser(8, 80);
            int challengeId = 107;

            var output = Resp(
                status: 409,
                success: false,
                message: "Challenge already stopped",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(409, res.status);
            Assert.Equal("Challenge already stopped", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, user);
        }

        // =========================================
        // 9️⃣ 429 Too Many Requests – bị spam stop
        // =========================================
        [Fact]
        public async Task TC09_ForceStop_Fail_TooManyRequests()
        {
            var user = MakeUser(9, 90);
            int challengeId = 108;

            var output = Resp(
                status: 429,
                success: false,
                message: "Too many stop requests. Please try again later.",
                url: null,
                timeLimit: 0);

            var mock = Setup(challengeId, user, output);

            var res = await Call(mock, challengeId, user);

            Assert.False(res.success);
            Assert.Equal(429, res.status);
            Assert.Equal("Too many stop requests. Please try again later.", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, challengeId, user);
        }
    }
}
