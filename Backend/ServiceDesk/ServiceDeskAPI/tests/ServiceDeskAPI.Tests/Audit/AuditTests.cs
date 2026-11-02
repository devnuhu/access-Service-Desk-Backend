using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Audit
{
    /// <summary>Step 1b: the audit log (BRD M10) records sign-ins and cannot be altered.</summary>
    public class AuditTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AuditTests(ServiceDeskApiFactory factory) => _factory = factory;

        [Fact]
        public async Task A_successful_sign_in_is_audited()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.requester");

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.AuditLogs.AnyAsync(a => a.UserId == signIn.UserId && a.Action == AuditAction.Login && a.Module == AuditModule.Authentication));
        }

        [Fact]
        public async Task A_failed_sign_in_is_audited_without_the_password()
        {
            const string wrong = "Wrong-Password#9";
            var response = await ApiTestHelpers.Client(_factory).PostAsync("/api/auth/login",
                System.Net.Http.Json.JsonContent.Create(new { username = "test.hou", password = wrong }));
            Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.AuditLogs.Where(a => a.Action == AuditAction.LoginFailed && a.EntityDisplayName == "test.hou").ToListAsync();
            Assert.NotEmpty(rows);
            Assert.All(rows, r =>
            {
                Assert.DoesNotContain(wrong, r.OldValues ?? string.Empty);
                Assert.DoesNotContain(wrong, r.NewValues ?? string.Empty);
            });
        }

        [Fact]
        public async Task Audit_entries_cannot_be_changed_or_deleted()
        {
            var entityId = Guid.NewGuid();
            using (var scope = _factory.Services.CreateScope())
            {
                var audit = scope.ServiceProvider.GetRequiredService<IAuditService>();
                await audit.LogAsync(null, "System", AuditAction.Created, "Test", entityId, "append-only check", null, null, null, null, AuditModule.System);
            }

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.AuditLogs.SingleAsync(a => a.EntityId == entityId);
                row.EntityDisplayName = "tampered";
                await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            }

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.AuditLogs.Remove(await db.AuditLogs.SingleAsync(a => a.EntityId == entityId));
                await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            }

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.Equal("append-only check", (await db.AuditLogs.SingleAsync(a => a.EntityId == entityId)).EntityDisplayName);
            }
        }

        [Fact]
        public async Task LogAsync_never_saves_the_callers_unsaved_changes()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var audit = scope.ServiceProvider.GetRequiredService<IAuditService>();
            var user = await db.Users.FirstAsync(u => u.UserName == "test.caseworker2");
            var original = user.FullName;
            user.FullName = "Not saved yet";

            await audit.LogAsync(null, "System", AuditAction.Updated, "Test", Guid.NewGuid(), null, null, null, null, null, AuditModule.System);

            using var check = _factory.Services.CreateScope();
            var fresh = await check.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().FirstAsync(u => u.UserName == "test.caseworker2");
            Assert.Equal(original, fresh.FullName);
        }

        [Fact]
        public async Task Stage_saves_together_with_the_change()
        {
            var entityId = Guid.NewGuid();
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var audit = scope.ServiceProvider.GetRequiredService<IAuditService>();
                audit.Stage(null, "System", AuditAction.Created, "Test", entityId, "staged", null, null, null, null, AuditModule.System);
                using (var check = _factory.Services.CreateScope())
                    Assert.False(await check.ServiceProvider.GetRequiredService<AppDbContext>().AuditLogs.AnyAsync(a => a.EntityId == entityId));
                await db.SaveChangesAsync();
            }

            using var after = _factory.Services.CreateScope();
            Assert.True(await after.ServiceProvider.GetRequiredService<AppDbContext>().AuditLogs.AnyAsync(a => a.EntityId == entityId));
        }
    }
}