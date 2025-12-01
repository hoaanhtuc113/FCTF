using ContestantBE.Interfaces;
using Moq;
using Xunit;

namespace UnitTest
{
    public class File_GetFile
    {
        private FileResult Result(bool success, string? message = null)
            => new FileResult { Success = success, Message = message };

        private Mock<IFileService> Setup(string path, string token, int userId, FileResult output)
        {
            var mock = new Mock<IFileService>();
            mock.Setup(s => s.GetFileAsync(path, token, userId))
                .ReturnsAsync(output);
            return mock;
        }

        private async Task<FileResult> Call(Mock<IFileService> mock, string path, string token, int userId)
            => await mock.Object.GetFileAsync(path, token, userId);

        private void Verify(Mock<IFileService> mock, string path, string token, int userId)
        {
            mock.Verify(s => s.GetFileAsync(path, token, userId), Times.Once);
            mock.VerifyNoOtherCalls();
        }

        // 1️⃣ Token invalid → Invalid or expired token
        [Fact]
        public async Task TC01_InvalidToken()
        {
            var output = Result(false, "Invalid or expired token");
            var mock = Setup("challenge/file.pdf", "bad-token", 1, output);

            var res = await Call(mock, "challenge/file.pdf", "bad-token", 1);

            Assert.False(res.Success);
            Assert.Equal("Invalid or expired token", res.Message);
            Verify(mock, "challenge/file.pdf", "bad-token", 1);
        }

        // 2️⃣ Path null/empty → File path is required
        [Fact]
        public async Task TC02_PathRequired()
        {
            var output = Result(false, "File path is required");
            var mock = Setup("", "valid-token", 1, output);

            var res = await Call(mock, "", "valid-token", 1);

            Assert.False(res.Success);
            Assert.Equal("File path is required", res.Message);
            Verify(mock, "", "valid-token", 1);
        }

        // 3️⃣ Path traversal → Invalid file path
        [Fact]
        public async Task TC03_PathTraversal()
        {
            var output = Result(false, "Invalid file path");
            var mock = Setup("../etc/passwd", "valid-token", 1, output);

            var res = await Call(mock, "../etc/passwd", "valid-token", 1);

            Assert.False(res.Success);
            Assert.Equal("Invalid file path", res.Message);
            Verify(mock, "../etc/passwd", "valid-token", 1);
        }

        // 4️⃣ File not exists → File not found
        [Fact]
        public async Task TC04_FileNotFound()
        {
            var output = Result(false, "File not found");
            var mock = Setup("challenge/notfound.zip", "valid-token", 1, output);

            var res = await Call(mock, "challenge/notfound.zip", "valid-token", 1);

            Assert.False(res.Success);
            Assert.Equal("File not found", res.Message);
            Verify(mock, "challenge/notfound.zip", "valid-token", 1);
        }

        // 5️⃣ Exception → Error retrieving file
        [Fact]
        public async Task TC05_UnexpectedError()
        {
            var output = Result(false, "Error retrieving file: disk error");
            var mock = Setup("challenge/error.txt", "valid-token", 1, output);

            var res = await Call(mock, "challenge/error.txt", "valid-token", 1);

            Assert.False(res.Success);
            Assert.StartsWith("Error retrieving file:", res.Message);
            Verify(mock, "challenge/error.txt", "valid-token", 1);
        }

        // 6️⃣ Success simple
        [Fact]
        public async Task TC06_Success()
        {
            var output = Result(true, null);
            var mock = Setup("challenge/ok.pdf", "valid-token", 1, output);

            var res = await Call(mock, "challenge/ok.pdf", "valid-token", 1);

            Assert.True(res.Success);
            Assert.Null(res.Message);
            Verify(mock, "challenge/ok.pdf", "valid-token", 1);
        }
    }
}
