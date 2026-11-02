using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Email;
using Xunit;

namespace ServiceDeskAPI.Tests.Email
{
    /// <summary>The Access Desk email design: own wordmark, company colours, status label, safe text.</summary>
    public class EmailDesignTests
    {
        private static readonly EmailBrand Brand = new();

        [Fact]
        public void The_header_shows_the_Access_Desk_wordmark_in_the_company_colours()
        {
            var html = EmailTemplates.Test("Test Super Admin", Brand).Html;

            Assert.Contains("Access <span style=\"color:#8DC63F;\">Desk</span>", html);
            Assert.Contains("#003883", html);
            Assert.Contains("#FF8200", html);
            Assert.DoesNotContain("People Hub", html);
        }

        [Fact]
        public void Each_notification_type_gets_its_status_label()
        {
            string Html(NotificationType type) =>
                NotificationEmail.Build("Amaka Obi", "Ticket CP-1 assigned", "Message", type, NotificationCategory.Assignment, "/tickets/1", "https://desk.test", Brand).Html;

            Assert.Contains("Action required", Html(NotificationType.ActionRequired));
            Assert.Contains(">Notification<", Html(NotificationType.Info));
            Assert.Contains(">Update<", Html(NotificationType.Success));
        }

        [Fact]
        public void The_plain_text_version_carries_the_label_and_the_link()
        {
            var text = NotificationEmail.Build("Amaka Obi", "Ticket CP-1 assigned", "Message", NotificationType.ActionRequired,
                NotificationCategory.Assignment, "/tickets/1", "https://desk.test", Brand).Text;

            Assert.Contains("[ACTION REQUIRED]", text);
            Assert.Contains("https://desk.test/tickets/1", text);
            Assert.StartsWith("ACCESS DESK", text);
        }

        [Fact]
        public void A_label_cannot_inject_markup()
        {
            var html = EmailLayout.RenderHtml(new EmailContent { Subject = "s", Heading = "h", Label = "<b>x</b>" }, Brand);
            Assert.DoesNotContain("<b>x</b>", html);
        }
    }
}