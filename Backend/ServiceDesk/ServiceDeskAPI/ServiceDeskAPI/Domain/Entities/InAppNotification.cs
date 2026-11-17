using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A notification in a person's bell (copied from People Hub). Stored first, then pushed live over SignalR
    /// by NotificationPushInterceptor when the save succeeds.
    /// </summary>
    [Microsoft.EntityFrameworkCore.Index(nameof(EmailState), nameof(CreatedAt))]
    public class InAppNotification
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid RecipientUserId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public NotificationType Type { get; set; } = NotificationType.Info;
        public NotificationCategory Category { get; set; }
        public string? RelatedEntityType { get; set; }
        public Guid? RelatedEntityId { get; set; }
        /// <summary>Web app route opened when the notification is clicked, for example /tickets/{id}.</summary>
        public string? DeepLinkUrl { get; set; }
        public bool IsRead { get; set; }
        public DateTime? ReadAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        /// <summary>The email copy (step 8a). Set to Pending when the notification is staged; the email worker moves it on.</summary>
        public NotificationEmailState EmailState { get; set; }
        public int EmailAttempts { get; set; }
        public DateTime? EmailLastAttemptAt { get; set; }
        public DateTime? EmailSentAt { get; set; }
        public string? EmailLastError { get; set; }

        public User? RecipientUser { get; set; }
    }
}