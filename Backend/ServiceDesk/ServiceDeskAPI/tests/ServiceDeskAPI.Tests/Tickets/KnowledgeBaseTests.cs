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
    /// <summary>The knowledge base: who writes, who publishes, who sees drafts, helpful votes and the suggestions on the raise form.</summary>
    public class KnowledgeBaseTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public KnowledgeBaseTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        private async Task<T> WithKb<T>(Func<IKnowledgeBaseService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<IKnowledgeBaseService>());
        }

        private async Task<Guid> DepartmentOfAsync(Lab lab)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Units.AsNoTracking().Where(u => u.Id == lab.UnitId).Select(u => u.DepartmentId).FirstAsync();
        }

        private async Task<Guid> SuperAdminIdAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Users.AsNoTracking().Where(u => u.UserName == "test.superadmin").Select(u => u.Id).FirstAsync();
        }

        private static string Tag() => Guid.NewGuid().ToString("N").Substring(0, 8);

        private static KbArticleRequest Art(Guid department, string title, Guid? category = null, string? body = null) => new()
        {
            DepartmentId = department, CategoryId = category, Title = title,
            Summary = "A short summary of the article for the list.",
            BodyHtml = body ?? "<p>Step one: open the portal. Step two: check the contribution file.</p>"
        };

        private async Task<KbArticleDto> DraftAsync(Guid department, Guid author, string title, Guid? category = null, string? body = null)
        {
            var (problem, article) = await WithKb(s => s.CreateAsync(Art(department, title, category, body), author, false));
            Assert.Null(problem);
            return article!;
        }

        private async Task<KbArticleDto> PublishedAsync(Guid department, Guid author, Guid head, string title, Guid? category = null, string? body = null)
        {
            var draft = await DraftAsync(department, author, title, category, body);
            var (problem, article) = await WithKb(s => s.SetPublishedAsync(draft.Id, true, head, false));
            Assert.Null(problem);
            return article!;
        }

        [Fact]
        public async Task Staff_write_a_draft_that_people_outside_the_department_cannot_see()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var outsider = await NewUserAsync();
            var tag = Tag();

            var draft = await DraftAsync(department, lab.WorkerId, "Refund guide " + tag);
            Assert.Equal("Draft", draft.Status);
            Assert.True(draft.CanEdit);
            Assert.False(draft.CanPublish);

            var (hidden, _) = await WithKb(s => s.GetAsync(draft.Id, outsider, false));
            Assert.Equal(404, hidden!.Status);
            var (_, publicList) = await WithKb(s => s.ListAsync(new KbListQuery { Search = tag }, lab.WorkerId, false, false));
            Assert.Equal(0, publicList!.Total);
            var (_, manage) = await WithKb(s => s.ListAsync(new KbListQuery { Search = tag }, lab.WorkerId, false, true));
            Assert.Equal(1, manage!.Total);
            var (_, outsiderManage) = await WithKb(s => s.ListAsync(new KbListQuery { Search = tag }, outsider, false, true));
            Assert.Equal(0, outsiderManage!.Total);

            var (denied, _) = await WithKb(s => s.CreateAsync(Art(department, "Not allowed " + tag), outsider, false));
            Assert.Equal(403, denied!.Status);
        }

        [Fact]
        public async Task Only_a_head_publishes_and_only_a_head_changes_a_published_article()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var outsider = await NewUserAsync();
            var tag = Tag();
            var draft = await DraftAsync(department, lab.WorkerId, "Contribution guide " + tag);

            var (workerPublish, _) = await WithKb(s => s.SetPublishedAsync(draft.Id, true, lab.WorkerId, false));
            Assert.Equal(403, workerPublish!.Status);

            var (headPublish, published) = await WithKb(s => s.SetPublishedAsync(draft.Id, true, lab.HeadId, false));
            Assert.Null(headPublish);
            Assert.Equal("Published", published!.Status);
            Assert.True(published.CanPublish);

            var (_, seen) = await WithKb(s => s.GetAsync(draft.Id, outsider, false));
            Assert.Equal("Published", seen!.Status);
            Assert.False(seen.CanEdit);
            var (_, publicList) = await WithKb(s => s.ListAsync(new KbListQuery { Search = tag }, outsider, false, false));
            Assert.Equal(1, publicList!.Total);
            Assert.Single(publicList.Departments);

            var (workerEdit, _) = await WithKb(s => s.UpdateAsync(draft.Id, Art(department, "Contribution guide v2 " + tag), lab.WorkerId, false));
            Assert.Equal(403, workerEdit!.Status);
            var (outsiderEdit, _) = await WithKb(s => s.UpdateAsync(draft.Id, Art(department, "Contribution guide v3 " + tag), outsider, false));
            Assert.Equal(403, outsiderEdit!.Status);
            var (headEdit, edited) = await WithKb(s => s.UpdateAsync(draft.Id, Art(department, "Contribution guide v2 " + tag), lab.HeadId, false));
            Assert.Null(headEdit);
            Assert.Equal("Contribution guide v2 " + tag, edited!.Title);

            var (_, back) = await WithKb(s => s.SetPublishedAsync(draft.Id, false, lab.HeadId, false));
            Assert.Equal("Draft", back!.Status);
            var (gone, _) = await WithKb(s => s.GetAsync(draft.Id, outsider, false));
            Assert.Equal(404, gone!.Status);
            var (workerAgain, _) = await WithKb(s => s.UpdateAsync(draft.Id, Art(department, "Contribution guide v4 " + tag), lab.WorkerId, false));
            Assert.Null(workerAgain);
        }

        [Fact]
        public async Task A_person_answers_was_this_helpful_once_and_can_change_it()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var reader = await NewUserAsync();
            var other = await NewUserAsync();
            var article = await PublishedAsync(department, lab.WorkerId, lab.HeadId, "Votes guide " + Tag());

            var (_, first) = await WithKb(s => s.VoteAsync(article.Id, true, reader));
            Assert.Equal(1, first!.Yes);
            Assert.Equal(0, first.No);
            await WithKb(s => s.VoteAsync(article.Id, true, reader));
            var (_, changed) = await WithKb(s => s.VoteAsync(article.Id, false, reader));
            Assert.Equal(0, changed!.Yes);
            Assert.Equal(1, changed.No);
            await WithKb(s => s.VoteAsync(article.Id, true, other));

            var (_, detail) = await WithKb(s => s.GetAsync(article.Id, reader, false));
            Assert.Equal(1, detail!.Yes);
            Assert.Equal(1, detail.No);
            Assert.False(detail.MyVote);

            var draft = await DraftAsync(department, lab.WorkerId, "Unpublished votes " + Tag());
            var (noVote, _) = await WithKb(s => s.VoteAsync(draft.Id, true, reader));
            Assert.Equal(404, noVote!.Status);
        }

        [Fact]
        public async Task Suggestions_put_the_category_first_then_word_matches_and_never_show_drafts()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var reader = await NewUserAsync();
            var word = "kw" + Tag();

            var byCategory = await PublishedAsync(department, lab.WorkerId, lab.HeadId, "Category article " + Tag(), lab.CategoryId);
            var byWord = await PublishedAsync(department, lab.WorkerId, lab.HeadId, "How to fix " + word + " quickly");
            var draft = await DraftAsync(department, lab.WorkerId, "Draft about " + word);

            var (_, items) = await WithKb(s => s.SuggestAsync(lab.CategoryId, "I need help with " + word, reader));
            Assert.Contains(items!, i => i.Id == byCategory.Id);
            Assert.Contains(items!, i => i.Id == byWord.Id);
            Assert.DoesNotContain(items!, i => i.Id == draft.Id);

            var (_, none) = await WithKb(s => s.SuggestAsync(null, "", reader));
            Assert.Empty(none!);
        }

        [Fact]
        public async Task Suggestions_are_limited_to_three()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var reader = await NewUserAsync();
            for (var i = 0; i < 4; i++) await PublishedAsync(department, lab.WorkerId, lab.HeadId, "Limit article " + i + " " + Tag(), lab.CategoryId);
            var (_, items) = await WithKb(s => s.SuggestAsync(lab.CategoryId, null, reader));
            Assert.Equal(3, items!.Count);
        }

        [Fact]
        public async Task The_fields_are_checked_and_a_title_is_unique_within_a_department()
        {
            var lab = await NewLabAsync();
            var other = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var tag = Tag();

            var (shortTitle, _) = await WithKb(s => s.CreateAsync(Art(department, "abc"), lab.WorkerId, false));
            Assert.Equal(400, shortTitle!.Status);
            Assert.True(shortTitle.Errors!.ContainsKey("title"));

            var empty = Art(department, "A proper title " + tag);
            empty.BodyHtml = "<p>short</p>";
            var (shortBody, _) = await WithKb(s => s.CreateAsync(empty, lab.WorkerId, false));
            Assert.Equal(400, shortBody!.Status);
            Assert.True(shortBody.Errors!.ContainsKey("bodyHtml"));

            await DraftAsync(department, lab.WorkerId, "Unique title " + tag);
            var (duplicate, _) = await WithKb(s => s.CreateAsync(Art(department, "Unique title " + tag), lab.HeadId, false));
            Assert.Equal(400, duplicate!.Status);
            Assert.True(duplicate.Errors!.ContainsKey("title"));

            var (wrongCategory, _) = await WithKb(s => s.CreateAsync(Art(department, "Category of another unit " + tag, other.CategoryId), lab.WorkerId, false));
            Assert.Equal(400, wrongCategory!.Status);
            Assert.True(wrongCategory.Errors!.ContainsKey("categoryId"));
        }

        [Fact]
        public async Task Staff_delete_their_own_drafts_and_heads_delete_the_rest()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var otherWorker = await NewUserAsync();
            var admin = await As("test.superadmin");
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{lab.UnitId}/members", new { userId = otherWorker }));

            var mine = await DraftAsync(department, lab.WorkerId, "My draft " + Tag());
            var (notYours, _) = await WithKb(s => s.DeleteAsync(mine.Id, otherWorker, false));
            Assert.Equal(403, notYours!.Status);
            var (own, message) = await WithKb(s => s.DeleteAsync(mine.Id, lab.WorkerId, false));
            Assert.Null(own);
            Assert.NotNull(message);

            var live = await PublishedAsync(department, lab.WorkerId, lab.HeadId, "Live article " + Tag());
            var (workerLive, _) = await WithKb(s => s.DeleteAsync(live.Id, lab.WorkerId, false));
            Assert.Equal(403, workerLive!.Status);
            var (headLive, _) = await WithKb(s => s.DeleteAsync(live.Id, lab.HeadId, false));
            Assert.Null(headLive);
            var (gone, _) = await WithKb(s => s.GetAsync(live.Id, lab.HeadId, false));
            Assert.Equal(404, gone!.Status);
        }

        [Fact]
        public async Task The_super_admin_can_write_and_publish_for_any_department_and_options_list_the_departments_a_person_writes_for()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var outsider = await NewUserAsync();
            var superAdmin = await SuperAdminIdAsync();

            var (problem, created) = await WithKb(s => s.CreateAsync(Art(department, "Written by the super admin " + Tag()), superAdmin, true));
            Assert.Null(problem);
            var (published, _) = await WithKb(s => s.SetPublishedAsync(created!.Id, true, superAdmin, true));
            Assert.Null(published);

            var (_, workerOptions) = await WithKb(s => s.OptionsAsync(lab.WorkerId, false));
            Assert.Single(workerOptions!);
            Assert.Equal(department, workerOptions![0].Id);
            Assert.False(workerOptions[0].CanPublish);
            Assert.Contains(workerOptions[0].Categories, c => c.Id == lab.CategoryId);
            var (_, headOptions) = await WithKb(s => s.OptionsAsync(lab.HeadId, false));
            Assert.True(headOptions!.Single().CanPublish);
            var (_, outsiderOptions) = await WithKb(s => s.OptionsAsync(outsider, false));
            Assert.Empty(outsiderOptions!);
        }

        [Fact]
        public async Task The_article_body_is_cleaned_before_it_is_stored()
        {
            var lab = await NewLabAsync();
            var department = await DepartmentOfAsync(lab);
            var article = await DraftAsync(department, lab.WorkerId, "Cleaning " + Tag(), null,
                "<p>Open the portal and check the file carefully.</p><script>alert(1)</script><img src=x onerror=alert(2)>");
            Assert.DoesNotContain("<script", article.BodyHtml);
            Assert.DoesNotContain("onerror", article.BodyHtml);
            Assert.Contains("Open the portal", article.BodyHtml);
        }
    }
}