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
