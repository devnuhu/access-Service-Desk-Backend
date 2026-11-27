using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Email;
using Xunit;

namespace ServiceDeskAPI.Tests.Email
{
    public class TicketDetailsEmailTests
    {
        private static EmailMessageParts Build(TicketMailInfo? ticket) =>
            NotificationEmail.Build("Ada Obi", "Ticket CP-2026-000011 resolved", "Your request has been resolved.", NotificationType.Info,
                NotificationCategory.Ticket, "/tickets/CP-2026-000011", "https://desk.test", null, ticket);

        [Fact]
        public void A_ticket_email_shows_the_reference_subject_category_status_and_the_request()
        {
            var parts = Build(new TicketMailInfo("CP-2026-000011", "Reconcile the March schedule", "Account Reconciliation", "In progress", "Please check the March schedule for employer ABC."));
            Assert.Contains("Reconcile the March schedule", parts.Html);
            Assert.Contains("CP-2026-000011", parts.Html);
            Assert.Contains("Account Reconciliation", parts.Html);
            Assert.Contains("In progress", parts.Html);
            Assert.Contains("Please check the March schedule for employer ABC.", parts.Html);
            Assert.Contains("Reconcile the March schedule", parts.Text);
        }

        [Fact]
        public void The_request_text_is_shortened_cleaned_and_never_injects_markup()
        {
            var excerpt = NotificationEmail.Excerpt("  <script>alert(1)</script>\r\n\r\n   " + new string('x', 500));
            Assert.True(excerpt.Length <= 303);
            Assert.EndsWith("...", excerpt);
            Assert.DoesNotContain("\n", excerpt);
            var parts = Build(new TicketMailInfo("CP-2026-000011", "<b>Subject</b>", "Cat", "New", excerpt));
            Assert.DoesNotContain("<script>", parts.Html);
            Assert.DoesNotContain("<b>Subject</b>", parts.Html);
        }

        [Fact]
        public void An_email_that_is_not_about_a_ticket_is_unchanged()
        {
            var parts = Build(null);
            Assert.DoesNotContain("Reconcile", parts.Html);
            Assert.Contains("Your request has been resolved.", parts.Html);
        }

        [Fact]
        public void The_status_reads_naturally()
        {
            Assert.Equal("In progress", NotificationEmail.StatusText(TicketStatus.InProgress));
            Assert.Equal("Pending", NotificationEmail.StatusText(TicketStatus.Pending));
        }
    }
}