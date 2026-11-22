using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The first-response target: a miss is recorded once against the case worker, and the dashboards show it.</summary>
    public class FirstResponseTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public FirstResponseTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, Guid CategoryId, Guid HeadId, Guid WorkerId);

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<Guid> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.fr" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        /// <summary>A unit with a head and one mapped case worker.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "R" + tag, name = "Response Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Response Unit " + tag }));
            var head = await NewUserAsync();
            var worker = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = head }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = worker }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Response category " + tag, timelineHours = 24, defaultPriority = 2 }));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Units.FirstAsync(u => u.Id == unit.Id)).HeadUserId = head;
            db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = category.Id, UserId = worker, IsActive = true, AddedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return new Lab(unit.Id, category.Id, head, worker);
        }

        private async Task<Guid> RaiseAssignedAsync(Lab lab)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(lab.CategoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("First response test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
            for (var i = 0; i < 60; i++)
            {
                using var scope = _factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                if (await db.Tickets.AsNoTracking().AnyAsync(t => t.Id == created.Id && t.AssigneeUserId == lab.WorkerId)) return created.Id;
                await Task.Delay(250);
            }
            throw new Xunit.Sdk.XunitException("The ticket was not assigned to the case worker.");
        }

        private async Task ChangeAsync(Guid ticketId, Action<Ticket> change)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ticket = await db.Tickets.FirstAsync(t => t.Id == ticketId);
            change(ticket);
            await db.SaveChangesAsync();
        }

        private async Task CheckSlaAsync()
        {
            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<ISlaService>().CheckAsync(DateTime.UtcNow);
        }

        private async Task<Ticket> LoadAsync(Guid ticketId)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().FirstAsync(t => t.Id == ticketId);
        }

        [Fact]
        public async Task An_unanswered_ticket_past_the_first_response_time_is_recorded_once_against_the_case_worker()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);

            await CheckSlaAsync();   // just assigned: nothing is due yet
            Assert.Null((await LoadAsync(id)).FirstResponseMissedAt);

            await ChangeAsync(id, t => { t.CreatedAt = DateTime.UtcNow.AddDays(-7); t.AssignedAt = DateTime.UtcNow.AddDays(-7); });
            await CheckSlaAsync();
            var missed = await LoadAsync(id);
            Assert.NotNull(missed.FirstResponseMissedAt);
            Assert.Equal(lab.WorkerId, missed.FirstResponseMissedByUserId);

            await CheckSlaAsync();   // only once
            Assert.Equal(missed.FirstResponseMissedAt, (await LoadAsync(id)).FirstResponseMissedAt);
        }

        [Fact]
        public async Task A_ticket_that_was_answered_is_not_a_miss()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => { t.AssignedAt = DateTime.UtcNow.AddDays(-7); t.FirstRespondedAt = DateTime.UtcNow.AddDays(-7).AddMinutes(30); });
            await CheckSlaAsync();
            Assert.Null((await LoadAsync(id)).FirstResponseMissedAt);
        }

        [Fact]
        public async Task The_unit_dashboard_shows_the_miss_overall_and_per_person()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => { t.CreatedAt = DateTime.UtcNow.AddDays(-7); t.AssignedAt = DateTime.UtcNow.AddDays(-7); });
            await CheckSlaAsync();

            using var scope = _factory.Services.CreateScope();
            var (problem, dashboard) = await scope.ServiceProvider.GetRequiredService<IDashboardService>().UnitAsync(lab.UnitId, lab.HeadId, false);
            Assert.Null(problem);
            Assert.Equal(1, dashboard!.Counts.ResponseOverdue);
            var person = dashboard.Team.Single(m => m.UserId == lab.WorkerId);
            Assert.Equal(1, person.ResponseOverdue);
            Assert.Equal(1, person.ResponseMissed);
            Assert.Equal(0.0, person.ResponseMetPercent);
            Assert.Null(dashboard.Team.Single(m => m.UserId == lab.HeadId).ResponseMetPercent);
        }
    }
}