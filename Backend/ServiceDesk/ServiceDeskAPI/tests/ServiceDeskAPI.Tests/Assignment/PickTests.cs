using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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

namespace ServiceDeskAPI.Tests.Assignment
{
    /// <summary>The API for these tests with the background assignment worker switched off, so a ticket put back in the pool stays there.</summary>
    public class PickFactory : ServiceDeskApiFactory
    {
        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Assignment:WorkerEnabled"] = "false" }));
        }
    }

    /// <summary>Picking a New ticket from the unit pool: members (mapped categories only) and the head (any category of the unit).</summary>
    public class PickTests : IClassFixture<PickFactory>
    {
        private readonly PickFactory _factory;

        public PickTests(PickFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, Guid HeadId, string HeadName, List<(Guid Id, string Name)> Members, Guid CategoryId);

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<(Guid Id, string Name)> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.pk" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return (user.Id, name);
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        /// <summary>A department of its own: a head, two members, one category, both members mapped to it.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "P" + tag, name = "Pick Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Pick Unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var people = new List<(Guid Id, string Name)>();
            for (var i = 0; i < 2; i++)
            {
                var person = await NewUserAsync();
                await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = person.Id }));
                people.Add(person);
            }
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Pick category " + tag, timelineHours = 24, defaultPriority = 2 }));
            foreach (var person in people)
                await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{person.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(unit.Id, head.Id, head.Name, people, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Pick test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        /// <summary>A raised ticket is auto-assigned; put it back in the pool (New, nobody) the way it looks when nobody could take it.</summary>
        private async Task<CreatedTicketDto> RaiseIntoPoolAsync(Guid categoryId)
        {
            var raised = await RaiseAsync(categoryId);
            // Raising assigns at once (the worker is off in this class); put it back in the pool
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.Tickets.SingleAsync(t => t.Id == raised.Id);
            row.Status = TicketStatus.New;
            row.AssigneeUserId = null;
            row.AssignedAt = null;
            await db.SaveChangesAsync();
            return raised;
        }

        private async Task<Ticket> TicketAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        private static async Task<List<PoolTicketDto>> PoolOf(HttpClient client) =>
            (await Ok<PoolPageDto>(await client.GetAsync("/api/pool?pageSize=100"))).Items.Cast<PoolTicketDto>().ToList();

        [Fact]
        public async Task A_mapped_member_picks_it_and_the_history_audit_and_requester_show_it()
        {
            var lab = await NewLabAsync();
            var raised = await RaiseIntoPoolAsync(lab.CategoryId);
            var member = lab.Members[0];
            var client = await As(member.Name);

            Assert.Contains(await PoolOf(client), p => p.Id == raised.Id);

            var pick = await client.PostAsync($"/api/tickets/{raised.Id}/pick", null);
            Assert.Equal(HttpStatusCode.OK, pick.StatusCode);

            var ticket = await TicketAsync(raised.Id);
            Assert.Equal(TicketStatus.Assigned, ticket.Status);
            Assert.Equal(member.Id, ticket.AssigneeUserId);
            Assert.DoesNotContain(await PoolOf(client), p => p.Id == raised.Id);

            var history = await Ok<List<TicketAssignmentDto>>(await (await As(lab.HeadName)).GetAsync($"/api/tickets/{raised.Id}/assignments"));
            var last = history.OrderBy(h => h.At).Last();
            Assert.Equal(AssignmentMethod.Picked, last.Method);
            Assert.Equal(member.Id, last.To.UserId);
            Assert.Equal(member.Id, last.By!.UserId);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.AuditLogs.AnyAsync(a => a.EntityId == raised.Id && a.Action == AuditAction.Assigned && a.UserId == member.Id));
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == ticket.RequesterUserId && n.RelatedEntityId == raised.Id && n.Title.StartsWith("Ticket " + raised.Reference + " picked up")));
        }

        [Fact]
        public async Task A_member_not_mapped_to_the_category_does_not_see_it_and_cannot_pick_it_but_the_head_can()
        {
            var lab = await NewLabAsync();
            var admin = await As("test.superadmin");
            var unmapped = lab.Members[1];
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{lab.UnitId}/skills/{unmapped.Id}", new { categoryIds = Array.Empty<Guid>() }));
            var raised = await RaiseIntoPoolAsync(lab.CategoryId);

            var memberClient = await As(unmapped.Name);
            Assert.DoesNotContain(await PoolOf(memberClient), p => p.Id == raised.Id);
            Assert.Equal(HttpStatusCode.Forbidden, (await memberClient.PostAsync($"/api/tickets/{raised.Id}/pick", null)).StatusCode);

            var headClient = await As(lab.HeadName);
            Assert.Contains(await PoolOf(headClient), p => p.Id == raised.Id);
            Assert.Equal(HttpStatusCode.OK, (await headClient.PostAsync($"/api/tickets/{raised.Id}/pick", null)).StatusCode);
            Assert.Equal(lab.HeadId, (await TicketAsync(raised.Id)).AssigneeUserId);
        }

        [Fact]
        public async Task Someone_outside_the_unit_cannot_pick_and_cannot_even_see_the_ticket()
        {
            var lab = await NewLabAsync();
            var raised = await RaiseIntoPoolAsync(lab.CategoryId);
            var stranger = await NewUserAsync();
            var client = await As(stranger.Name);

            Assert.Empty(await PoolOf(client));
            Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/tickets/{raised.Id}/pick", null)).StatusCode);
            Assert.Null((await TicketAsync(raised.Id)).AssigneeUserId);
        }

        [Fact]
        public async Task A_ticket_that_is_already_assigned_cannot_be_picked()
        {
            var lab = await NewLabAsync();
            var raised = await RaiseAsync(lab.CategoryId);
            var holderId = (await TicketAsync(raised.Id)).AssigneeUserId!.Value;
            var colleague = lab.Members.Single(m => m.Id != holderId);

            var response = await (await As(colleague.Name)).PostAsync($"/api/tickets/{raised.Id}/pick", null);

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Equal(holderId, (await TicketAsync(raised.Id)).AssigneeUserId);
        }

        [Fact]
        public async Task A_member_on_leave_cannot_pick()
        {
            var lab = await NewLabAsync();
            var member = lab.Members[0];
            DateOnly today;
            using (var scope = _factory.Services.CreateScope())
                today = scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
            // Leave first, so nothing wakes the engine after the ticket is back in the pool
            await Ok<AbsenceDto>(await (await As(lab.HeadName)).PostAsJsonAsync("/api/availability/absences",
                new { userId = member.Id, kind = 1, startDate = today, endDate = today.AddDays(1) }));
            var raised = await RaiseIntoPoolAsync(lab.CategoryId);

            var response = await (await As(member.Name)).PostAsync($"/api/tickets/{raised.Id}/pick", null);

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Null((await TicketAsync(raised.Id)).AssigneeUserId);
        }

        [Fact]
        public async Task Two_people_picking_at_the_same_moment_only_one_gets_it()
        {
            var lab = await NewLabAsync();
            var raised = await RaiseIntoPoolAsync(lab.CategoryId);
            var a = await As(lab.Members[0].Name);
            var b = await As(lab.Members[1].Name);

            var results = await Task.WhenAll(
                a.PostAsync($"/api/tickets/{raised.Id}/pick", null),
                b.PostAsync($"/api/tickets/{raised.Id}/pick", null));

            Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
            Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.Conflict));
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(1, await db.TicketAssignments.CountAsync(x => x.TicketId == raised.Id && x.Method == AssignmentMethod.Picked));
        }
    }
}
