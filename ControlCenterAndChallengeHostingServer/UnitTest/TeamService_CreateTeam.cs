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
    public class TeamService_CreateTeam : TestBase
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
        /// Seed config cần thiết cho CtfTime / CtfEnded và các config team
        /// </summary>
        private void SeedConfig(
            AppDbContext ctx,
            bool ctfOpen = true,
            bool teamCreationEnabled = true,
            int teamLimit = 0)
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
                // Cho end < now → CtfEnded() = true
                ctx.Configs.Add(new Config { Key = "start", Value = "0" });
                ctx.Configs.Add(new Config
                {
                    Key = "end",
                    Value = (nowUnix - 3600).ToString()
                });
            }

            ctx.Configs.Add(new Config
            {
                Key = "team_creation",
                Value = teamCreationEnabled ? "true" : "false"
            });

            if (teamLimit > 0)
            {
                ctx.Configs.Add(new Config
                {
                    Key = "num_teams",
                    Value = teamLimit.ToString()
                });
            }

            ctx.SaveChanges();
        }

        /// <summary>
        /// Tạo TeamService với ConfigHelper + CtfTimeHelper thật, ScoreHelper null
        /// (CreateTeam không dùng ScoreHelper)
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

        // ============ TEST CASES CHO CreateTeam ============

        [Fact]
        public async Task CreateTeam_Fail_When_NotCtfTime()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: false); // CTF đã hết / ngoài giờ

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = null };

            var req = new CreateTeamRequestDTO
            {
                TeamName = "TeamA",
                TeamPassword = "123"
            };

            var res = await svc.CreateTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("You are not allowed to join a team at this time", res.Message);
        }

        [Fact]
        public async Task CreateTeam_Fail_When_User_Already_In_Team()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: true);

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = 99 }; // đã có team

            var req = new CreateTeamRequestDTO
            {
                TeamName = "TeamA",
                TeamPassword = "123"
            };

            var res = await svc.CreateTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("You are already in a team", res.Message);
        }

        [Fact]
        public async Task CreateTeam_Fail_When_TeamCreation_Disabled()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: true, teamCreationEnabled: false);

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = null };

            var req = new CreateTeamRequestDTO
            {
                TeamName = "TeamA",
                TeamPassword = "123"
            };

            var res = await svc.CreateTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("Team creation is disabled", res.Message);
        }

        [Fact]
        public async Task CreateTeam_Fail_When_Reach_TeamLimit()
        {
            using var ctx = CreateContext();
            // Giới hạn 2 team, DB đã có 2 team visible
            SeedConfig(ctx, ctfOpen: true, teamCreationEnabled: true, teamLimit: 2);

            ctx.Teams.Add(new Team { Name = "T1", Hidden = false, Banned = false });
            ctx.Teams.Add(new Team { Name = "T2", Hidden = false, Banned = false });
            ctx.SaveChanges();

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = null };

            var req = new CreateTeamRequestDTO
            {
                TeamName = "TeamA",
                TeamPassword = "123"
            };

            var res = await svc.CreateTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("Reached the maximum number of teams (2)", res.Message);
        }

        [Fact]
        public async Task CreateTeam_Fail_When_TeamName_Empty()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: true, teamCreationEnabled: true);

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = null };

            var req = new CreateTeamRequestDTO
            {
                TeamName = "   ", // chỉ space
                TeamPassword = "123"
            };

            var res = await svc.CreateTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("Team name is required", res.Message);
        }

        [Fact]
        public async Task CreateTeam_Fail_When_TeamName_Already_Taken()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: true, teamCreationEnabled: true);

            ctx.Teams.Add(new Team { Name = "TeamA", Hidden = false, Banned = false });
            ctx.SaveChanges();

            var svc = CreateService(ctx);
            var user = new User { Id = 1, TeamId = null };

            var req = new CreateTeamRequestDTO
            {
                TeamName = "TeamA",
                TeamPassword = "123"
            };

            var res = await svc.CreateTeam(req, user);

            Assert.False(res.Success);
            Assert.Equal("That team name is already taken", res.Message);
        }

        [Fact]
        public async Task CreateTeam_Success_Creates_Team_And_Assign_User()
        {
            using var ctx = CreateContext();
            SeedConfig(ctx, ctfOpen: true, teamCreationEnabled: true, teamLimit: 0);

            var svc = CreateService(ctx);

            var user = new User
            {
                Id = 1,
                TeamId = null,
                Name = "User1"
            };
            ctx.Users.Add(user);
            ctx.SaveChanges();

            var req = new CreateTeamRequestDTO
            {
                TeamName = "NewTeam",
                TeamPassword = "password",
                Website = "https://example.com",
                Affiliation = "FPT",
                Country = "VN",
                BracketId = 1
            };

            var res = await svc.CreateTeam(req, user);

            Assert.True(res.Success);
            Assert.Equal("Team created successfully", res.Message);
            Assert.NotNull(res.Data);
            Assert.Equal("NewTeam", res.Data.Name);
            Assert.Equal("https://example.com", res.Data.Website);
            Assert.Equal("FPT", res.Data.Affiliation);
            Assert.Equal("VN", res.Data.Country);
            Assert.Equal(1, res.Data.BracketId);

            // Kiểm tra DB thực sự có team và user.TeamId đã set
            var teamInDb = ctx.Teams.SingleOrDefault(t => t.Name == "NewTeam");
            Assert.NotNull(teamInDb);
            Assert.Equal(teamInDb.Id, user.TeamId);
        }
    }
}
