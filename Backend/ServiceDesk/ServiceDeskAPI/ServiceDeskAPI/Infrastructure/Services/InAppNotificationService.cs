using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>The notification bell, copied from People Hub. Live push happens in NotificationPushInterceptor after a save.</summary>
    public class InAppNotificationService : IInAppNotificationService
    {
        private readonly AppDbContext _context;

        public InAppNotificationService(AppDbContext context) => _context = context;

        public void Stage(Guid recipientUserId, string title, string message, NotificationType type, NotificationCategory category,
            string? relatedEntityType, Guid? relatedEntityId, string? deepLinkUrl)
        {
            _context.InAppNotifications.Add(new InAppNotification
            {
                Id = Guid.NewGuid(),
                RecipientUserId = recipientUserId,
                Title = title.Length > 256 ? title[..256] : title,
                Message = message.Length > 2000 ? message[..2000] : message,
                Type = type,
                Category = category,
                RelatedEntityType = relatedEntityType,
                RelatedEntityId = relatedEntityId,
                DeepLinkUrl = deepLinkUrl, EmailState = NotificationEmailState.Pending,
                CreatedAt = DateTime.UtcNow
            });
        }

        public async Task<List<Guid>> UsersWithRolesAsync(params string[] roles) =>
            await _context.UserRoleAssignments
                .Where(a => a.IsActive && a.User != null && a.User.IsActive && roles.Contains(a.Role!.Name!))
                .Select(a => a.UserId)
                .Distinct()
                .ToListAsync();

        public async Task<InAppNotificationListDto> ListAsync(Guid userId, int page, int pageSize, bool unreadOnly)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var own = _context.InAppNotifications.AsNoTracking().Where(n => n.RecipientUserId == userId);
            var unread = await own.CountAsync(n => !n.IsRead);
            var query = unreadOnly ? own.Where(n => !n.IsRead) : own;
            var total = await query.CountAsync();
            var items = await query
                .OrderByDescending(n => n.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(n => new InAppNotificationDto
                {
                    Id = n.Id, Title = n.Title, Message = n.Message, Type = n.Type, Category = n.Category,
                    RelatedEntityType = n.RelatedEntityType, RelatedEntityId = n.RelatedEntityId, DeepLinkUrl = n.DeepLinkUrl,
                    IsRead = n.IsRead, ReadAt = n.ReadAt, CreatedAt = n.CreatedAt
                })
                .ToListAsync();
            return new InAppNotificationListDto { Items = items, Total = total, Unread = unread, Page = page, PageSize = pageSize };
        }

        public Task<int> UnreadCountAsync(Guid userId) =>
            _context.InAppNotifications.CountAsync(n => n.RecipientUserId == userId && !n.IsRead);

        public async Task<bool> MarkReadAsync(Guid userId, Guid notificationId)
        {
            var notification = await _context.InAppNotifications
                .FirstOrDefaultAsync(n => n.Id == notificationId && n.RecipientUserId == userId);
            if (notification == null) return false;
            if (!notification.IsRead)
            {
                notification.IsRead = true;
                notification.ReadAt = DateTime.UtcNow;
                await _context.SaveChangesAsync();
            }
            return true;
        }

        public Task<int> MarkAllReadAsync(Guid userId)
        {
            var now = DateTime.UtcNow;
            return _context.InAppNotifications
                .Where(n => n.RecipientUserId == userId && !n.IsRead)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true).SetProperty(n => n.ReadAt, (DateTime?)now));
        }
    }
}