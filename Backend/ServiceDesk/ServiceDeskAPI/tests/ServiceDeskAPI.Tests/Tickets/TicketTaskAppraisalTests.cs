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
    /// <summary>Tasks kept for good with filters, a rejection that stays on the first person's record, and the task figures for the appraisal.</summary>
    public class TicketTaskAppraisalTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public TicketTaskAppraisalTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid CategoryId, Guid HeadId, Guid WorkerId, Guid OtherId, Guid OtherUnitId);

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
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "A" + tag, name = "Appraisal Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Appraisal Unit " + tag }));
            var otherUnit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U2", name = "Other Unit " + tag }));
            var head = await NewUserAsync();
            var worker = await NewUserAsync();
            var other = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = head }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = worker }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{otherUnit.Id}/members", new { userId = other }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Appraisal category " + tag, timelineHours = 24, defaultPriority = 2 }));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Units.FirstAsync(u => u.Id == unit.Id)).HeadUserId = head;
            db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = category.Id, UserId = worker, IsActive = true, AddedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return new Lab(category.Id, head, worker, other, otherUnit.Id);
        }

        private async Task<Guid> RaiseAssignedAsync(Lab lab)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(lab.CategoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Task history test " + Guid.NewGuid().ToString("N")), "subject" },
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

        private async Task<T> WithPerformance<T>(Func<IPerformanceService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<IPerformanceService>());
        }

        private static TicketTaskRequest Req(string title, Guid? owner = null, string? due = null) => new() { Title = title, AssigneeUserId = owner, DueDate = due };

        private static ResolveRequest Resolve() => new() { Code = ResolutionCode.Completed, Note = "Everything has been done for the requester." };

        private static string Future() => DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd");

        private const string Past = "2026-01-05";

        [Fact]
        public async Task The_appraisal_counts_done_on_time_late_open_overdue_rejected_and_cancelled_tasks()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (_, t1) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount", lab.OtherId, Future()), lab.WorkerId, false));
            await WithTasks(s => s.AddAsync(id, Req("Check the schedule", lab.OtherId, Past), lab.WorkerId, false));
            var (_, t3) = await WithTasks(s => s.AddAsync(id, Req("Chase the employer", lab.OtherId, Future()), lab.WorkerId, false));
            var (_, t4) = await WithTasks(s => s.AddAsync(id, Req("Prepare the refund file", lab.OtherId, Future()), lab.WorkerId, false));
            var (_, t5) = await WithTasks(s => s.AddAsync(id, Req("Send the statement", lab.OtherId, Past), lab.WorkerId, false));

            await WithTasks(s => s.SetDoneAsync(id, t1!.Id, true, lab.OtherId, false));
            await WithTasks(s => s.RejectAsync(id, t3!.Id, "This belongs to another unit", lab.OtherId, false));
            await WithTasks(s => s.CancelAsync(id, t4!.Id, "Not needed any more", lab.WorkerId, false));
            await WithTasks(s => s.SetDoneAsync(id, t5!.Id, true, lab.OtherId, false));

            var (problem, result) = await WithPerformance(s => s.MineAsync(new PerformanceQuery { Preset = "all" }, lab.OtherId));
            Assert.Null(problem);
            var tasks = result!.Tasks;
            Assert.Equal(5, tasks.Given);
            Assert.Equal(2, tasks.Done);
            Assert.Equal(1, tasks.DoneOnTime);
            Assert.Equal(1, tasks.DoneLate);
            Assert.Equal(1, tasks.OpenNow);
            Assert.Equal(1, tasks.OverdueOpen);
            Assert.Equal(1, tasks.Rejected);
            Assert.Equal(1, tasks.Cancelled);
            Assert.Equal(0, tasks.CancelledLate);
            Assert.Equal(33.3, tasks.OnTimePercent);
            Assert.Single(result.TaskRejections);
            Assert.Equal("This belongs to another unit", result.TaskRejections[0].Reason);

            var (unitProblem, unit) = await WithPerformance(s => s.UnitAsync(lab.OtherUnitId, new PerformanceQuery { Preset = "all" }, Guid.NewGuid(), true));
            Assert.Null(unitProblem);
            Assert.Equal(5, unit!.Members.Single(m => m.UserId == lab.OtherId).Tasks.Given);
            Assert.Equal(5, unit.Tasks.Given);
        }

        [Fact]
        public async Task A_rejection_stays_on_the_first_persons_record_when_the_task_goes_to_someone_else()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => t.Status = TicketStatus.InProgress);
            var (_, task) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount", lab.OtherId), lab.WorkerId, false));
            await WithTasks(s => s.RejectAsync(id, task!.Id, "This belongs to another unit", lab.OtherId, false));

            var (updateProblem, next) = await WithTasks(s => s.UpdateAsync(id, task.Id, Req("Confirm the amount", lab.HeadId), lab.WorkerId, false));
            Assert.Null(updateProblem);
            Assert.NotEqual(task.Id, next!.Id);
            Assert.Equal("Open", next.Status);

            var (_, list) = await WithTasks(s => s.ListAsync(id, lab.WorkerId, false));
            Assert.Equal(2, list!.Items.Count);
            Assert.Equal(0, list.Rejected);
            Assert.Contains(list.Items, i => i.Id == task.Id && i.HandedOver && i.Status == "Rejected");

            var (editOld, _) = await WithTasks(s => s.UpdateAsync(id, task.Id, Req("Changed", lab.HeadId), lab.WorkerId, false));
            Assert.Equal(400, editOld!.Status);
            var (cancelOld, _) = await WithTasks(s => s.CancelAsync(id, task.Id, "Not needed any more", lab.WorkerId, false));
            Assert.Equal(400, cancelOld!.Status);

            var (minep, mine) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "rejected" }));
            Assert.Null(minep);
            Assert.Equal(1, mine!.Total);
            Assert.Equal("This belongs to another unit", mine.Items[0].Reason);

            var (blocked, _) = await WithWorkflow(s => s.ResolveAsync(id, Resolve(), lab.WorkerId, false));
            Assert.Equal(400, blocked!.Status);
            await WithTasks(s => s.SetDoneAsync(id, next.Id, true, lab.HeadId, false));
            var (allowed, _) = await WithWorkflow(s => s.ResolveAsync(id, Resolve(), lab.WorkerId, false));
            Assert.Null(allowed);

            var (_, result) = await WithPerformance(s => s.MineAsync(new PerformanceQuery { Preset = "all" }, lab.OtherId));
            Assert.Equal(1, result!.Tasks.Rejected);
        }

        [Fact]
        public async Task My_tasks_keeps_every_task_and_filters_by_status_and_by_the_date_given_due_or_finished()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (_, finished) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount", lab.OtherId, Future()), lab.WorkerId, false));
            await WithTasks(s => s.AddAsync(id, Req("Check the schedule", lab.OtherId, Past), lab.WorkerId, false));
            await WithTasks(s => s.AddAsync(id, Req("Chase the employer", lab.OtherId, Future()), lab.WorkerId, false));
            await WithTasks(s => s.SetDoneAsync(id, finished!.Id, true, lab.OtherId, false));

            var (_, all) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "all" }));
            Assert.Equal(3, all!.Total);
            Assert.Equal(2, all.Counts.Open);
            Assert.Equal(1, all.Counts.Done);
            Assert.Equal(3, all.Counts.All);

            var (_, done) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "done" }));
            Assert.Equal(1, done!.Total);
            Assert.NotNull(done.Items[0].FinishedAt);

            var (_, dueJanuary) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "all", DateField = "due", From = "2026-01-01", To = "2026-01-31" }));
            Assert.Equal(1, dueJanuary!.Total);
            Assert.Equal("Check the schedule", dueJanuary.Items[0].Title);

            var tomorrow = DateTime.UtcNow.AddDays(1).ToString("yyyy-MM-dd");
            var (_, givenLater) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "all", From = tomorrow, To = tomorrow }));
            Assert.Equal(0, givenLater!.Total);
            var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
            var (_, givenToday) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "all", From = today, To = tomorrow }));
            Assert.Equal(3, givenToday!.Total);

            var (_, finishedToday) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "all", DateField = "finished", From = today, To = tomorrow }));
            Assert.Equal(1, finishedToday!.Total);

            var (badStatus, _) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { Status = "everything" }));
            Assert.Equal(400, badStatus!.Status);
            var (badDate, _) = await WithTasks(s => s.MineAsync(lab.OtherId, new MyTasksQuery { From = "next week" }));
            Assert.Equal(400, badDate!.Status);
        }

        [Fact]
        public async Task A_task_given_to_someone_else_cannot_be_removed_only_cancelled()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var (_, task) = await WithTasks(s => s.AddAsync(id, Req("Confirm the amount", lab.OtherId), lab.WorkerId, false));
            var (problem, _) = await WithTasks(s => s.RemoveAsync(id, task!.Id, lab.WorkerId, false));
            Assert.Equal(400, problem!.Status);
            var (_, list) = await WithTasks(s => s.ListAsync(id, lab.WorkerId, false));
            Assert.Single(list!.Items);
            Assert.False(list.Items[0].CanRemove);
        }
    }
}