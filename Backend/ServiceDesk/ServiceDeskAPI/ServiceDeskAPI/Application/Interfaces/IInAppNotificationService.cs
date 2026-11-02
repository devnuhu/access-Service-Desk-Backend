using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The notification bell: writing notifications and reading a person's own (copied from People Hub).</summary>
    public interface IInAppNotificationService
    {
        /// <summary>
        /// Adds a notification to the current unit of work without saving it. When the caller saves, it is stored
        /// and then pushed live to the recipient (NotificationPushInterceptor).
        /// </summary>
        void Stage(Guid recipientUserId, string title, string message, NotificationType type, NotificationCategory category,
            string? relatedEntityType, Guid? relatedEntityId, string? deepLinkUrl);

        /// <summary>The people who currently hold one of these roles (active assignments, active accounts).</summary>
        Task<List<Guid>> UsersWithRolesAsync(params string[] roles);

        Task<InAppNotificationListDto> ListAsync(Guid userId, int page, int pageSize, bool unreadOnly);
        Task<int> UnreadCountAsync(Guid userId);

        /// <summary>Marks one of the person's own notifications read. False when it is not theirs or does not exist.</summary>
        Task<bool> MarkReadAsync(Guid userId, Guid notificationId);
        Task<int> MarkAllReadAsync(Guid userId);
    }
}