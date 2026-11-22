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
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Impact and urgency on the request, the editable priority matrix, and heads changing a ticket's priority.</summary>
    public class PriorityMatrixTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public PriorityMatrixTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        private async Task<HttpResponseMessage> PostTicketAsync(Lab lab, string? impact, string? urgency, string? priority)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(lab.CategoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("Priority test " + Guid.NewGuid().ToString("N")), "subject" },
                { new StringContent("<p>Please help " + Guid.NewGuid().ToString("N") + ".</p>"), "descriptionHtml" }
            };
            if (impact != null) form.Add(new StringContent(impact), "impact");
            if (urgency != null) form.Add(new StringContent(urgency), "urgency");
            if (priority != null) form.Add(new StringContent(priority), "priority");
            return await (await As("test.requester")).PostAsync("/api/tickets", form);
        }

        private async Task<T> WithService<T>(Func<IPriorityService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<IPriorityService>());
        }

        private async Task<Guid> SuperAdminIdAsync()
        {
            using var scope = _factory.Services.CreateScope();
            return (await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().FirstAsync(u => u.UserName == "test.superadmin")).Id;
        }

        [Fact]
        public void The_default_grid_adds_impact_and_urgency()
        {
            Assert.Equal(TicketPriority.Low, PriorityRules.Default(TicketImpact.JustMe, TicketUrgency.CanWait));
            Assert.Equal(TicketPriority.Low, PriorityRules.Default(TicketImpact.MyTeam, TicketUrgency.CanWait));
            Assert.Equal(TicketPriority.Medium, PriorityRules.Default(TicketImpact.MyTeam, TicketUrgency.Soon));
            Assert.Equal(TicketPriority.Medium, PriorityRules.Default(TicketImpact.JustMe, TicketUrgency.CannotWork));
            Assert.Equal(TicketPriority.High, PriorityRules.Default(TicketImpact.MyDepartment, TicketUrgency.Urgent));
            Assert.Equal(TicketPriority.High, PriorityRules.Default(TicketImpact.WholeCompany, TicketUrgency.Urgent));
            Assert.Equal(TicketPriority.Critical, PriorityRules.Default(TicketImpact.WholeCompany, TicketUrgency.CannotWork));
        }

        [Fact]
        public async Task Raising_with_impact_and_urgency_works_out_the_priority_and_keeps_both_answers()
        {
            var lab = await NewLabAsync();
            // a priority sent alongside is ignored: the two answers decide
            var created = await Ok<CreatedTicketDto>(await PostTicketAsync(lab, "4", "4", "1"));
            var ticket = await LoadAsync(created.Id);
            Assert.Equal(TicketPriority.Critical, ticket.Priority);
            Assert.Equal(TicketImpact.WholeCompany, ticket.Impact);
            Assert.Equal(TicketUrgency.CannotWork, ticket.Urgency);

            var low = await LoadAsync((await Ok<CreatedTicketDto>(await PostTicketAsync(lab, "1", "1", null))).Id);
            Assert.Equal(TicketPriority.Low, low.Priority);
        }

        [Fact]
        public async Task Raising_without_impact_and_urgency_still_uses_the_priority_sent_or_the_category_default()
        {
            var lab = await NewLabAsync();
            var sent = await LoadAsync((await Ok<CreatedTicketDto>(await PostTicketAsync(lab, null, null, "3"))).Id);
            Assert.Equal(TicketPriority.High, sent.Priority);
            Assert.Null(sent.Impact);
            var defaulted = await LoadAsync((await Ok<CreatedTicketDto>(await PostTicketAsync(lab, null, null, null))).Id);
            Assert.Equal(TicketPriority.Medium, defaulted.Priority);   // the category default
        }

        [Fact]
        public async Task Impact_without_urgency_or_a_wrong_value_is_refused_naming_the_field()
        {
            var lab = await NewLabAsync();
            var one = await PostTicketAsync(lab, "2", null, null);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, one.StatusCode);
            Assert.Contains("urgency", await one.Content.ReadAsStringAsync());
            var bad = await PostTicketAsync(lab, "9", "2", null);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, bad.StatusCode);
            Assert.Contains("impact", await bad.Content.ReadAsStringAsync());
        }

        [Fact]
        public async Task A_super_admin_can_edit_the_matrix_and_new_tickets_follow_it()
        {
            var lab = await NewLabAsync();
            var admin = await As("test.superadmin");
            var matrix = await Ok<PriorityMatrixDto>(await admin.GetAsync("/api/priority-matrix"));
            Assert.Equal(16, matrix.Cells.Count);
            Assert.Equal(4, matrix.Impacts.Count);
            Assert.Equal(4, matrix.Urgencies.Count);

            // anyone signed in can read it, only a Super Admin can change it
            Assert.Equal(System.Net.HttpStatusCode.OK, (await (await As("test.requester")).GetAsync("/api/priority-matrix")).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.Forbidden,
                (await (await As("test.requester")).PutAsJsonAsync("/api/admin/priority-matrix", new { cells = new[] { new { impact = 1, urgency = 1, priority = 4 } } })).StatusCode);

            var changed = await Ok<PriorityMatrixDto>(await admin.PutAsJsonAsync("/api/admin/priority-matrix", new { cells = new[] { new { impact = 1, urgency = 1, priority = 4 } } }));
            var cell = changed.Cells.Single(c => c.Impact == TicketImpact.JustMe && c.Urgency == TicketUrgency.CanWait);
            Assert.Equal(TicketPriority.Critical, cell.Priority);
            Assert.False(cell.IsDefault);
            var ticket = await LoadAsync((await Ok<CreatedTicketDto>(await PostTicketAsync(lab, "1", "1", null))).Id);
            Assert.Equal(TicketPriority.Critical, ticket.Priority);

            // invalid cells are refused, and sending the default again puts the cell back to "not edited"
            Assert.Equal(System.Net.HttpStatusCode.BadRequest,
                (await admin.PutAsJsonAsync("/api/admin/priority-matrix", new { cells = new[] { new { impact = 1, urgency = 1, priority = 9 } } })).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest,
                (await admin.PutAsJsonAsync("/api/admin/priority-matrix", new { cells = new[] { new { impact = 1, urgency = 1, priority = 1 }, new { impact = 1, urgency = 1, priority = 2 } } })).StatusCode);
            var back = await Ok<PriorityMatrixDto>(await admin.PutAsJsonAsync("/api/admin/priority-matrix", new { cells = new[] { new { impact = 1, urgency = 1, priority = 1 } } }));
            Assert.True(back.Cells.Single(c => c.Impact == TicketImpact.JustMe && c.Urgency == TicketUrgency.CanWait).IsDefault);
        }

        [Fact]
        public async Task A_head_can_change_the_priority_with_a_reason_and_it_is_recorded()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var before = await LoadAsync(id);
            Assert.Equal(TicketPriority.Medium, before.Priority);

            var (problem, message) = await WithService(s => s.ChangeAsync(id, new ChangePriorityRequest { Priority = TicketPriority.High, Reason = "The whole unit is waiting on this." }, lab.HeadId, false));
            Assert.Null(problem);
            Assert.NotNull(message);
            Assert.Equal(TicketPriority.High, (await LoadAsync(id)).Priority);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var note = await db.TicketComments.AsNoTracking().Where(c => c.TicketId == id && c.IsInternal).OrderByDescending(c => c.CreatedAt).FirstAsync();
            Assert.Contains("Priority changed from Medium to High", note.BodyText);
            Assert.Contains("The whole unit is waiting", note.BodyText);
            Assert.True(await db.InAppNotifications.AsNoTracking().AnyAsync(n => n.RecipientUserId == lab.WorkerId && n.Title.Contains("priority")));
        }

        [Fact]
        public async Task Only_a_head_oversight_or_super_admin_can_change_it_and_only_while_open_with_a_real_reason()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var change = new ChangePriorityRequest { Priority = TicketPriority.High, Reason = "A good reason." };

            Assert.Equal(403, (await WithService(s => s.ChangeAsync(id, change, lab.WorkerId, false))).Problem!.Status);        // a case worker of the unit
            var stranger = await NewUserAsync();
            Assert.Equal(404, (await WithService(s => s.ChangeAsync(id, change, stranger, false))).Problem!.Status);            // cannot even see it
            Assert.Equal(400, (await WithService(s => s.ChangeAsync(id, new ChangePriorityRequest { Priority = TicketPriority.High, Reason = "hi" }, lab.HeadId, false))).Problem!.Status);
            Assert.Equal(400, (await WithService(s => s.ChangeAsync(id, new ChangePriorityRequest { Priority = (TicketPriority)9, Reason = "A good reason." }, lab.HeadId, false))).Problem!.Status);
            Assert.Equal(400, (await WithService(s => s.ChangeAsync(id, new ChangePriorityRequest { Priority = TicketPriority.Medium, Reason = "A good reason." }, lab.HeadId, false))).Problem!.Status);   // already Medium

            var superAdmin = await SuperAdminIdAsync();
            Assert.Null((await WithService(s => s.ChangeAsync(id, new ChangePriorityRequest { Priority = TicketPriority.Low, Reason = "Not urgent after all." }, superAdmin, true))).Problem);
            Assert.Equal(TicketPriority.Low, (await LoadAsync(id)).Priority);

            await ChangeAsync(id, t => t.Status = TicketStatus.Resolved);
            Assert.Equal(400, (await WithService(s => s.ChangeAsync(id, change, lab.HeadId, false))).Problem!.Status);          // finished tickets keep their priority
        }

        [Fact]
        public async Task The_priority_options_say_who_can_change_it_and_show_the_two_answers_to_staff()
        {
            var lab = await NewLabAsync();
            var created = await Ok<CreatedTicketDto>(await PostTicketAsync(lab, "3", "2", null));
            var forHead = (await WithService(s => s.GetOptionsAsync(created.Id, lab.HeadId, false))).Options!;
            Assert.True(forHead.CanChange);
            Assert.Equal(TicketPriority.Medium, forHead.Priority);
            Assert.Equal(TicketImpact.MyDepartment, forHead.Impact);
            Assert.Equal(TicketUrgency.Soon, forHead.Urgency);

            var forWorker = (await WithService(s => s.GetOptionsAsync(created.Id, lab.WorkerId, false))).Options!;
            Assert.False(forWorker.CanChange);
            Assert.False(string.IsNullOrWhiteSpace(forWorker.Reason));

            var outsider = await NewUserAsync();
            Assert.Equal(404, (await WithService(s => s.GetOptionsAsync(created.Id, outsider, false))).Problem!.Status);
        }
    }
}
