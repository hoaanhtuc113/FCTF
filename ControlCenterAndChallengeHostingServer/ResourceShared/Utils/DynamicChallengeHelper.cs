using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{
    public static class DynamicChallengeHelper
    {
        /// <summary>
        /// Get solve count for a challenge, excluding hidden and banned accounts
        /// Matches Python: get_solve_count(challenge)
        /// </summary>
        private static async Task<int> GetSolveCount(AppDbContext context, int challengeId)
        {
            var solveCount = await context.Solves
                .Join(context.Users,
                    solve => solve.UserId,
                    user => user.Id,
                    (solve, user) => new { solve, user })
                .Where(x => x.solve.ChallengeId == challengeId 
                    && x.user.Hidden == false 
                    && x.user.Banned == false)
                .CountAsync();

            return solveCount;
        }

        /// <summary>
        /// Linear decay function
        /// value = initial - (decay * (solve_count - 1))
        /// </summary>
        private static int Linear(DynamicChallenge dynamicChallenge, int solveCount)
        {
            // If the solve count is 0 we shouldn't manipulate the solve count
            if (solveCount != 0)
            {
                // We subtract -1 to allow the first solver to get max point value
                solveCount -= 1;
            }

            int value = (dynamicChallenge.Initial ?? 0) - ((dynamicChallenge.Decay ?? 0) * solveCount);
            
            // Ceiling
            value = (int)Math.Ceiling((double)value);

            if (value < dynamicChallenge.Minimum)
            {
                value = dynamicChallenge.Minimum ?? 0;
            }

            return value;
        }

        /// <summary>
        /// Logarithmic decay function (matching Python implementation)
        /// value = ((minimum - initial) / (decay^2)) * (solve_count^2) + initial
        /// </summary>
        private static int Logarithmic(DynamicChallenge dynamicChallenge, int solveCount)
        {
            // If the solve count is 0 we shouldn't manipulate the solve count
            if (solveCount != 0)
            {
                // We subtract -1 to allow the first solver to get max point value
                solveCount -= 1;
            }

            // Handle situations where admins have entered a 0 decay
            // This is invalid as it can cause a division by zero
            int decay = dynamicChallenge.Decay ?? 1;
            if (decay == 0)
            {
                decay = 1;
            }

            int initial = dynamicChallenge.Initial ?? 0;
            int minimum = dynamicChallenge.Minimum ?? 0;

            // Important: Use floating point for math calculations
            double decaySquared = Math.Pow(decay, 2);
            double solveCountSquared = Math.Pow(solveCount, 2);
            
            double value = ((minimum - initial) / decaySquared) * solveCountSquared + initial;
            
            // Ceiling
            int finalValue = (int)Math.Ceiling(value);

            if (finalValue < minimum)
            {
                finalValue = minimum;
            }

            return finalValue;
        }

        /// <summary>
        /// Redis key used to serialize dynamic-score recalcs for a given challenge.
        /// Callers must acquire this lock before <c>BeginTransaction</c> and release it only
        /// after the transaction is disposed, so the snapshot used to read
        /// <c>solveCount</c> and write <c>Challenge.Value</c> cannot overlap across sessions.
        /// </summary>
        public static string GetRecalcLockKey(int challengeId) =>
            $"challenge:dynamic:recalc:{challengeId}";

        /// <summary>
        /// Recalculate dynamic challenge value after a solve.
        /// MUST be called inside an open DB transaction on <paramref name="context"/>, with
        /// the Redis recalc lock (see <see cref="GetRecalcLockKey"/>) already held by the
        /// caller. The <c>SaveChangesAsync</c> inside participates in the caller's transaction
        /// so the <c>Challenge.Value</c> update commits atomically with the submission insert
        /// that triggered the recalc. Retries for transient DB failures are the caller's
        /// responsibility.
        /// </summary>
        public static async Task<int> RecalculateDynamicChallengeValue(
            AppDbContext context,
            int challengeId)
        {
            var challenge = await context.Challenges
                .Include(c => c.DynamicChallenge)
                .FirstOrDefaultAsync(c => c.Id == challengeId);

            if (challenge == null || challenge.DynamicChallenge == null)
            {
                return challenge?.Value ?? 0;
            }

            var dynamicChallenge = challenge.DynamicChallenge;
            var solveCount = await GetSolveCount(context, challengeId);

            string function = (dynamicChallenge.Function ?? "logarithmic").ToLower();
            int newValue = function switch
            {
                "linear" => Linear(dynamicChallenge, solveCount),
                _ => Logarithmic(dynamicChallenge, solveCount),
            };

            challenge.Value = newValue;
            await context.SaveChangesAsync();
            return newValue;
        }
    }
}
