using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace ServiceDeskAPI.Infrastructure.Persistence
{
    /// <summary>
    /// Used only by "dotnet ef" when creating migrations, so it never needs the JWT key or AD settings.
    /// The API itself reads ConnectionStrings:DefaultConnection.
    /// </summary>
    public class AppDbContextDesignFactory : IDesignTimeDbContextFactory<AppDbContext>
    {
        public AppDbContext CreateDbContext(string[] args) =>
            new(new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlServer("Server=(localdb)\\MSSQLLocalDB;Database=ServiceDeskDB;Trusted_Connection=True;TrustServerCertificate=True")
                .Options);
    }
}