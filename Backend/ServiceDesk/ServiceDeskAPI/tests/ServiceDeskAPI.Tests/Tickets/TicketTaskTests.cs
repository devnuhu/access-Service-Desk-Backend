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
    /// <summary>The checklist on a ticket: who may use it, the owner rule, the resolve rule and the overdue notice.</summary>
    public class TicketTaskTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public TicketTaskTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        private async Task<int> CountAsync(Guid recipient, Guid ticketId, string titlePart)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.InAppNotifications.AsNoTracking().CountAsync(n => n.RecipientUserId == recipient && n.RelatedEntityId == ticketId && n.Title.Contains(titlePart));
        }

        private async Task<T> WithTasks<T>(Func<ITicketTaskService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<ITicketTaskService>());
        }

        private async Task<T> WithWorkflow<T>(Func<IWorkflowService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<IWorkflowService>());
        }

        private static TicketTaskRequest Req(string title, Guid? owner = null, string? due = null) => new() { Title = title, AssigneeUserId = owner, DueDate = due };

        private static ResolveRequest Resolve(ResolutionCode code) => new() { Code = code, Note = "Everything has been done for the requester." };

        [Fact]
        public async Task Staff_can_add_list_tick_and_remove_tasks()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (p1, added) = await WithTasks(s => s.AddAsync(id, Req("Check the contribution file"), lab.WorkerId, false));
            Assert.Null(p1);
            Assert.NotNull(added);

            var (_, list) = await WithTasks(s => s.ListAsync(id, lab.WorkerId, false));
            Assert.Single(list!.Items);
            Assert.Equal(1, list.Open);
            Assert.True(list.CanEdit);

            var (p2, done) = await WithTasks(s => s.SetDoneAsync(id, added!.Id, true, lab.WorkerId, false));
            Assert.Null(p2);
            Assert.True(done!.IsDone);
            var (_, after) = await WithTasks(s => s.ListAsync(id, lab.HeadId, false));
            Assert.Equal(1, after!.Done);
            Assert.Equal(0, after.Open);

            var (p3, message) = await WithTasks(s => s.RemoveAsync(id, added.Id, lab.HeadId, false));
            Assert.Null(p3);
            Assert.NotNull(message);
            var (_, empty) = await WithTasks(s => s.ListAsync(id, lab.WorkerId, false));
            Assert.Empty(empty!.Items);
        }

        [Fact]
        public async Task The_requester_cannot_see_or_add_tasks()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var requester = (await LoadAsync(id)).RequesterUserId;
            var (listProblem, _) = await WithTasks(s => s.ListAsync(id, requester, false));
            Assert.Equal(404, listProblem!.Status);
            var (addProblem, _) = await WithTasks(s => s.AddAsync(id, Req("A task from the requester"), requester, false));
            Assert.Equal(404, addProblem!.Status);
        }

        [Fact]
        public async Task A_task_owner_must_work_in_the_ticket_department_and_the_title_is_required()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var outsider = await NewUserAsync();
            var (ownerProblem, _) = await WithTasks(s => s.AddAsync(id, Req("Chase the employer", outsider), lab.WorkerId, false));
            Assert.Equal(400, ownerProblem!.Status);
            var (titleProblem, _) = await WithTasks(s => s.AddAsync(id, Req("ab"), lab.WorkerId, false));
            Assert.Equal(400, titleProblem!.Status);
            var (dateProblem, _) = await WithTasks(s => s.AddAsync(id, Req("Chase the employer", null, "next week"), lab.WorkerId, false));
            Assert.Equal(400, dateProblem!.Status);
        }

        [Fact]
        public async Task A_person_given_a_task_is_told_once()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (problem, _) = await WithTasks(s => s.AddAsync(id, Req("Prepare the refund schedule", lab.HeadId), lab.WorkerId, false));
            Assert.Null(problem);
            Assert.Equal(1, await CountAsync(lab.HeadId, id, "a task is assigned to you"));
            Assert.Equal(0, await CountAsync(lab.WorkerId, id, "a task is assigned to you"));
        }

        [Fact]
        public async Task A_ticket_with_an_open_task_cannot_be_resolved_until_it_is_done_or_removed()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => t.Status = TicketStatus.InProgress);
            var (_, task) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount with finance"), lab.WorkerId, false));

            var (blocked, _) = await WithWorkflow(s => s.ResolveAsync(id, Resolve(ResolutionCode.Completed), lab.WorkerId, false));
            Assert.Equal(400, blocked!.Status);
            Assert.Contains("still open", blocked.Message);

            await WithTasks(s => s.SetDoneAsync(id, task!.Id, true, lab.WorkerId, false));
            var (allowed, _) = await WithWorkflow(s => s.ResolveAsync(id, Resolve(ResolutionCode.Completed), lab.WorkerId, false));
            Assert.Null(allowed);

            var (changeProblem, _) = await WithTasks(s => s.AddAsync(id, Req("Too late for this one"), lab.WorkerId, false));
            Assert.Equal(400, changeProblem!.Status);
        }

        [Fact]
        public async Task A_ticket_raised_in_error_can_be_resolved_with_open_tasks()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => t.Status = TicketStatus.InProgress);
            await WithTasks(s => s.AddAsync(id, Req("Never needed"), lab.WorkerId, false));
            var (problem, _) = await WithWorkflow(s => s.ResolveAsync(id, Resolve(ResolutionCode.RaisedInError), lab.WorkerId, false));
            Assert.Null(problem);
        }

        [Fact]
        public async Task An_overdue_task_tells_its_owner_once_and_a_new_due_date_starts_it_again()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (_, task) = await WithTasks(s => s.AddAsync(id, Req("Send the statement", null, "2026-01-05"), lab.HeadId, false));
            await CheckSlaAsync();
            await CheckSlaAsync();
            Assert.Equal(1, await CountAsync(lab.WorkerId, id, "a task is overdue"));

            await WithTasks(s => s.UpdateAsync(id, task!.Id, Req("Send the statement", null, "2026-01-06"), lab.HeadId, false));
            await CheckSlaAsync();
            Assert.Equal(2, await CountAsync(lab.WorkerId, id, "a task is overdue"));
        }

        [Fact]
        public async Task A_done_task_is_never_reported_overdue()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (_, task) = await WithTasks(s => s.AddAsync(id, Req("Already finished", null, "2026-01-05"), lab.HeadId, false));
            await WithTasks(s => s.SetDoneAsync(id, task!.Id, true, lab.HeadId, false));
            await CheckSlaAsync();
            Assert.Equal(0, await CountAsync(lab.WorkerId, id, "a task is overdue"));
        }
    }
}