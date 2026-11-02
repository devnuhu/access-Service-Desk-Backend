using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Hubs;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Pushes new notifications to the recipient's browser (SignalR group "user-{id}") once they are safely saved.
    /// Same pattern as People Hub's NotificationMailInterceptor: collect added rows before the save, act only after it
    /// succeeds, forget them if it fails. Best effort: a failed push never breaks the save; the bell shows it on next load.
    /// </summary>
    public class NotificationPushInterceptor : SaveChangesInterceptor
    {
        private sealed record Outgoing(Guid RecipientUserId, InAppNotificationDto Notification);

        private readonly IHubContext<NotificationHub, INotificationClient> _hub;
        private readonly ILogger<NotificationPushInterceptor> _logger;
        private readonly ConditionalWeakTable<DbContext, List<Outgoing>> _pending = new();

        public NotificationPushInterceptor(IHubContext<NotificationHub, INotificationClient> hub, ILogger<NotificationPushInterceptor> logger)
        {
            _hub = hub;
            _logger = logger;
        }

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
            var items = Take(eventData.Context);
            if (items.Count > 0) _ = PushAsync(items);
            return result;
        }

        public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            var items = Take(eventData.Context);
            if (items.Count > 0) await PushAsync(items);
            return result;
        }

        public override void SaveChangesFailed(DbContextErrorEventData eventData) => Take(eventData.Context);

        public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
        {
            Take(eventData.Context);
            return Task.CompletedTask;
        }

        public static InAppNotificationDto ToDto(InAppNotification n) => new()
        {
            Id = n.Id,
            Title = n.Title,
            Message = n.Message,
            Type = n.Type,
            Category = n.Category,
            RelatedEntityType = n.RelatedEntityType,
            RelatedEntityId = n.RelatedEntityId,
            DeepLinkUrl = n.DeepLinkUrl,
            IsRead = n.IsRead,
            ReadAt = n.ReadAt,
            CreatedAt = n.CreatedAt
        };

        private void Collect(DbContext? context)
        {
            if (context == null) return;
            var list = _pending.GetOrCreateValue(context);
            list.Clear();
            foreach (var entry in context.ChangeTracker.Entries<InAppNotification>())
                if (entry.State == EntityState.Added)
                    list.Add(new Outgoing(entry.Entity.RecipientUserId, ToDto(entry.Entity)));
        }

        private List<Outgoing> Take(DbContext? context)
        {
            if (context == null || !_pending.TryGetValue(context, out var list) || list.Count == 0) return new List<Outgoing>();
            var copy = list.ToList();
            list.Clear();
            return copy;
        }

        private async Task PushAsync(List<Outgoing> items)
        {
            foreach (var item in items)
            {
                try
                {
                    await _hub.Clients.Group(NotificationHub.GroupFor(item.RecipientUserId)).ReceiveNotification(item.Notification);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Live push of notification {Id} failed; it is stored and shows on the next load", item.Notification.Id);
                }
            }
        }
    }
}