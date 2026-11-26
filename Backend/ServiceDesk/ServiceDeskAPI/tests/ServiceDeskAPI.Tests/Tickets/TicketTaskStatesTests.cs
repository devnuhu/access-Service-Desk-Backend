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
    /// <summary>Task states: done by an owner from another unit, reject, cancel, what blocks resolving, and the My tasks list.</summary>
    public class TicketTaskStatesTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public TicketTaskStatesTests(ServiceDeskApiFactory factory) => _factory = factory;

        /// <summary>One department with two units: the ticket's unit (head and case worker) and another unit (one case worker).</summary>
        private sealed record Lab(Guid CategoryId, Guid HeadId, Guid WorkerId, Guid OtherId);

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

        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "T" + tag, name = "Task Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Task Unit " + tag }));
            var otherUnit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U2", name = "Other Unit " + tag }));
            var head = await NewUserAsync();
            var worker = await NewUserAsync();
            var other = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = head }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = worker }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{otherUnit.Id}/members", new { userId = other }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Task category " + tag, timelineHours = 24, defaultPriority = 2 }));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Units.FirstAsync(u => u.Id == unit.Id)).HeadUserId = head;
            db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = category.Id, UserId = worker, IsActive = true, AddedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return new Lab(category.Id, head, worker, other);
        }

        private async Task<Guid> RaiseAssignedAsync(Lab lab)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(lab.CategoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Task states test " + Guid.NewGuid().ToString("N")), "subject" },
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

        private static TicketTaskRequest Req(string title, Guid? owner = null) => new() { Title = title, AssigneeUserId = owner };

        private static ResolveRequest Resolve() => new() { Code = ResolutionCode.Completed, Note = "Everything has been done for the requester." };

        [Fact]
        public async Task An_owner_from_another_unit_sees_and_finishes_only_their_own_task()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (_, mine) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount", lab.OtherId), lab.WorkerId, false));
            var (_, notMine) = await WithTasks(s => s.AddAsync(id, Req("Check the schedule", lab.HeadId), lab.WorkerId, false));

            var (listProblem, list) = await WithTasks(s => s.ListAsync(id, lab.OtherId, false));
            Assert.Null(listProblem);
            Assert.Single(list!.Items);
            Assert.Equal(mine!.Id, list.Items[0].Id);
            Assert.False(list.CanEdit);
            Assert.True(list.Items[0].CanComplete);
            Assert.True(list.Items[0].CanReject);
            Assert.False(list.Items[0].CanCancel);

            var (addProblem, _) = await WithTasks(s => s.AddAsync(id, Req("A task I should not be able to add"), lab.OtherId, false));
            Assert.Equal(404, addProblem!.Status);
            var (otherTask, _) = await WithTasks(s => s.SetDoneAsync(id, notMine!.Id, true, lab.OtherId, false));
            Assert.Equal(404, otherTask!.Status);

            var (doneProblem, done) = await WithTasks(s => s.SetDoneAsync(id, mine.Id, true, lab.OtherId, false));
            Assert.Null(doneProblem);
            Assert.Equal("Done", done!.Status);
            Assert.Equal(1, await CountAsync(lab.WorkerId, id, "a task is done"));

            var outsider = await NewUserAsync();
            var (outsiderProblem, _) = await WithTasks(s => s.ListAsync(id, outsider, false));
            Assert.Equal(404, outsiderProblem!.Status);
        }

        [Fact]
        public async Task A_rejected_task_needs_a_reason_tells_the_case_worker_and_keeps_blocking_until_it_is_given_to_someone_else()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => t.Status = TicketStatus.InProgress);
            var (_, task) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount", lab.OtherId), lab.WorkerId, false));

            var (shortReason, _) = await WithTasks(s => s.RejectAsync(id, task!.Id, "no", lab.OtherId, false));
            Assert.Equal(400, shortReason!.Status);
            var (notOwner, _) = await WithTasks(s => s.RejectAsync(id, task.Id, "This is not mine to reject", lab.WorkerId, false));
            Assert.Equal(403, notOwner!.Status);

            var (problem, rejected) = await WithTasks(s => s.RejectAsync(id, task.Id, "This belongs to the finance unit", lab.OtherId, false));
            Assert.Null(problem);
            Assert.Equal("Rejected", rejected!.Status);
            Assert.Equal("This belongs to the finance unit", rejected.RejectedReason);
            Assert.Equal(1, await CountAsync(lab.WorkerId, id, "a task was rejected"));

            var (blocked, _) = await WithWorkflow(s => s.ResolveAsync(id, Resolve(), lab.WorkerId, false));
            Assert.Equal(400, blocked!.Status);
            Assert.Contains("still open", blocked.Message);
            var (doneRejected, _) = await WithTasks(s => s.SetDoneAsync(id, task.Id, true, lab.OtherId, false));
            Assert.Equal(400, doneRejected!.Status);

            var (_, again) = await WithTasks(s => s.UpdateAsync(id, task.Id, Req("Confirm the amount", lab.HeadId), lab.WorkerId, false));
            Assert.Equal("Open", again!.Status);
            Assert.Null(again.RejectedReason);
        }

        [Fact]
        public async Task A_cancelled_task_needs_a_reason_tells_its_owner_and_stops_blocking_the_ticket()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => t.Status = TicketStatus.InProgress);
            var (_, task) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount", lab.OtherId), lab.WorkerId, false));

            var (shortReason, _) = await WithTasks(s => s.CancelAsync(id, task!.Id, "x", lab.WorkerId, false));
            Assert.Equal(400, shortReason!.Status);
            var (ownerOnly, _) = await WithTasks(s => s.CancelAsync(id, task.Id, "Not needed any more", lab.OtherId, false));
            Assert.Equal(404, ownerOnly!.Status);

            var (problem, cancelled) = await WithTasks(s => s.CancelAsync(id, task.Id, "Not needed any more", lab.WorkerId, false));
            Assert.Null(problem);
            Assert.Equal("Cancelled", cancelled!.Status);
            Assert.Equal("Not needed any more", cancelled.CancelledReason);
            Assert.Equal(1, await CountAsync(lab.OtherId, id, "a task was cancelled"));

            var (resolveProblem, _) = await WithWorkflow(s => s.ResolveAsync(id, Resolve(), lab.WorkerId, false));
            Assert.Null(resolveProblem);
        }

        [Fact]
        public async Task My_tasks_lists_the_open_tasks_given_to_the_person_across_tickets()
        {
            var lab = await NewLabAsync();
            var first = await RaiseAssignedAsync(lab);
            var second = await RaiseAssignedAsync(lab);
            var (_, one) = await WithTasks(s => s.AddAsync(first, Req("Confirm the amount", lab.OtherId), lab.WorkerId, false));
            await WithTasks(s => s.AddAsync(second, Req("Check the schedule", lab.OtherId), lab.WorkerId, false));

            var open = await WithTasks(s => s.MineAsync(lab.OtherId, false, 1, 20));
            Assert.Equal(2, open.Total);
            Assert.Equal(2, open.OpenCount);
            Assert.All(open.Items, i => Assert.Equal("Open", i.Status));

            await WithTasks(s => s.SetDoneAsync(first, one!.Id, true, lab.OtherId, false));
            var afterDone = await WithTasks(s => s.MineAsync(lab.OtherId, false, 1, 20));
            Assert.Equal(1, afterDone.Total);
            Assert.Equal(1, afterDone.OpenCount);
            var everything = await WithTasks(s => s.MineAsync(lab.OtherId, true, 1, 20));
            Assert.Equal(2, everything.Total);
            Assert.Equal(1, everything.OpenCount);

            var nobody = await WithTasks(s => s.MineAsync(lab.HeadId, false, 1, 20));
            Assert.Equal(0, nobody.Total);
        }
    }
}