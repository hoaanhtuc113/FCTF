using ContestantBE.Services;
using Moq;
using ResourceShared.DTOs.Challenge;
using Xunit;

namespace UnitTest.CanNotTest
{
    public class Challenge_GetAllInstances
    {
        // ===== Helper tạo instance =====
        private ChallengeInstanceDTO MakeInstance(
            int challengeId,
            string name,
            string category,
            string status,
            string podName = "N/A",
            bool ready = false,
            string age = "0s")
        {
            return new ChallengeInstanceDTO
            {
                challenge_id = challengeId,
                challenge_name = name,
                category = category,
                status = status,
                pod_name = podName,
                ready = ready,
                age = age
            };
        }

        private Mock<IChallengeServices> Setup(int teamId, List<ChallengeInstanceDTO> output)
        {
            var mock = new Mock<IChallengeServices>();

            mock.Setup(s => s.GetAllInstances(
                    It.Is<int>(t => t == teamId)))
                .ReturnsAsync(output);

            return mock;
        }

        private async Task<List<ChallengeInstanceDTO>> Call(Mock<IChallengeServices> mock, int teamId)
            => await mock.Object.GetAllInstances(teamId);

        private void VerifyOnce(Mock<IChallengeServices> mock, int teamId)
        {
            mock.Verify(s => s.GetAllInstances(
                    It.Is<int>(t => t == teamId)),
                Times.Once);

            mock.VerifyNoOtherCalls();
        }

        // ================================
        // 1️⃣ Không có instance nào
        // ================================
        [Fact]
        public async Task TC01_GetAllInstances_NoInstances()
        {
            int teamId = 100;
            var mock = Setup(teamId, new List<ChallengeInstanceDTO>());

            var res = await Call(mock, teamId);

            Assert.Empty(res);

            VerifyOnce(mock, teamId);
        }

        // ================================
        // 2️⃣ 1 instance RUNING → ready = true
        // ================================
        [Fact]
        public async Task TC02_GetAllInstances_SingleRunningInstance()
        {
            int teamId = 200;

            var instances = new List<ChallengeInstanceDTO>
            {
                MakeInstance(
                    challengeId: 1,
                    name: "Web Login",
                    category: "Web",
                    status: "RUNING",
                    podName: "web-login-pod",
                    ready: true,
                    age: "120s")
            };

            var mock = Setup(teamId, instances);

            var res = await Call(mock, teamId);

            Assert.Single(res);
            Assert.Equal(1, res[0].challenge_id);
            Assert.Equal("Web Login", res[0].challenge_name);
            Assert.Equal("Web", res[0].category);
            Assert.Equal("RUNING", res[0].status);
            Assert.Equal("web-login-pod", res[0].pod_name);
            Assert.True(res[0].ready);
            Assert.Equal("120s", res[0].age);

            VerifyOnce(mock, teamId);
        }

        // ================================
        // 3️⃣ 1 instance STOPPED → ready = false
        // ================================
        [Fact]
        public async Task TC03_GetAllInstances_SingleStoppedInstance()
        {
            int teamId = 300;

            var instances = new List<ChallengeInstanceDTO>
            {
                MakeInstance(
                    challengeId: 2,
                    name: "Crypto 1",
                    category: "Crypto",
                    status: "STOPPED",
                    podName: "crypto-1-pod",
                    ready: false,
                    age: "500s")
            };

            var mock = Setup(teamId, instances);

            var res = await Call(mock, teamId);

            Assert.Single(res);
            Assert.Equal(2, res[0].challenge_id);
            Assert.Equal("Crypto 1", res[0].challenge_name);
            Assert.Equal("Crypto", res[0].category);
            Assert.Equal("STOPPED", res[0].status);
            Assert.False(res[0].ready);

            VerifyOnce(mock, teamId);
        }

        // ================================
        // 4️⃣ Nhiều instance – mix RUNING / STOPPED / PENDING
        // ================================
        [Fact]
        public async Task TC04_GetAllInstances_MultipleMixedInstances()
        {
            int teamId = 400;

            var instances = new List<ChallengeInstanceDTO>
            {
                MakeInstance(
                    challengeId: 3,
                    name: "Pwn 1",
                    category: "Pwn",
                    status: "RUNING",
                    ready: true,
                    age: "60s"),
                MakeInstance(
                    challengeId: 4,
                    name: "Forensics 1",
                    category: "Forensics",
                    status: "PENDING",
                    ready: false,
                    age: "10s"),
                MakeInstance(
                    challengeId: 5,
                    name: "Misc 1",
                    category: "Misc",
                    status: "STOPPED",
                    ready: false,
                    age: "300s")
            };

            var mock = Setup(teamId, instances);

            var res = await Call(mock, teamId);

            Assert.Equal(3, res.Count);

            // Pwn 1 – running
            Assert.Equal("Pwn 1", res[0].challenge_name);
            Assert.Equal("RUNING", res[0].status);
            Assert.True(res[0].ready);

            // Forensics 1 – pending
            Assert.Equal("Forensics 1", res[1].challenge_name);
            Assert.Equal("PENDING", res[1].status);
            Assert.False(res[1].ready);

            // Misc 1 – stopped
            Assert.Equal("Misc 1", res[2].challenge_name);
            Assert.Equal("STOPPED", res[2].status);
            Assert.False(res[2].ready);

            VerifyOnce(mock, teamId);
        }

        // ================================
        // 5️⃣ Instance có pod_name = "N/A"
        // ================================
        [Fact]
        public async Task TC05_GetAllInstances_InstanceWithPodNameNA()
        {
            int teamId = 500;

            var instances = new List<ChallengeInstanceDTO>
            {
                MakeInstance(
                    challengeId: 6,
                    name: "Web NoPod",
                    category: "Web",
                    status: "RUNING",
                    podName: "N/A",
                    ready: true,
                    age: "30s")
            };

            var mock = Setup(teamId, instances);

            var res = await Call(mock, teamId);

            Assert.Single(res);
            Assert.Equal(6, res[0].challenge_id);
            Assert.Equal("Web NoPod", res[0].challenge_name);
            Assert.Equal("N/A", res[0].pod_name);
            Assert.True(res[0].ready);

            VerifyOnce(mock, teamId);
        }
    }
}
