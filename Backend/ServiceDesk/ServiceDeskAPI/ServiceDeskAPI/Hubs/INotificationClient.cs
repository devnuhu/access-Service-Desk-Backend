using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Hubs
{
    /// <summary>Methods the server calls in the browser. The web app listens for "ReceiveNotification".</summary>
    public interface INotificationClient
    {
        Task ReceiveNotification(InAppNotificationDto notification);
    }
}