using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class Hint_GetHintsByChallengeId : TestBase
    {
        private HintService CreateService(AppDbContext ctx)
            => new HintService(ctx, scoreHelper: null!, configHelper: null!);

        private Hint AddHint(AppDbContext ctx, int id, int? challengeId, int? cost)
        {
            var hint = new Hint
            {
                Id = id,
                Type = "standard",
                ChallengeId = challengeId,
                Content = $"Hint {id}",
                Cost = cost,
                Requirements = null
            };
            ctx.Hints.Add(hint);
            return hint;
        }

        /// <summary>
        /// GHINT_001 - Không có hint nào cho challenge -> Size = 0, list rỗng
        /// </summary>
        [Fact]
        public async Task GHINT_001_NoHintsForChallenge_ReturnsEmptyList()
        {
            using var ctx = CreateContext(nameof(GHINT_001_NoHintsForChallenge_ReturnsEmptyList));
            var service = CreateService(ctx);

            var result = await service.GetHintsByChallengeId(challengeId: 10, user: 1);

            Assert.NotNull(result);
            Assert.Equal(0, result.Size);
            Assert.NotNull(result.Hints);
            Assert.Empty(result.Hints);
        }

        /// <summary>
        /// GHINT_002 - Chỉ trả về các hint có ChallengeId đúng
        /// </summary>
        [Fact]
        public async Task GHINT_002_ReturnsOnlyHintsOfGivenChallenge()
        {
            using var ctx = CreateContext(nameof(GHINT_002_ReturnsOnlyHintsOfGivenChallenge));

            // Challenge 10 có 2 hint
            AddHint(ctx, id: 1, challengeId: 10, cost: null);
            AddHint(ctx, id: 2, challengeId: 10, cost: 50);

            // Challenge 20: không được trả về
            AddHint(ctx, id: 3, challengeId: 20, cost: 100);

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetHintsByChallengeId(challengeId: 10, user: 99);

            Assert.NotNull(result);
            Assert.Equal(2, result.Size);
            Assert.Equal(2, result.Hints.Count);

            var ids = result.Hints.Select(h => h.Id).OrderBy(x => x).ToList();
            Assert.Equal(new[] { 1, 2 }, ids);
        }

        /// <summary>
        /// GHINT_003 - Map đúng Id & Cost (kể cả Cost = null, 0, số dương)
        /// </summary>
        [Fact]
        public async Task GHINT_003_MapsIdAndCostCorrectly_IncludingNullAndZero()
        {
            using var ctx = CreateContext(nameof(GHINT_003_MapsIdAndCostCorrectly_IncludingNullAndZero));

            AddHint(ctx, id: 1, challengeId: 10, cost: null);
            AddHint(ctx, id: 2, challengeId: 10, cost: 0);
            AddHint(ctx, id: 3, challengeId: 10, cost: 100);

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetHintsByChallengeId(challengeId: 10, user: 1);

            Assert.NotNull(result);
            Assert.Equal(3, result.Size);
            Assert.Equal(3, result.Hints.Count);

            var h1 = result.Hints.Single(h => h.Id == 1);
            var h2 = result.Hints.Single(h => h.Id == 2);
            var h3 = result.Hints.Single(h => h.Id == 3);

            Assert.Null(h1.Cost);
            Assert.Equal(0, h2.Cost);
            Assert.Equal(100, h3.Cost);
        }

        /// <summary>
        /// GHINT_004 - Hint có ChallengeId = null sẽ không bao giờ được trả về
        /// </summary>
        [Fact]
        public async Task GHINT_004_HintsWithNullChallengeId_AreExcluded()
        {
            using var ctx = CreateContext(nameof(GHINT_004_HintsWithNullChallengeId_AreExcluded));

            // Hint không gắn challenge
            AddHint(ctx, id: 1, challengeId: null, cost: 10);

            // Hint thuộc challenge 10
            AddHint(ctx, id: 2, challengeId: 10, cost: 20);

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetHintsByChallengeId(challengeId: 10, user: 1);

            Assert.NotNull(result);
            Assert.Equal(1, result.Size);
            Assert.Single(result.Hints);
            Assert.Equal(2, result.Hints[0].Id); // chỉ có hint Id=2
        }

        /// <summary>
        /// GHINT_005 - Tham số user hiện tại không ảnh hưởng kết quả (bị ignore)
        /// </summary>
        [Fact]
        public async Task GHINT_005_DifferentUserSameChallenge_SameResult()
        {
            using var ctx = CreateContext(nameof(GHINT_005_DifferentUserSameChallenge_SameResult));

            AddHint(ctx, id: 1, challengeId: 10, cost: 10);
            AddHint(ctx, id: 2, challengeId: 10, cost: 20);
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var resUser1 = await service.GetHintsByChallengeId(challengeId: 10, user: 1);
            var resUser2 = await service.GetHintsByChallengeId(challengeId: 10, user: 999);

            Assert.Equal(resUser1.Size, resUser2.Size);
            Assert.Equal(
                resUser1.Hints.Select(h => h.Id).OrderBy(x => x),
                resUser2.Hints.Select(h => h.Id).OrderBy(x => x)
            );
            Assert.Equal(
                resUser1.Hints.Select(h => h.Cost).OrderBy(x => x),
                resUser2.Hints.Select(h => h.Cost).OrderBy(x => x)
            );
        }
    }
}
