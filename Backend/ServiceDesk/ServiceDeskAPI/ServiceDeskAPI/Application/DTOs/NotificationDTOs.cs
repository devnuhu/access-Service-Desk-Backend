using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One notification, as listed by GET /api/notifications and pushed over SignalR (ReceiveNotification).</summary>
    public class InAppNotificationDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public NotificationType Type { get; set; }
        public NotificationCategory Category { get; set; }
        public string? RelatedEntityType { get; set; }
        public Guid? RelatedEntityId { get; set; }
        public string? DeepLinkUrl { get; set; }
        public bool IsRead { get; set; }
        public DateTime? ReadAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool IsActionRequired => Type == NotificationType.ActionRequired;
    }

    public class InAppNotificationListDto
    {
        public List<InAppNotificationDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Unread { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }
}