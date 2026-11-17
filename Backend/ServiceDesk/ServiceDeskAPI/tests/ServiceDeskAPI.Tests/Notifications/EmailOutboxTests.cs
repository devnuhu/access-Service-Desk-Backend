using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Notifications
{
    /// <summary>Step 8a: the email copy of a notification is sent once, and its outcome is recorded.</summary>
    public class EmailOutboxTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public EmailOutboxTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<Guid> NewUserAsync(bool withEmail)
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.eo" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User
            {
                Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true,
                Email = withEmail ? name + "@test.invalid" : null, CorporateEmail = withEmail ? name + "@test.invalid" : null
            };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private NotificationEmailWorker Worker() => _factory.Services.GetServices<IHostedService>().OfType<NotificationEmailWorker>().Single();

        private async Task<InAppNotification> LoadAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().InAppNotifications.AsNoTracking().FirstAsync(n => n.Id == id);
        }

        private async Task<InAppNotification> WaitForAsync(Guid id, Func<InAppNotification, bool> done)
        {
            for (var i = 0; i < 75; i++)
            {
                var n = await LoadAsync(id);
                if (done(n)) return n;
                await Task.Delay(200);
            }
            return await LoadAsync(id);
        }

        private async Task<Guid> AddRowAsync(Guid userId, NotificationEmailState state, DateTime createdUtc)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = new InAppNotification
            {
                RecipientUserId = userId, Title = "Ticket X-2026-000001 test", Message = "A test message.", Type = NotificationType.Info,
                Category = NotificationCategory.Ticket, EmailState = state, CreatedAt = createdUtc
            };
            db.InAppNotifications.Add(row);
            await db.SaveChangesAsync();
            return row.Id;
        }

        [Fact]
        public async Task A_staged_notification_is_emailed_once_and_recorded_as_sent()
        {
            var user = await NewUserAsync(withEmail: true);
            Guid id;
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                scope.ServiceProvider.GetRequiredService<IInAppNotificationService>().Stage(user, "Ticket X-2026-000002 assigned to you", "Please pick it up.",
                    NotificationType.ActionRequired, NotificationCategory.Ticket, "Ticket", null, "/tickets/X-2026-000002");
                await db.SaveChangesAsync();
                id = await db.InAppNotifications.Where(n => n.RecipientUserId == user).Select(n => n.Id).SingleAsync();
            }

            var sent = await WaitForAsync(id, n => n.EmailState == NotificationEmailState.Sent);
            Assert.Equal(NotificationEmailState.Sent, sent.EmailState);
            Assert.NotNull(sent.EmailSentAt);
            Assert.Equal(1, sent.EmailAttempts);

            await Worker().ProcessAsync(id, true);                                   // asking again changes nothing
            await Worker().ProcessAsync(id, false);
            Assert.Equal(1, (await LoadAsync(id)).EmailAttempts);
        }

        [Fact]
        public async Task A_person_without_an_email_address_is_skipped_with_the_reason()
        {
            var user = await NewUserAsync(withEmail: false);
            var id = await AddRowAsync(user, NotificationEmailState.Pending, DateTime.UtcNow);

            var row = await WaitForAsync(id, n => n.EmailState != NotificationEmailState.Pending);
            Assert.Equal(NotificationEmailState.Skipped, row.EmailState);
            Assert.Contains("no email", row.EmailLastError, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public async Task A_notification_older_than_three_days_is_given_up_and_never_sent()
        {
            var user = await NewUserAsync(withEmail: true);
            var id = await AddRowAsync(user, NotificationEmailState.Pending, DateTime.UtcNow.AddDays(-4));

            var row = await WaitForAsync(id, n => n.EmailState != NotificationEmailState.Pending);
            Assert.Equal(NotificationEmailState.Failed, row.EmailState);
            Assert.Null(row.EmailSentAt);
        }

        [Fact]
        public async Task A_notification_written_before_emails_were_tracked_is_never_emailed()
        {
            var user = await NewUserAsync(withEmail: true);
            var id = await AddRowAsync(user, NotificationEmailState.None, DateTime.UtcNow.AddDays(-1));

            await Worker().ProcessAsync(id, true);
            await Task.Delay(500);
            var row = await LoadAsync(id);
            Assert.Equal(NotificationEmailState.None, row.EmailState);
            Assert.Equal(0, row.EmailAttempts);
        }
    }
}