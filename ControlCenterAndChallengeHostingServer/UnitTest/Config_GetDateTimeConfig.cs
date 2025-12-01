using ContestantBE.Interfaces;
using Moq;
using ResourceShared.DTOs.Config;
using Xunit;

namespace UnitTest
{
    public class Config_GetDateTimeConfig
    {
        // Helper tạo DTO
        private DateConfigResponseDTO Resp(
            bool isSuccess,
            string message,
            long start = 0,
            long end = 0)
            => new DateConfigResponseDTO
            {
                IsSuccess = isSuccess,
                Message = message,
                StartDate = start,
                EndDate = end
            };

        private Mock<IConfigService> Setup(DateConfigResponseDTO output)
        {
            var mock = new Mock<IConfigService>();

            mock.Setup(s => s.GetDateTimeConfig())
                .ReturnsAsync(output);

            return mock;
        }

        private async Task<DateConfigResponseDTO> Call(Mock<IConfigService> mock)
            => await mock.Object.GetDateTimeConfig();

        private void VerifyOnce(Mock<IConfigService> mock)
        {
            mock.Verify(s => s.GetDateTimeConfig(), Times.Once);
            mock.VerifyNoOtherCalls();
        }

        // =========================================
        // 1️⃣ Case CTF đã kết thúc → "CTF has ended"
        // =========================================
        [Fact]
        public async Task TC01_GetDateTimeConfig_CtfEnded()
        {
            var output = Resp(
                isSuccess: true,
                message: "CTF has ended",
                start: 0,
                end: 0);

            var mock = Setup(output);

            var res = await Call(mock);

            Assert.True(res.IsSuccess);
            Assert.Equal("CTF has ended", res.Message);
            Assert.Equal(0, res.StartDate);
            Assert.Equal(0, res.EndDate);

            VerifyOnce(mock);
        }

        // =========================================
        // 2️⃣ Case đang trong thời gian CTF → "CTFd has been started"
        // =========================================
        [Fact]
        public async Task TC02_GetDateTimeConfig_CtfStarted()
        {
            long start = 1710000000; // mock timestamp
            long end = 1710086400;   // mock timestamp

            var output = Resp(
                isSuccess: true,
                message: "CTFd has been started",
                start: start,
                end: end);

            var mock = Setup(output);

            var res = await Call(mock);

            Assert.True(res.IsSuccess);
            Assert.Equal("CTFd has been started", res.Message);
            Assert.Equal(start, res.StartDate);
            Assert.Equal(end, res.EndDate);

            VerifyOnce(mock);
        }

        // =========================================
        // 3️⃣ Case CTF chưa bắt đầu → "CTFd is coming..."
        // =========================================
        [Fact]
        public async Task TC03_GetDateTimeConfig_CtfComing()
        {
            long start = 1710000000;

            var output = Resp(
                isSuccess: true,
                message: "CTFd is coming...",
                start: start,
                end: 0);

            var mock = Setup(output);

            var res = await Call(mock);

            Assert.True(res.IsSuccess);
            Assert.Equal("CTFd is coming...", res.Message);
            Assert.Equal(start, res.StartDate);
            Assert.Equal(0, res.EndDate);

            VerifyOnce(mock);
        }

        // =========================================
        // 4️⃣ Case cấu hình lỗi / không có start & end
        //    (ToLong trả 0) – vẫn IsSuccess = true
        // =========================================
        [Fact]
        public async Task TC04_GetDateTimeConfig_InvalidConfig_DefaultZero()
        {
            var output = Resp(
                isSuccess: true,
                message: "CTFd has been started",
                start: 0,
                end: 0);

            var mock = Setup(output);

            var res = await Call(mock);

            Assert.True(res.IsSuccess);
            Assert.Equal("CTFd has been started", res.Message);
            Assert.Equal(0, res.StartDate);
            Assert.Equal(0, res.EndDate);

            VerifyOnce(mock);
        }
    }
}
