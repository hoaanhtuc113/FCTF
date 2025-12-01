using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Team;
using ResourceShared.Models;
using ResourceShared.Utils;
using Xunit;

namespace UnitTest
{
    public class TeamService_JoinTeam : TestBase
    {
        /// <summary>
        /// Tạo AppDbContext InMemory cho mỗi test
        /// </summary>
        private AppDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;

            return new AppDbContext(options);
        }

        /// <summary>
        /// Seed config cho CtfTime / CtfEnded và team_size
        /// </summary>
        private void SeedConfig(
            AppDbContext ctx,
            bool ctfOpen = true,
            int teamSizeLimit = 0)
        {
            ctx.Configs.RemoveRange(ctx.Configs);

            var nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            if (ctfOpen)
            {
                // start = 0, end = 0 → CtfTime() = true, CtfEnded() = false
                ctx.Configs.Add(new Config { Key = "start", Value = "0" });
                ctx.Configs.Add(new Config { Key = "end", Value = "0" });
            }
            else
            {
                // Cho end < now → CtfEnded() = true, CtfTime() = false
                ctx.Configs.Add(new Config { Key = "start", Value = "0" });
                ctx.Configs.Add(new Config
                {
                    Key = "end",
                    Value = (nowUnix - 3600).ToString()
                });
            }

            if (teamSizeLimit > 0)
            {
                ctx.Configs.Add(new Config
                {
                    Key = "team_size",
                    Value = teamSizeLimit.ToString()
                });
            }

            ctx.SaveChanges();
        }

        /// <summary>
        /// Tạo TeamService với ConfigHelper + CtfTimeHelper thật, ScoreHelper null
        /// (JoinTeam không dùng ScoreHelper)
        /// </summary>
        private TeamService CreateService(AppDbContext ctx)
        {
            var configHelper = new ConfigHelper(ctx);
            var ctfTimeHelper = new CtfTimeHelper(configHelper);

            return new TeamService(
                context: ctx,
                ctfTimeHelper: ctfTimeHelper,
                configHelper: configHelper,
                scoreHelper: null!
            );
        }

        // ================== TEST CASES CHO JoinTeam ==================

        [Fact]
        public async Task JoinTeam_Fail_When_NotCtfTime()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: false); // CTF đã hết/ngoài giờ

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = null };

            var req = new JoinTeamRequestDTO
            {
                teamName = "TeamA",
                teamPassword = "123"
            };

            var res = await svc.JoinTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("You are not allowed to join a team at this time", res.Message);
        }

        [Fact]
        public async Task JoinTeam_Fail_When_User_Already_In_Team()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: true);

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = 99 };

            var req = new JoinTeamRequestDTO
            {
                teamName = "TeamA",
                teamPassword = "123"
            };

            var res = await svc.JoinTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("You are already in a team", res.Message);
        }

        [Fact]
        public async Task JoinTeam_Fail_When_Wrong_TeamName_Or_Password()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: true);

            // Tạo team với password = "correct"
            var team = new Team
            {
                Id = 1,
                Name = "TeamA",
                Password = SHA256Helper.HashPasswordPythonStyle("correct"),
                Hidden = false,
                Banned = false
            };
            ctx.Teams.Add(team);
            ctx.SaveChanges();

            var svc = CreateService(ctx);
            var user = new User { Id = 2, TeamId = null };

            var req = new JoinTeamRequestDTO
            {
                teamName = "TeamA",
                teamPassword = "wrong"
            };

            var res = await svc.JoinTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("Wrong team name or password", res.Message);
        }

        [Fact]
        public async Task JoinTeam_Fail_When_TeamSizeLimit_Reached()
        {
            using var ctx = CreateContext();
            // Giới hạn team_size = 2
            SeedConfig(ctx, ctfOpen: true, teamSizeLimit: 2);

            var team = new Team
            {
                Id = 1,
                Name = "TeamA",
                Password = SHA256Helper.HashPasswordPythonStyle("123"),
                Hidden = false,
                Banned = false
            };
            ctx.Teams.Add(team);

            // Đã có 2 user trong team
            ctx.Users.Add(new User { Id = 10, Name = "U1", TeamId = team.Id });
            ctx.Users.Add(new User { Id = 11, Name = "U2", TeamId = team.Id });
            ctx.SaveChanges();

            var svc = CreateService(ctx);

            var newUser = new User { Id = 12, Name = "NewUser", TeamId = null };
            ctx.Users.Add(newUser);
            ctx.SaveChanges();

            var req = new JoinTeamRequestDTO
            {
                teamName = "TeamA",
                teamPassword = "123"
            };

            var res = await svc.JoinTeam(req, newUser);

            Assert.False(res.Success);
            Assert.Equal("TeamA has reached the team size limit of 2", res.Message);
        }

        [Fact]
        public async Task JoinTeam_Success_Update_User_TeamId_And_Save()
        {
            using var ctx = CreateContext();
            // Không set team_size → lấy default 0 → không giới hạn
            SeedConfig(ctx, ctfOpen: true, teamSizeLimit: 0);

            var team = new Team
            {
                Id = 1,
                Name = "TeamA",
                Password = SHA256Helper.HashPasswordPythonStyle("123"),
                Hidden = false,
                Banned = false
            };
            ctx.Teams.Add(team);

            var user = new User
            {
                Id = 2,
                Name = "User2",
                TeamId = null
            };
            ctx.Users.Add(user);
            ctx.SaveChanges();

            var svc = CreateService(ctx);

            var req = new JoinTeamRequestDTO
            {
                teamName = "TeamA",
                teamPassword = "123"
            };

            var res = await svc.JoinTeam(req, user);

            Assert.True(res.Success);
            Assert.Equal("Successfully joined the team!", res.Message);
            Assert.Equal(team.Id, user.TeamId);

            // Reload lại từ DB để đảm bảo đã lưu
            var userInDb = ctx.Users.Single(u => u.Id == user.Id);
            Assert.Equal(team.Id, userInDb.TeamId);
        }
    }
}
