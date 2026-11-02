using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ServiceDeskAPI.Hubs
{
    /// <summary>
    /// Live notifications at /hubs/notifications (copied from People Hub). Each signed-in connection joins the group
    /// "user-{id}", and NotificationPushInterceptor sends to that group after a notification is saved.
    /// The browser connects with the HttpOnly cookie; other clients may pass ?access_token= or a Bearer header.
    /// </summary>
    [Authorize]
    public class NotificationHub : Hub<INotificationClient>
    {
        private readonly ILogger<NotificationHub> _logger;

        public NotificationHub(ILogger<NotificationHub> logger) => _logger = logger;

        public static string GroupFor(Guid userId) => "user-" + userId;

        public override async Task OnConnectedAsync()
        {
            var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (Guid.TryParse(userId, out var id))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(id));
                _logger.LogDebug("User {UserId} connected to NotificationHub ({ConnectionId})", id, Context.ConnectionId);
            }
            else
            {
                _logger.LogWarning("NotificationHub connection without a user id ({ConnectionId}); it will receive nothing", Context.ConnectionId);
            }
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            if (exception != null)
                _logger.LogWarning(exception, "NotificationHub connection {ConnectionId} closed with an error", Context.ConnectionId);
            await base.OnDisconnectedAsync(exception);
        }

        /// <summary>Keep-alive check from the web app: returns "pong".</summary>
        public string Ping() => "pong";
    }
}