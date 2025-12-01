using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace UnitTest
{
    public abstract class TestBase
    {
        protected AppDbContext CreateContext(string testName)
        {
            var opt = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(databaseName: testName)
                .Options;

            return new AppDbContext(opt);
        }
    }
}
