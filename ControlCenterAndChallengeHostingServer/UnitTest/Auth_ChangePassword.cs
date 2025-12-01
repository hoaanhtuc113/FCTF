using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using ResourceShared.Utils;
using Xunit;

namespace UnitTest
{
    [Collection("Sequential")]
    public class Auth_ChangePassword : TestBase
    {
        private const string MSG_REQUIRED = "All password fields are required";
        private const string MSG_MISMATCH = "New password and confirm password do not match";
        private const string MSG_USER_NOT_FOUND = "User not found";
        private const string MSG_OLD_WRONG = "Old password is incorrect";
        private const string MSG_SUCCESS = "Password changed successfully";
        private const string MSG_WEAK = "Password is too weak";

        // ============================
        // Helpers for REAL service
        // ============================



        private AuthService CreateService(AppDbContext ctx)
        {
            return new AuthService(ctx, tokenHelper: null!);
        }

        private static ChangePasswordDTO CP(string? oldPwd, string? newPwd, string? confirmPwd)
            => new ChangePasswordDTO
            {
                oldPassword = oldPwd,
                newPassword = newPwd,
                confirmPassword = confirmPwd
            };

        private static void AssertFail(BaseResponseDTO<string> res, string msg)
        {
            Assert.False(res.Success);
            Assert.Equal(msg, res.Message);
            Assert.Null(res.Data);
        }

        private static void AssertOk(BaseResponseDTO<string> res)
        {
            Assert.True(res.Success);
            Assert.Equal(MSG_SUCCESS, res.Message);
            Assert.Equal(MSG_SUCCESS, res.Data);
        }




        [Fact] // 1)  Không nhập old password
        public async Task TC01_ChangePassword_Fail_MissingOldPassword_Null()
        {
            using var ctx = CreateContext(nameof(TC01_ChangePassword_Fail_MissingOldPassword_Null));
            var service = CreateService(ctx);

            var input = CP(null, "123456Aa@", "123456Aa@");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_REQUIRED);
        }


        [Fact] // 2) Thiếu new password
        public async Task TC02_ChangePassword_Fail_MissingNewPassword_Null()
        {
            using var ctx = CreateContext(nameof(TC02_ChangePassword_Fail_MissingNewPassword_Null));
            var service = CreateService(ctx);

            var input = CP("old123456", null, "123456Aa@");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_REQUIRED);
        }


        [Fact] // 3) Thiếu confirm password
        public async Task TC03_ChangePassword_Fail_MissingConfirmPassword_Null()
        {
            using var ctx = CreateContext(nameof(TC03_ChangePassword_Fail_MissingConfirmPassword_Null));
            var service = CreateService(ctx);

            var input = CP("old123456", "123456Aa@", null);

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_REQUIRED);
        }

        [Fact] // 4) confirm password không chính xác
        public async Task TC04_ChangePassword_Fail_NewPasswordNotMatchConfirm()
        {
            using var ctx = CreateContext(nameof(TC04_ChangePassword_Fail_NewPasswordNotMatchConfirm));
            var service = CreateService(ctx);

            var input = CP("old123456", "123456Aa@", "wrongConfirm");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_MISMATCH);
        }

        [Fact] // 5) User không tồn tại
        public async Task TC05_ChangePassword_Fail_UserNotFound()
        {
            using var ctx = CreateContext(nameof(TC05_ChangePassword_Fail_UserNotFound));
            var service = CreateService(ctx);

            var input = CP("old123456", "123456Aa@", "123456Aa@");

            var res = await service.ChangePassword(999, input);

            AssertFail(res, MSG_USER_NOT_FOUND);
        }

        [Fact] // 6) Old password không chính xác
        public async Task TC06_ChangePassword_Fail_OldPasswordIncorrect()
        {
            using var ctx = CreateContext(nameof(TC06_ChangePassword_Fail_OldPasswordIncorrect));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user",
                Password = SHA256Helper.HashPasswordPythonStyle("old123456")
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var input = CP("wrongOld", "123456Aa@", "123456Aa@");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_OLD_WRONG);
        }

        [Fact] // 7) Thay đổi mật khẩu thành công
        public async Task TC10_ChangePassword_Success()
        {
            using var ctx = CreateContext(nameof(TC10_ChangePassword_Success));

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "user",
                Password = SHA256Helper.HashPasswordPythonStyle("old123456")
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var input = CP("old123456", "123456Aa@", "123456Aa@");

            var res = await service.ChangePassword(1, input);

            AssertOk(res);

            var updated = await ctx.Users.FirstAsync(u => u.Id == 1);
            Assert.True(SHA256Helper.VerifyPassword("123456Aa@", updated.Password));
        }


        [Fact] // 8) Thay đổi mật khẩu thất bại - Quá ngắn
        public async Task TC8_ChangePassword_Fail_TooShort()
        {
            using var ctx = CreateContext(nameof(TC8_ChangePassword_Fail_TooShort));

            ctx.Users.Add(new User
            {
                Id = 1,
                Password = SHA256Helper.HashPasswordPythonStyle("old123456")
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var input = CP("old123456", "Ab1!", "Ab1!");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_WEAK);
        }

        [Fact] // 9) Thay đổi mật khẩu thất bại - Thiếu chữ hoa
        public async Task TC9_ChangePassword_Fail_MissingUppercase()
        {
            using var ctx = CreateContext(nameof(TC9_ChangePassword_Fail_MissingUppercase));

            ctx.Users.Add(new User
            {
                Id = 1,
                Password = SHA256Helper.HashPasswordPythonStyle("old123456")
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var input = CP("old123456", "abcd1234!", "abcd1234!");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_WEAK);
        }

        [Fact] // 10) new password thiếu chữ thường
        public async Task TC10_ChangePassword_Fail_MissingLowercase()
        {
            using var ctx = CreateContext(nameof(TC10_ChangePassword_Fail_MissingLowercase));

            ctx.Users.Add(new User
            {
                Id = 1,
                Password = SHA256Helper.HashPasswordPythonStyle("old123456")
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var input = CP("old123456", "ABCD1234!", "ABCD1234!");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_WEAK);
        }

        [Fact] // 11
        public async Task TC11_ChangePassword_Fail_MissingDigit()
        {
            using var ctx = CreateContext(nameof(TC11_ChangePassword_Fail_MissingDigit));

            ctx.Users.Add(new User
            {
                Id = 1,
                Password = SHA256Helper.HashPasswordPythonStyle("old123456")
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var input = CP("old123456", "Abcdefg!", "Abcdefg!");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_WEAK);
        }

        [Fact] // 12
        public async Task TC12_ChangePassword_Fail_MissingSpecialChar()
        {
            using var ctx = CreateContext(nameof(TC12_ChangePassword_Fail_MissingSpecialChar));

            ctx.Users.Add(new User
            {
                Id = 1,
                Password = SHA256Helper.HashPasswordPythonStyle("old123456")
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var input = CP("old123456", "Abcd1234", "Abcd1234");

            var res = await service.ChangePassword(1, input);

            AssertFail(res, MSG_WEAK);
        }
    }
}
