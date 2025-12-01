using ContestantBE.Services;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using ResourceShared.Utils;
using Xunit;

namespace UnitTest
{
    public class Auth_Login : TestBase
    {
        private const string MSG_MISSING = "Missing username or password";
        private const string MSG_INVALID = "Invalid username or password";
        private const string MSG_NOT_ALLOWED = "Your account is not allowed";
        private const string MSG_SUCCESS = "Login successful";

        static Auth_Login()
        {
            // FIX: private key phải có độ dài > 16 bytes
            SharedConfig.PRIVATE_KEY = "UNITTEST_FAKE_PRIVATE_KEY_123456789";
        }

        private LoginDTO Login(string? u, string? p)
            => new LoginDTO { username = u, password = p };

        private void AssertMsg(BaseResponseDTO<AuthResponseDTO> res, string msg)
            => Assert.Equal(msg, res.Message);

        private AuthService CreateService(AppDbContext ctx)
        {
            var tokenHelper = new TokenHelper(ctx);
            return new AuthService(ctx, tokenHelper);
        }

        // ============================================================
        // UTCID01 – SUCCESS
        // ============================================================
        [Fact]
        public async Task UTCID01_Login_Success()
        {
            using var ctx = CreateContext(nameof(UTCID01_Login_Success));

            var team = new Team { Id = 99, Name = "Team A" };
            ctx.Teams.Add(team);

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user1",
                Email = "user1@gmail.com",
                Password = SHA256Helper.HashPasswordPythonStyle("User1@123"),
                Type = "user",
                Hidden = false,
                Banned = false,
                TeamId = 99
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("user1", "User1@123"));

            AssertMsg(res, MSG_SUCCESS);
            Assert.True(res.Success);
            Assert.NotNull(res.Data!.token); // token được tạo thật
        }

        // ============================================================
        // UTCID02 – username = null
        // ============================================================
        [Fact]
        public async Task UTCID02_Username_Null()
        {
            using var ctx = CreateContext(nameof(UTCID02_Username_Null));
            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login(null, "User1@123"));
            AssertMsg(res, MSG_MISSING);
        }

        // ============================================================
        // UTCID03 – password = null
        // ============================================================
        [Fact]
        public async Task UTCID03_Password_Null()
        {
            using var ctx = CreateContext(nameof(UTCID03_Password_Null));
            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("user1", null));
            AssertMsg(res, MSG_MISSING);
        }

        // ============================================================
        // UTCID04 – Wrong password
        // ============================================================
        [Fact]
        public async Task UTCID04_WrongPassword()
        {
            using var ctx = CreateContext(nameof(UTCID04_WrongPassword));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user1",
                Password = SHA256Helper.HashPasswordPythonStyle("User1@123"),
                Type = "user",
                Hidden = false,
                Banned = false
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("user1", "abcxyz"));
            AssertMsg(res, MSG_INVALID);
        }

        // ============================================================
        // UTCID05 – Username does not exist
        // ============================================================
        [Fact]
        public async Task UTCID05_UserNotExist()
        {
            using var ctx = CreateContext(nameof(UTCID05_UserNotExist));
            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("abcxyz", "User1@123"));
            AssertMsg(res, MSG_INVALID);
        }

        // ============================================================
        // UTCID06 – Wrong Type (Admin)
        // ============================================================
        [Fact]
        public async Task UTCID06_AdminType_Invalid()
        {
            using var ctx = CreateContext(nameof(UTCID06_AdminType_Invalid));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "Admin",
                Password = SHA256Helper.HashPasswordPythonStyle("Admin@123"),
                Type = "admin"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("Admin", "Admin@123"));
            AssertMsg(res, MSG_INVALID);
        }

        // ============================================================
        // UTCID07 – Hidden user
        // ============================================================
        [Fact]
        public async Task UTCID07_HiddenUser()
        {
            using var ctx = CreateContext(nameof(UTCID07_HiddenUser));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user1",
                Password = SHA256Helper.HashPasswordPythonStyle("User1@123"),
                Type = "user",
                Hidden = true
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("user1", "User1@123"));
            AssertMsg(res, MSG_NOT_ALLOWED);
        }

        // ============================================================
        // UTCID08 – Banned user
        // ============================================================
        [Fact]
        public async Task UTCID08_BannedUser()
        {
            using var ctx = CreateContext(nameof(UTCID08_BannedUser));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user1",
                Password = SHA256Helper.HashPasswordPythonStyle("User1@123"),
                Type = "user",
                Banned = true
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("user1", "User1@123"));
            AssertMsg(res, MSG_NOT_ALLOWED);
        }

        // ============================================================
        // UTCID09 – No team assigned
        // ============================================================
        [Fact]
        public async Task UTCID09_NoTeam()
        {
            using var ctx = CreateContext(nameof(UTCID09_NoTeam));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user1",
                Password = SHA256Helper.HashPasswordPythonStyle("User1@123"),
                Type = "user",
                Hidden = false,
                Banned = false,
                TeamId = null
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("user1", "User1@123"));
            AssertMsg(res, "you don't have a team yet");
        }

        // ============================================================
        // UTCID10 – Username with spaces (service does NOT trim → FAIL)
        // ============================================================
        [Fact]
        public async Task UTCID10_Username_Spaces_Fail()
        {
            using var ctx = CreateContext(nameof(UTCID10_Username_Spaces_Fail));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user1",
                Password = SHA256Helper.HashPasswordPythonStyle("User1@123"),
                Type = "user"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("    user1    ", "User1@123"));
            AssertMsg(res, MSG_INVALID);
        }

        // ============================================================
        // UTCID11 – Password with spaces
        // ============================================================
        [Fact]
        public async Task UTCID11_Password_Spaces_Fail()
        {
            using var ctx = CreateContext(nameof(UTCID11_Password_Spaces_Fail));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user1",
                Password = SHA256Helper.HashPasswordPythonStyle("User1@123"),
                Type = "user"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.LoginContestant(Login("user1", "   User1@123   "));
            AssertMsg(res, MSG_INVALID);
        }
    }
}
