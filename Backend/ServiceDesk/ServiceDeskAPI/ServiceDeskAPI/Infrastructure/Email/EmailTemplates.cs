using System.Globalization;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>A finished email: subject, HTML and plain text.</summary>
    public sealed record EmailMessageParts(string Subject, string Html, string Text);

    /// <summary>
    /// The wording of the Service Desk's own emails (copied from People Hub's EmailTemplates; the HR messages were left out).
    /// Ticket emails are added in Step 8. Change the words here; the look is in EmailLayout.
    /// </summary>
    public static class EmailTemplates
    {
        private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-GB");

        /// <summary>A stored UTC time written in Lagos time (WAT, UTC+1, no daylight saving), as the BRD requires.</summary>
        public static string LagosText(DateTime utc) => utc.AddHours(1).ToString("dddd, d MMMM yyyy 'at' HH:mm", Culture) + " WAT";

        public static EmailMessageParts Build(EmailContent content, EmailBrand? brand = null)
            => new(content.Subject, EmailLayout.RenderHtml(content, brand), EmailLayout.RenderText(content, brand));

        public static EmailMessageParts Test(string requestedBy, EmailBrand? brand = null)
        {
            var b = brand ?? EmailBrand.Current;
            return Build(new EmailContent
            {
                Subject = "Test email from " + b.AppName,
                Heading = "Email is working",
                Preheader = "This is a test message from " + b.AppName + ".",
                Greeting = "Hello,",
                Label = "System check",
                LabelTone = "success",
                Automatic = true,
                Blocks =
                {
                    EmailBlock.Callout("Your " + b.AppName + " email setup works. This message was sent by **" + requestedBy + "** as a test.", "success"),
                    EmailBlock.Details(("Sent by", requestedBy), ("Sent at", LagosText(DateTime.UtcNow)))
                }
            }, b);
        }
    }
}