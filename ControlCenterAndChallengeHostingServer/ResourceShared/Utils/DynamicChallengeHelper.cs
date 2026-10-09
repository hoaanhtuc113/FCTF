using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using ResourceShared.Models;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{
    public sealed class ScoringConfigurationException : InvalidOperationException
    {
        public ScoringConfigurationException(string message) : base(message) { }
    }

    public static class DynamicChallengeHelper
    {
        // Shared with CTFd: lock this row BEFORE inserting/deleting a solve.
        // Callers use READ COMMITTED and keep the lock until commit/rollback.
        public static async Task LockChallengeForScoring(AppDbContext context, int challengeId)
        {
            var transaction = context.Database.CurrentTransaction
                ?? throw new InvalidOperationException("Scoring requires a transaction");
            await using var command = context.Database.GetDbConnection().CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = "SELECT id FROM challenges WHERE id = @challengeId"
                + (context.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite" ? "" : " FOR UPDATE");
            var parameter = command.CreateParameter();
            parameter.ParameterName = "@challengeId";
            parameter.Value = challengeId;
            command.Parameters.Add(parameter);
            if (await command.ExecuteScalarAsync() == null)
                throw new InvalidOperationException("Challenge does not exist");
        }

        private static async Task<int> GetSolveCount(AppDbContext context, int challengeId)
        {
            var mode = await context.Configs.Where(c => c.Key == "user_mode")
                .Select(c => c.Value).FirstOrDefaultAsync() ?? "users";
            if (mode == "teams")
                return await context.Solves.Join(context.Teams, s => s.TeamId, t => t.Id,
                    (solve, team) => new { solve, team })
                    .CountAsync(x => x.solve.ChallengeId == challengeId
                        && x.team.Hidden == false && x.team.Banned == false);
            if (mode != "users")
                throw new ScoringConfigurationException("Unsupported scoring account mode");
            return await context.Solves.Join(context.Users, s => s.UserId, u => u.Id,
                (solve, user) => new { solve, user })
                .CountAsync(x => x.solve.ChallengeId == challengeId
                    && x.user.Hidden == false && x.user.Banned == false);
        }

        public static string GetRecalcLockKey(int challengeId) =>
            $"challenge:dynamic:recalc:{challengeId}";

        public static int CalculateValue(DynamicChallenge config, int solveCount)
        {
            if (config.Initial is not int initial || config.Minimum is not int minimum
                || config.Decay is not int decay || initial < 0 || minimum < 0
                || minimum > initial || decay < 1
                || (config.Function != "linear" && config.Function != "logarithmic"))
                throw new ScoringConfigurationException("Invalid dynamic scoring configuration");
            var n = Math.Max(0L, (long)solveCount - 1);
            if (config.Function == "linear")
                return (int)Math.Max(minimum, (long)initial - (long)decay * n);
            // Clamp before casting: large solve counts must never overflow int.
            var value = initial + ((double)minimum - initial) / ((double)decay * decay) * ((double)n * n);
            return (int)Math.Ceiling(Math.Clamp(value, minimum, initial));
        }

        // Caller holds the parent row lock. Update participates in its transaction.
        public static async Task<int> RecalculateDynamicChallengeValue(AppDbContext context, int challengeId)
        {
            if (context.Database.CurrentTransaction == null)
                throw new InvalidOperationException("Scoring requires a transaction");
            var challenge = await context.Challenges.AsNoTracking()
                .Include(c => c.DynamicChallenge).FirstOrDefaultAsync(c => c.Id == challengeId)
                ?? throw new InvalidOperationException("Challenge does not exist");
            if (challenge.Type != "dynamic")
            {
                if (challenge.Value < 0)
                    throw new ScoringConfigurationException("Invalid challenge value");
                return challenge.Value ?? 0;
            }
            var config = challenge.DynamicChallenge
                ?? throw new ScoringConfigurationException("Missing dynamic scoring configuration");
            var newValue = CalculateValue(config, await GetSolveCount(context, challengeId));
            await context.Challenges.Where(c => c.Id == challengeId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(c => c.Value, newValue));
            return newValue;
        }
    }
}
