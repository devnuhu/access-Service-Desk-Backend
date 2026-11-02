using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Email
{
    /// <summary>Step 1c: email layout, safety rules, providers, notification emails and the Super Admin email page.</summary>
    public class EmailTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public EmailTests(ServiceDeskApiFactory factory) => _factory = factory;

        private static IConfiguration Config(params (string Key, string? Value)[] values) =>
            new ConfigurationBuilder().AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value))).Build();

        /// <summary>Records what a provider would deliver, after the shared checks of EmailServiceBase.</summary>
        private sealed class CapturingProvider : EmailServiceBase
        {
            public string? Subject;
            public string? Html;

            protected override Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
            {
                Subject = subject;
                Html = htmlBody;
                return Task.FromResult((true, "captured"));
            }
        }

        [Fact]
        public void Names_and_messages_cannot_inject_markup()
        {
            var parts = NotificationEmail.Build("<script>alert(1)</script>", "Title <b>x</b>", "Body <img src=x onerror=alert(1)>",
                NotificationType.Info, NotificationCategory.Ticket, "/tickets/1", "https://servicedesk.test");

            Assert.DoesNotContain("<script>", parts.Html);
            Assert.DoesNotContain("<img src=x", parts.Html);
            Assert.Contains("https://servicedesk.test/tickets/1", parts.Html);
        }

        [Fact]
        public async Task An_RSA_PIN_never_leaves_in_an_email()
        {
            var provider = new CapturingProvider();

            var (ok, _) = await provider.SendEmailAsync("someone@test.invalid", "About PEN100012345678", "<p>Customer PEN100012345678 called</p>");

            Assert.True(ok);
            Assert.DoesNotContain("100012345678", provider.Subject);
            Assert.DoesNotContain("100012345678", provider.Html);
        }

        [Fact]
        public async Task An_invalid_recipient_is_refused_before_any_provider()
        {
            var provider = new CapturingProvider();
            var (ok, _) = await provider.SendEmailAsync("not-an-address", "Subject", "<p>Body</p>");
            Assert.False(ok);
            Assert.Null(provider.Html);
        }

        [Fact]
        public async Task Infobip_never_uses_the_People_Hub_key()
        {
            var old = Environment.GetEnvironmentVariable("INFOBIP_API_KEY");
            Environment.SetEnvironmentVariable("INFOBIP_API_KEY", "people-hub-key-must-not-be-used");
            try
            {
                var service = new InfobipEmailService(new HttpClient(),
                    Config(("EmailSettings:Infobip:BaseUrl", "example.invalid"), ("EmailSettings:Infobip:SenderEmail", "sd@test.invalid")),
                    NullLogger<InfobipEmailService>.Instance);

                var (ok, message) = await service.SendEmailAsync("someone@test.invalid", "Subject", "<p>Body</p>");

                Assert.False(ok);
                Assert.Contains("not set up", message);
            }
            finally
            {
                Environment.SetEnvironmentVariable("INFOBIP_API_KEY", old);
            }
        }

        [Fact]
        public async Task Smtp_without_a_host_is_reported_as_not_set_up()
        {
            var service = new SmtpEmailService(Config(("EmailSettings:Smtp:SenderEmail", "sd@test.invalid")), NullLogger<SmtpEmailService>.Instance);
            var (ok, message) = await service.SendEmailAsync("someone@test.invalid", "Subject", "<p>Body</p>");
            Assert.False(ok);
            Assert.Contains("not set up", message);
        }

        [Fact]
        public void The_provider_is_Off_unless_set()
        {
            Assert.Equal("Off", EmailSetup.Provider(Config()));
            Assert.Equal("Off", EmailSetup.Provider(Config(("EmailSettings:Provider", "something else"))));
            Assert.Equal("Infobip", EmailSetup.Provider(Config(("EmailSettings:Provider", "infobip"))));
            Assert.Equal("Smtp", EmailSetup.Provider(Config(("EmailSettings:Provider", "SMTP"))));
        }

        [Fact]
        public void Notification_emails_can_be_switched_off_or_limited_by_category()
        {
            Assert.True(NotificationMailPolicy.ShouldSend(Config(), NotificationCategory.Ticket));
            Assert.False(NotificationMailPolicy.ShouldSend(Config(("EmailSettings:Notifications:Enabled", "false")), NotificationCategory.Ticket));
            var limited = Config(("EmailSettings:Notifications:ExcludeCategories", "Report, System"));
            Assert.False(NotificationMailPolicy.ShouldSend(limited, NotificationCategory.Report));
            Assert.True(NotificationMailPolicy.ShouldSend(limited, NotificationCategory.Escalation));
        }

        [Fact]
        public async Task A_saved_notification_is_emailed_to_the_recipient()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker1");
            const string title = "Ticket CP-TEST assigned to you";
            using (var scope = _factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<IInAppNotificationService>()
                    .Stage(me.UserId, title, "A new ticket is waiting for you.", NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", Guid.NewGuid(), "/tickets/test");
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().SaveChangesAsync();
            }

            var mail = await _factory.Emails.WaitForAsync(m => m.Subject.Contains(title), TimeSpan.FromSeconds(15));

            Assert.NotNull(mail);
            Assert.Equal("test.caseworker1@test.invalid", mail!.To);
            Assert.StartsWith("Action required: ", mail.Subject);
        }

        [Fact]
        public async Task A_notification_that_was_not_saved_is_not_emailed()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");
            const string title = "Rolled back notification";
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                scope.ServiceProvider.GetRequiredService<IInAppNotificationService>()
                    .Stage(me.UserId, title, "Should never be sent.", NotificationType.Info, NotificationCategory.Ticket, null, null, null);
                // Same save fails on purpose: a role assignment for a role that does not exist breaks the foreign key.
                db.UserRoleAssignments.Add(new Domain.Entities.UserRoleAssignment { Id = Guid.NewGuid(), UserId = me.UserId, RoleId = Guid.NewGuid(), IsActive = true });
                await Assert.ThrowsAnyAsync<Exception>(() => db.SaveChangesAsync());
            }

            var mail = await _factory.Emails.WaitForAsync(m => m.Subject.Contains(title), TimeSpan.FromSeconds(3));
            Assert.Null(mail);
        }

        private HttpClient Bearer(string token)
        {
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }

        [Fact]
        public async Task The_email_status_is_for_Super_Admin_only_and_never_shows_the_key()
        {
            var admin = await ApiTestHelpers.SignInAsync(_factory, "test.superadmin");
            var requester = await ApiTestHelpers.SignInAsync(_factory, "test.requester");

            var denied = await Bearer(requester.AccessToken).GetAsync("/api/admin/email/status");
            var allowed = await Bearer(admin.AccessToken).GetAsync("/api/admin/email/status");
            var body = await allowed.Content.ReadAsStringAsync();

            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
            Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
            Assert.Contains("\"apiKeyConfigured\":true", body);
            Assert.DoesNotContain(ServiceDeskApiFactory.FakeEmailKey, body);
        }

        [Fact]
        public async Task A_Super_Admin_can_send_a_test_email()
        {
            var admin = await ApiTestHelpers.SignInAsync(_factory, "test.superadmin");

            var response = await Bearer(admin.AccessToken).PostAsJsonAsync("/api/admin/email/test", new { to = "check@test.invalid" });
            var bad = await Bearer(admin.AccessToken).PostAsJsonAsync("/api/admin/email/test", new { to = "nonsense" });

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            Assert.NotNull(await _factory.Emails.WaitForAsync(m => m.To == "check@test.invalid" && m.Subject.StartsWith("Test email from"), TimeSpan.FromSeconds(5)));
        }
    }
}