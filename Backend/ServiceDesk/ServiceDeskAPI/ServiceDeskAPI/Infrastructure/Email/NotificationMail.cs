using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>One in-app notification that should also reach the person's inbox (copied from People Hub).</summary>
    public sealed record NotificationMail(Guid UserId, string Title, string Message, NotificationType Type, NotificationCategory Category, string? Link, Guid? NotificationId = null)
    {
        public static NotificationMail From(InAppNotification n) => new(n.RecipientUserId, n.Title, n.Message, n.Type, n.Category, n.DeepLinkUrl, n.Id);
    }

    /// <summary>Holds notifications waiting to be emailed. Best effort and in memory: the in-app copy is the record.</summary>
    public sealed class NotificationMailQueue
    {
        private readonly Channel<NotificationMail> _channel = Channel.CreateBounded<NotificationMail>(
            new BoundedChannelOptions(5000) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });

        public bool Enqueue(NotificationMail mail) => _channel.Writer.TryWrite(mail);

        public IAsyncEnumerable<NotificationMail> ReadAllAsync(CancellationToken cancellationToken) => _channel.Reader.ReadAllAsync(cancellationToken);
    }

    /// <summary>
    /// Watches every save. Notifications added in the save are queued for email only after the save succeeded,
    /// so nobody is emailed about something that was rolled back.
    /// </summary>
    public sealed class NotificationMailInterceptor : SaveChangesInterceptor
    {
        private readonly NotificationMailQueue _queue;
        private readonly ConditionalWeakTable<DbContext, List<NotificationMail>> _pending = new();

        public NotificationMailInterceptor(NotificationMailQueue queue) => _queue = queue;

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            Collect(eventData.Context);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Collect(eventData.Context);
            return ValueTask.FromResult(result);
        }

        public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
        {
            Flush(eventData.Context);
            return result;
        }

        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            Flush(eventData.Context);
            return ValueTask.FromResult(result);
        }

        public override void SaveChangesFailed(DbContextErrorEventData eventData) => Discard(eventData.Context);

        public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
        {
            Discard(eventData.Context);
            return Task.CompletedTask;
        }

        private void Collect(DbContext? context)
        {
            if (context == null) return;
            var list = _pending.GetOrCreateValue(context);
            list.Clear();
            foreach (var entry in context.ChangeTracker.Entries<InAppNotification>())
                if (entry.State == EntityState.Added)
                    list.Add(NotificationMail.From(entry.Entity));
        }

        private void Flush(DbContext? context)
        {
            if (context == null || !_pending.TryGetValue(context, out var list)) return;
            foreach (var mail in list) _queue.Enqueue(mail);
            list.Clear();
        }

        private void Discard(DbContext? context)
        {
            if (context != null && _pending.TryGetValue(context, out var list)) list.Clear();
        }
    }

    /// <summary>Settings: EmailSettings:Notifications:Enabled (default true) and :ExcludeCategories (comma list, for example "Report,System").</summary>
    public static class NotificationMailPolicy
    {
        public static bool ShouldSend(IConfiguration config, NotificationCategory category)
        {
            var enabled = config["EmailSettings:Notifications:Enabled"];
            if (!string.IsNullOrWhiteSpace(enabled) && enabled.Trim().Equals("false", StringComparison.OrdinalIgnoreCase)) return false;
            var excluded = (config["EmailSettings:Notifications:ExcludeCategories"] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return !excluded.Any(x => x.Equals(category.ToString(), StringComparison.OrdinalIgnoreCase));
        }
    }

    /// <summary>The ticket an email is about: shown at the top of the email so the person knows what it concerns.</summary>
    public sealed record TicketMailInfo(string Reference, string Subject, string Category, string Status, string Excerpt);

    /// <summary>The wording of the email copy of a notification. The look comes from EmailLayout.</summary>
    public static class NotificationEmail
    {
        /// <summary>Turns an in-app route such as /tickets/123 into a full address. Full addresses are kept as they are.</summary>
        public static string? LinkFor(string? link, string frontendUrl)
        {
            if (string.IsNullOrWhiteSpace(link)) return null;
            var value = link.Trim();
            if (value.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || value.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                return value;
            return frontendUrl.TrimEnd('/') + (value.StartsWith('/') ? value : "/" + value);
        }

        private static string FirstName(string? name) =>
            (name ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;

        /// <summary>The start of the request as one clean line: tags and extra spaces removed, at most 300 characters.</summary>
        public static string Excerpt(string? text)
        {
            var clean = System.Text.RegularExpressions.Regex.Replace(text ?? string.Empty, @"\s+", " ").Trim();
            return clean.Length > 300 ? clean.Substring(0, 300).TrimEnd() + "..." : clean;
        }

        /// <summary>For example In progress.</summary>
        public static string StatusText(TicketStatus status)
        {
            var spaced = System.Text.RegularExpressions.Regex.Replace(status.ToString(), "(?<=[a-z])(?=[A-Z])", " ");
            return spaced.Substring(0, 1) + spaced.Substring(1).ToLowerInvariant();
        }

        public static EmailMessageParts Build(string recipientName, string title, string message, NotificationType type,
            NotificationCategory category, string? link, string frontendUrl, EmailBrand? brand = null, TicketMailInfo? ticket = null)
        {
            var b = brand ?? EmailBrand.Current;
            var preview = message.Length > 140 ? message.Substring(0, 140) + "..." : message;
            var blocks = new List<EmailBlock> { EmailBlock.Paragraph(message) };
            if (ticket != null)
            {
                blocks.Add(EmailBlock.Details(("Ticket", ticket.Reference), ("Subject", ticket.Subject), ("Category", ticket.Category), ("Status", ticket.Status)));
                if (!string.IsNullOrWhiteSpace(ticket.Excerpt))
                    blocks.Add(EmailBlock.Callout("**The request:** " + ticket.Excerpt, "info"));
            }
            if (type == NotificationType.ActionRequired)
                blocks.Add(EmailBlock.Callout("**Action needed.** Please open the ticket and complete your part.", "warning"));
            else if (type == NotificationType.Warning)
                blocks.Add(EmailBlock.Callout("Please review this when you can.", "warning"));
            var url = LinkFor(link, frontendUrl);
            if (url != null) blocks.Add(EmailBlock.Button("Open in " + b.AppName, url));
            blocks.Add(EmailBlock.Note("You are receiving this because you have a part in this ticket. This is an automatic message."));

            var first = FirstName(recipientName);
            return EmailTemplates.Build(new EmailContent
            {
                Subject = (type == NotificationType.ActionRequired ? "Action required: " : string.Empty) + title,
                Heading = title,
                Preheader = preview,
                Greeting = first.Length > 0 ? "Hello " + first + "," : "Hello,",
                Label = type switch
                {
                    NotificationType.ActionRequired => "Action required",
                    NotificationType.Warning => "Attention",
                    NotificationType.Success => "Update",
                    _ => "Notification"
                },
                LabelTone = type switch
                {
                    NotificationType.ActionRequired => "warning",
                    NotificationType.Warning => "warning",
                    NotificationType.Success => "success",
                    _ => "info"
                },
                Automatic = true,
                Blocks = blocks
            }, b);
        }
    }
}
