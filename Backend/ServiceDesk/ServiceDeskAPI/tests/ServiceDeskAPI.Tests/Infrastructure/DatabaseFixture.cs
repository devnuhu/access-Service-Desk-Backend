using Xunit;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>One migrated database per test class. Tests use unique ids, so they do not interfere.</summary>
    public sealed class DatabaseFixture : IAsyncLifetime
    {
        public TestDatabase Db { get; private set; } = null!;

        public async Task InitializeAsync() => Db = await TestDatabase.CreateAsync();

        public async Task DisposeAsync() => await Db.DisposeAsync();
    }
}