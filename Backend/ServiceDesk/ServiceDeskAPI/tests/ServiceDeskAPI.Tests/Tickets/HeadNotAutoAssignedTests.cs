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
    /// <summary>The head of a unit is never picked by automatic assignment and does not count as cover, even when ticked in the skills matrix.</summary>
    public class HeadNotAutoAssignedTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public HeadNotAutoAssignedTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.hn" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        /// <summary>A unit with a head and one case worker, both members. The head is ticked for the category; the worker only when asked.</summary>
        private async Task<Lab> NewLabAsync(bool tickWorker)
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "H" + tag, name = "Head Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Head Unit " + tag }));
            var head = await NewUserAsync();
            var worker = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = head }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = worker }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Head category " + tag, timelineHours = 24, defaultPriority = 2 }));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var unitRow = await db.Units.FirstAsync(u => u.Id == unit.Id);
            unitRow.HeadUserId = head;
            db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = category.Id, UserId = head, IsActive = true, AddedAt = DateTime.UtcNow });
            if (tickWorker)
                db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = category.Id, UserId = worker, IsActive = true, AddedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return new Lab(unit.Id, category.Id, head, worker);
        }

        private async Task<Guid> RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Head rule test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
            return created.Id;
        }

        private async Task<Guid?> AssigneeAsync(Guid ticketId, int waitSeconds)
        {
            for (var i = 0; i < waitSeconds * 4; i++)
            {
                using var scope = _factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var assignee = await db.Tickets.AsNoTracking().Where(t => t.Id == ticketId).Select(t => t.AssigneeUserId).FirstAsync();
                if (assignee != null) return assignee;
                await Task.Delay(250);
            }
            return null;
        }

        [Fact]
        public async Task Automatic_assignment_skips_a_ticked_head_and_cover_counts_real_case_workers_only()
        {
            var lab = await NewLabAsync(tickWorker: true);
            for (var i = 0; i < 3; i++)
            {
                var ticket = await RaiseAsync(lab.CategoryId);
                Assert.Equal(lab.WorkerId, await AssigneeAsync(ticket, 15));
            }

            using var scope = _factory.Services.CreateScope();
            var catalogue = scope.ServiceProvider.GetRequiredService<ICatalogueService>();
            var eligible = await catalogue.EligibleCaseWorkerIdsAsync(lab.CategoryId);
            Assert.Equal(new[] { lab.WorkerId }, eligible);

            var skills = await catalogue.GetUnitSkillsAsync(lab.UnitId);
            Assert.Equal(1, skills!.Categories.Single(c => c.Id == lab.CategoryId).EligibleCount);
            Assert.Contains(skills.Warnings, w => w.CategoryId == lab.CategoryId);
            Assert.True(skills.Members.Single(m => m.UserId == lab.HeadId).IsHead);
            Assert.False(skills.Members.Single(m => m.UserId == lab.WorkerId).IsHead);
        }

        [Fact]
        public async Task A_head_who_is_the_only_one_ticked_gets_nothing_and_the_ticket_waits_in_the_pool()
        {
            var lab = await NewLabAsync(tickWorker: false);
            var ticket = await RaiseAsync(lab.CategoryId);
            Assert.Null(await AssigneeAsync(ticket, 3));

            using var scope = _factory.Services.CreateScope();
            var catalogue = scope.ServiceProvider.GetRequiredService<ICatalogueService>();
            Assert.Empty(await catalogue.EligibleCaseWorkerIdsAsync(lab.CategoryId));

            var skills = await catalogue.GetUnitSkillsAsync(lab.UnitId);
            Assert.Equal(0, skills!.Categories.Single(c => c.Id == lab.CategoryId).EligibleCount);
            var head = skills.Members.Single(m => m.UserId == lab.HeadId);
            Assert.True(head.IsHead);
            Assert.Contains(lab.CategoryId, head.CategoryIds);   // the tick is kept, just ignored
        }
    }
}