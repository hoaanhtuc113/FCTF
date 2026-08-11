using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Utils;

internal static class DbConfigReader
{
    internal static AppDbContext BuildTempContext(string connectionString)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)))
            .Options;
        return new AppDbContext(options);
    }

    internal static string GetRequired(AppDbContext db, string dbKey, string envKey)
    {
        return GetOptional(db, dbKey, envKey)
            ?? throw new Exception($"Can't read config: key='{dbKey}' not in DB and env '{envKey}' not set");
    }

    // The reverse order of GetOptional: environment first, config table second.
    //
    // For settings that describe the deployment rather than the contest - which
    // KYPO the platform talks to, and as what - the environment is the authority,
    // because setting it means having deployed the platform. A row in the config
    // table is reachable by more people than that, and this is the value that
    // decides where a contestant's Keycloak tokens are sent, so it must not be
    // able to quietly win.
    //
    // The table is still read as a fallback so an install that predates the env
    // vars keeps working instead of losing its KYPO integration at the next
    // rollout. That case is logged: it is a migration state, not a resting one.
    internal static string? GetEnvFirst(AppDbContext db, string dbKey, params string[] envKeys)
    {
        foreach (var envKey in envKeys)
        {
            var val = Environment.GetEnvironmentVariable(envKey);
            if (!string.IsNullOrWhiteSpace(val))
                return val;
        }

        var config = db.Configs.AsNoTracking().FirstOrDefault(c => c.Key == dbKey);
        if (config != null && !string.IsNullOrWhiteSpace(config.Value))
        {
            Console.WriteLine(
                $"[config] '{dbKey}' came from the database because none of [{string.Join(", ", envKeys)}] is set. " +
                "Set it in the environment - run manage.sh option 11 - so the deployment owns this value.");
            return config.Value;
        }

        return null;
    }

    internal static string? GetOptional(AppDbContext db, string dbKey, params string[] envKeys)
    {
        var config = db.Configs.AsNoTracking().FirstOrDefault(c => c.Key == dbKey);
        if (config != null && !string.IsNullOrWhiteSpace(config.Value))
            return config.Value;

        foreach (var envKey in envKeys)
        {
            var val = Environment.GetEnvironmentVariable(envKey);
            if (!string.IsNullOrWhiteSpace(val))
                return val;
        }
        return null;
    }
}
