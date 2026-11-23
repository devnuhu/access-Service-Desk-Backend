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
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Reports;
using ServiceDeskAPI.Infrastructure.Sla;
using ServiceDeskAPI.Infrastructure.Tickets;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>What a requester's home needs: suggested requests (recent and popular) and requests waiting on the requester.</summary>
    public class RequesterHomeTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public RequesterHomeTests(ServiceDeskApiFactory factory) => _factory = factory;

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
                { new StringContent("Team report test " + Guid.NewGuid().ToString("N")), "subject" },
                { new StringContent("<p>Please help " + Guid.NewGuid().ToString("N") + ".</p>"), "descriptionHtml" }
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

        private async Task<Guid> RaiseAsRequesterAsync(Lab lab, string user = "test.requester")
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(lab.CategoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("Home test " + Guid.NewGuid().ToString("N")), "subject" },
                { new StringContent("<p>Please help " + Guid.NewGuid().ToString("N") + ".</p>"), "descriptionHtml" }
            };
            return (await Ok<CreatedTicketDto>(await (await As(user)).PostAsync("/api/tickets", form))).Id;
        }

        private async Task<Guid> UserIdAsync(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return (await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().FirstAsync(u => u.UserName == userName)).Id;
        }

        private async Task SetCategoryActiveAsync(Guid categoryId, bool active)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Categories.FirstAsync(c => c.Id == categoryId)).IsActive = active;
            await db.SaveChangesAsync();
        }

        [Fact]
        public async Task Suggestions_show_what_the_person_raised_recently_and_what_is_popular()
        {
            var lab = await NewLabAsync();
            await RaiseAsRequesterAsync(lab);

            var mine = await Ok<CatalogueSuggestionsDto>(await (await As("test.requester")).GetAsync("/api/catalogue/suggestions"));
            var recent = mine.Recent.Single(s => s.CategoryId == lab.CategoryId);
            Assert.False(string.IsNullOrWhiteSpace(recent.CategoryName));
            Assert.False(string.IsNullOrWhiteSpace(recent.DepartmentName));
            Assert.Contains(mine.Popular, s => s.CategoryId == lab.CategoryId);

            // someone who raised nothing has no recent list, but still sees what is popular
            var other = await Ok<CatalogueSuggestionsDto>(await (await As("test.caseworker1")).GetAsync("/api/catalogue/suggestions"));
            Assert.DoesNotContain(other.Recent, s => s.CategoryId == lab.CategoryId);
            Assert.Contains(other.Popular, s => s.CategoryId == lab.CategoryId);
            Assert.True(mine.Recent.Count <= 5 && mine.Popular.Count <= 6);
        }

        [Fact]
        public async Task A_category_that_is_switched_off_is_never_suggested()
        {
            var lab = await NewLabAsync();
            await RaiseAsRequesterAsync(lab);
            await SetCategoryActiveAsync(lab.CategoryId, false);
            try
            {
                var suggestions = await Ok<CatalogueSuggestionsDto>(await (await As("test.requester")).GetAsync("/api/catalogue/suggestions"));
                Assert.DoesNotContain(suggestions.Recent, s => s.CategoryId == lab.CategoryId);
                Assert.DoesNotContain(suggestions.Popular, s => s.CategoryId == lab.CategoryId);
            }
            finally { await SetCategoryActiveAsync(lab.CategoryId, true); }
        }

        [Fact]
        public async Task Requests_waiting_on_the_requester_are_counted_and_stop_counting_when_answered()
        {
            var lab = await NewLabAsync();
            var requester = await UserIdAsync("test.requester");
            async Task<int> WaitingAsync()
            {
                using var scope = _factory.Services.CreateScope();
                return (await scope.ServiceProvider.GetRequiredService<IDashboardService>().SummaryAsync(requester, false)).Mine.WaitingOnMe;
            }

            var before = await WaitingAsync();
            var id = await RaiseAsRequesterAsync(lab);
            Assert.Equal(before, await WaitingAsync());                       // a new ticket is not waiting on anyone

            await ChangeAsync(id, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.Requester; t.PendingSince = DateTime.UtcNow; });
            Assert.Equal(before + 1, await WaitingAsync());

            await ChangeAsync(id, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.ThirdParty; });   // waiting on someone else is not on the requester
            Assert.Equal(before, await WaitingAsync());

            await ChangeAsync(id, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.Requester; });
            await ChangeAsync(id, t => { t.Status = TicketStatus.InProgress; t.PendingReason = null; });
            Assert.Equal(before, await WaitingAsync());
        }
    }
}
