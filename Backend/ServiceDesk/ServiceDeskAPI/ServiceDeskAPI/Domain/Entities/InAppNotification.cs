using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A notification in a person's bell (copied from People Hub). Stored first, then pushed live over SignalR
    /// by NotificationPushInterceptor when the save succeeds.
    /// </summary>
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

        public User? RecipientUser { get; set; }
    }
}