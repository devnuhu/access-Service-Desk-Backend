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
using ServiceDeskAPI.Infrastructure.Sla;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The SLA policy: targets per priority with global, department and category levels, edited by the Super Admin, and used by the first-response check.</summary>
    public class SlaPolicyTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public SlaPolicyTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        private async Task SetCreatedAsync(Guid ticketId)
        {
            await ChangeAsync(ticketId, t => { t.CreatedAt = DateTime.UtcNow.AddDays(-14); t.AssignedAt = DateTime.UtcNow.AddDays(-14); });
        }

        [Fact]
        public void The_most_specific_policy_wins_and_the_defaults_apply_when_nothing_is_set()
        {
            var dept = Guid.NewGuid(); var cat = Guid.NewGuid(); var other = Guid.NewGuid();
            var empty = new SlaTargets(new List<SlaPolicy>());
            Assert.Equal((1, 4), empty.For(cat, dept, TicketPriority.Critical));
            Assert.Equal((2, 8), empty.For(cat, dept, TicketPriority.High));
            Assert.Equal((4, 24), empty.For(cat, dept, TicketPriority.Medium));
            Assert.Equal((8, 72), empty.For(cat, dept, TicketPriority.Low));

            var targets = new SlaTargets(new List<SlaPolicy>
            {
                new() { Priority = TicketPriority.Medium, ResponseHours = 6, ResolutionHours = 30 },
                new() { DepartmentId = dept, Priority = TicketPriority.Medium, ResponseHours = 3, ResolutionHours = 20 },
                new() { CategoryId = cat, Priority = TicketPriority.Medium, ResponseHours = 2, ResolutionHours = 10 }
            });
            Assert.Equal((2, 10), targets.For(cat, dept, TicketPriority.Medium));
            Assert.Equal((3, 20), targets.For(other, dept, TicketPriority.Medium));
            Assert.Equal((6, 30), targets.For(other, Guid.NewGuid(), TicketPriority.Medium));
            Assert.Equal((1, 4), targets.For(cat, dept, TicketPriority.Critical));   // another priority falls back to the default
        }

        [Fact]
        public async Task Only_a_Super_Admin_edits_the_service_levels_and_a_reset_returns_to_the_default()
        {
            var admin = await As("test.superadmin");
            Assert.Equal(System.Net.HttpStatusCode.Forbidden, (await (await As("test.hou")).GetAsync("/api/admin/sla-policies")).StatusCode);

            var saved = await Ok<SlaPolicyRowDto>(await admin.PutAsJsonAsync("/api/admin/sla-policies", new { scope = "global", priority = 4, responseHours = 2, resolutionHours = 6 }));
            Assert.Equal(2, saved.ResponseHours);
            var after = await Ok<SlaPoliciesDto>(await admin.GetAsync("/api/admin/sla-policies"));
            var critical = after.Global.Single(r => r.Priority == TicketPriority.Critical);
            Assert.False(critical.IsDefault);
            Assert.Equal(6, critical.ResolutionHours);

            Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/sla-policies", new { scope = "global", priority = 4, responseHours = 8, resolutionHours = 4 })).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/sla-policies", new { scope = "department", priority = 4, responseHours = 1, resolutionHours = 4 })).StatusCode);

            Assert.Equal(System.Net.HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/sla-policies/{saved.Id}")).StatusCode);
            var reset = (await Ok<SlaPoliciesDto>(await admin.GetAsync("/api/admin/sla-policies"))).Global.Single(r => r.Priority == TicketPriority.Critical);
            Assert.True(reset.IsDefault);
            Assert.Equal(1, reset.ResponseHours);
        }

        [Fact]
        public async Task The_response_target_runs_from_submission_and_a_category_override_changes_it()
        {
            var admin = await As("test.superadmin");

            // Default Medium target: 4 working hours, long gone after two weeks
            var plain = await NewLabAsync();
            var late = await RaiseAssignedAsync(plain);
            await SetCreatedAsync(late);
            await CheckSlaAsync();
            var missed = await LoadAsync(late);
            Assert.NotNull(missed.FirstResponseMissedAt);
            Assert.Equal(plain.WorkerId, missed.FirstResponseMissedByUserId);

            // The same wait is fine when this category's Medium response target is 700 working hours
            var generous = await NewLabAsync();
            await Ok<SlaPolicyRowDto>(await admin.PutAsJsonAsync("/api/admin/sla-policies",
                new { scope = "category", categoryId = generous.CategoryId, priority = 2, responseHours = 700, resolutionHours = 1000 }));
            var fine = await RaiseAssignedAsync(generous);
            await SetCreatedAsync(fine);
            await CheckSlaAsync();
            Assert.Null((await LoadAsync(fine)).FirstResponseMissedAt);
        }
    }
}