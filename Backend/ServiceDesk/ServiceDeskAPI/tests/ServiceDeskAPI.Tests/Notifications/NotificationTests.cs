using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Notifications
{
    /// <summary>Step 1b: the notification bell and live push (BRD M6 groundwork).</summary>
    public class NotificationTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public NotificationTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<Guid> NotifyAsync(Guid recipient, string title)
        {
            using var scope = _factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<IInAppNotificationService>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            service.Stage(recipient, title, "Test message", NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", Guid.NewGuid(), "/tickets/test");
            await db.SaveChangesAsync();
            return db.InAppNotifications.Local.Single(n => n.Title == title).Id;
        }

        private HttpClient Bearer(string token)
        {
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }

        [Fact]
        public async Task A_person_sees_their_own_notifications_and_can_mark_them_read()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker1");
            var id = await NotifyAsync(me.UserId, "Ticket assigned to you");
            var client = Bearer(me.AccessToken);

            var list = await client.GetFromJsonAsync<InAppNotificationListDto>("/api/notifications");
            Assert.Contains(list!.Items, n => n.Id == id && !n.IsRead && n.IsActionRequired);
            Assert.True(list.Unread >= 1);

            var read = await client.PatchAsync($"/api/notifications/{id}/read", null);
            Assert.Equal(HttpStatusCode.NoContent, read.StatusCode);

            var all = await client.PatchAsync("/api/notifications/read-all", null);
            Assert.Equal(HttpStatusCode.OK, all.StatusCode);
            var count = await client.GetFromJsonAsync<JsonElement>("/api/notifications/unread-count");
            Assert.Equal(0, count.GetProperty("count").GetInt32());
        }

        [Fact]
        public async Task Nobody_can_mark_someone_elses_notification()
        {
            var owner = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");
            var other = await ApiTestHelpers.SignInAsync(_factory, "test.requester");
            var id = await NotifyAsync(owner.UserId, "Private to case worker two");

            var response = await Bearer(other.AccessToken).PatchAsync($"/api/notifications/{id}/read", null);

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        [Fact]
        public async Task The_unread_count_appears_in_me()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.hod");
            await NotifyAsync(me.UserId, "Escalation level 2");

            var profile = await Bearer(me.AccessToken).GetFromJsonAsync<JsonElement>("/api/auth/me");

            Assert.True(profile.GetProperty("data").GetProperty("unreadNotificationCount").GetInt32() >= 1);
        }

        [Fact]
        public async Task A_saved_notification_is_pushed_live_to_the_recipient()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.hou");
            var connection = new HubConnectionBuilder()
                .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/notifications"), options =>
                {
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                    options.AccessTokenProvider = () => Task.FromResult<string?>(me.AccessToken);
                })
                .Build();
            var received = new TaskCompletionSource<InAppNotificationDto>(TaskCreationOptions.RunContinuationsAsynchronously);
            connection.On<InAppNotificationDto>("ReceiveNotification", n => received.TrySetResult(n));

            await connection.StartAsync();
            try
            {
                Assert.Equal("pong", await connection.InvokeAsync<string>("Ping"));
                var id = await NotifyAsync(me.UserId, "Live push check");

                var finished = await Task.WhenAny(received.Task, Task.Delay(TimeSpan.FromSeconds(15)));
                Assert.Same(received.Task, finished);
                Assert.Equal(id, received.Task.Result.Id);
                Assert.Equal(NotificationCategory.Assignment, received.Task.Result.Category);
            }
            finally
            {
                await connection.DisposeAsync();
            }
        }

        [Fact]
        public async Task The_hub_refuses_anonymous_connections()
        {
            var connection = new HubConnectionBuilder()
                .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/notifications"), options =>
                {
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
                .Build();

            await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
            await connection.DisposeAsync();
        }
    }
}