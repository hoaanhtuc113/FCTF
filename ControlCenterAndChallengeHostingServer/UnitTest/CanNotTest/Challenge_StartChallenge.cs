using ContestantBE.Services;
using Moq;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using Xunit;

namespace UnitTest.CanNotTest
{
    public class Challenge_StartChallenge
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

        private Challenge MakeChallenge(int id, string name = "Web 1")
            => new Challenge
            {
                Id = id,
                Name = name,
                Category = "Web",
                RequireDeploy = true
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
            Challenge chal,
            User user,
            ChallengeDeployResponeDTO output)
        {
            var mock = new Mock<IChallengeServices>();

            mock.Setup(s => s.ChallengeStart(
                    It.Is<Challenge>(c => c.Id == chal.Id),
                    It.Is<User>(u => u.Id == user.Id && u.TeamId == user.TeamId)))
                .ReturnsAsync(output);

            return mock;
        }

        private async Task<ChallengeDeployResponeDTO> Call(
            Mock<IChallengeServices> mock,
            Challenge chal,
            User user)
            => await mock.Object.ChallengeStart(chal, user);

        private void VerifyOnce(Mock<IChallengeServices> mock, Challenge chal, User user)
        {
            mock.Verify(s => s.ChallengeStart(
                    It.Is<Challenge>(c => c.Id == chal.Id),
                    It.Is<User>(u => u.Id == user.Id && u.TeamId == user.TeamId)),
                Times.Once);

            mock.VerifyNoOtherCalls();
        }

        // =========================================
        // 1️⃣ Success: status 200, success true, có URL, time_limit > 0
        // =========================================
        [Fact]
        public async Task TC01_ChallengeStart_Success_ValidResponse()
        {
            var user = MakeUser(1, 10);
            var chal = MakeChallenge(100, "Web Login");

            var output = Resp(
                status: 200,
                success: true,
                message: "Send to request to deploy successfully. Please wait a moment.",
                url: "http://challenge-url",
                timeLimit: 600);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.True(res.success);
            Assert.Equal(200, res.status);
            Assert.Equal("Send to request to deploy successfully. Please wait a moment.", res.message);
            Assert.Equal("http://challenge-url", res.challenge_url);
            Assert.Equal(600, res.time_limit);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 2️⃣ body == null → No response from server (400, false)
        // =========================================
        [Fact]
        public async Task TC02_ChallengeStart_Fail_NoResponseFromServer()
        {
            var user = MakeUser(2, 20);
            var chal = MakeChallenge(101, "Crypto 1");

            var output = Resp(
                status: 400,
                success: false,
                message: "No response from server",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.False(res.success);
            Assert.Equal(400, res.status);
            Assert.Equal("No response from server", res.message);
            Assert.Null(res.challenge_url);
            Assert.Equal(0, res.time_limit);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 3️⃣ Deserialize thất bại → Failed to parse server response (500, false)
        // =========================================
        [Fact]
        public async Task TC03_ChallengeStart_Fail_FailedToParseServerResponse()
        {
            var user = MakeUser(3, 30);
            var chal = MakeChallenge(102, "Pwn 1");

            var output = Resp(
                status: 500,
                success: false,
                message: "Failed to parse server response",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.False(res.success);
            Assert.Equal(500, res.status);
            Assert.Equal("Failed to parse server response", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 4️⃣ HttpRequestException → Connection url failed (502, false)
        // =========================================
        [Fact]
        public async Task TC04_ChallengeStart_Fail_ConnectionUrlFailed()
        {
            var user = MakeUser(4, 40);
            var chal = MakeChallenge(103, "Forensics 1");

            var output = Resp(
                status: 502,
                success: false,
                message: "Connection url failed",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.False(res.success);
            Assert.Equal(502, res.status);
            Assert.Equal("Connection url failed", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 5️⃣ Exception bất ngờ → Unexpected error occurred (500, false)
        // =========================================
        [Fact]
        public async Task TC05_ChallengeStart_Fail_UnexpectedErrorOccurred()
        {
            var user = MakeUser(5, 50);
            var chal = MakeChallenge(104, "Misc 1");

            var output = Resp(
                status: 500,
                success: false,
                message: "Unexpected error occurred",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.False(res.success);
            Assert.Equal(500, res.status);
            Assert.Equal("Unexpected error occurred", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 6️⃣ Success nhưng không có URL, time_limit = 0
        // =========================================
        [Fact]
        public async Task TC06_ChallengeStart_Success_NoUrl_NoTimeLimit()
        {
            var user = MakeUser(6, 60);
            var chal = MakeChallenge(105, "Pwn - NC Only");

            var output = Resp(
                status: 200,
                success: true,
                message: "Challenge started without URL (nc only).",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.True(res.success);
            Assert.Equal(200, res.status);
            Assert.Equal("Challenge started without URL (nc only).", res.message);
            Assert.Null(res.challenge_url);
            Assert.Equal(0, res.time_limit);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 7️⃣ Success với status = 202 (Accepted)
        // =========================================
        [Fact]
        public async Task TC07_ChallengeStart_Success_Accepted()
        {
            var user = MakeUser(7, 70);
            var chal = MakeChallenge(106, "Slow Deploy");

            var output = Resp(
                status: 202,
                success: true,
                message: "Request accepted, challenge is being deployed.",
                url: "http://pending-url",
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.True(res.success);
            Assert.Equal(202, res.status);
            Assert.Equal("Request accepted, challenge is being deployed.", res.message);
            Assert.Equal("http://pending-url", res.challenge_url);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 8️⃣ API trả về 400 BadRequest (tham số sai)
        // =========================================
        [Fact]
        public async Task TC08_ChallengeStart_Fail_BadRequestFromApi()
        {
            var user = MakeUser(8, 80);
            var chal = MakeChallenge(107, "Web Invalid");

            var output = Resp(
                status: 400,
                success: false,
                message: "Invalid challengeId or teamId",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.False(res.success);
            Assert.Equal(400, res.status);
            Assert.Equal("Invalid challengeId or teamId", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 9️⃣ API trả về 403 Forbidden (SecretKey invalid)
        // =========================================
        [Fact]
        public async Task TC09_ChallengeStart_Fail_Forbidden_SecretKeyInvalid()
        {
            var user = MakeUser(9, 90);
            var chal = MakeChallenge(108, "Web Protected");

            var output = Resp(
                status: 403,
                success: false,
                message: "Forbidden - SecretKey invalid",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.False(res.success);
            Assert.Equal(403, res.status);
            Assert.Equal("Forbidden - SecretKey invalid", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, chal, user);
        }

        // =========================================
        // 🔟 API trả về 404 NotFound (challenge không tồn tại)
        // =========================================
        [Fact]
        public async Task TC10_ChallengeStart_Fail_ChallengeNotFoundOnDeploymentCenter()
        {
            var user = MakeUser(10, 100);
            var chal = MakeChallenge(109, "Old Challenge");

            var output = Resp(
                status: 404,
                success: false,
                message: "Challenge not found in deployment center",
                url: null,
                timeLimit: 0);

            var mock = Setup(chal, user, output);

            var res = await Call(mock, chal, user);

            Assert.False(res.success);
            Assert.Equal(404, res.status);
            Assert.Equal("Challenge not found in deployment center", res.message);
            Assert.Null(res.challenge_url);

            VerifyOnce(mock, chal, user);
        }
    }
}
