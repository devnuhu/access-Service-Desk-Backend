using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// The knowledge base. Everyone signed in reads published articles. A department's staff (unit members, heads of unit, the Head of Department,
    /// the Department Admin) write drafts; heads, the Head of Department, the Department Admin and Super Admin publish. Drafts are invisible (404) to everyone else.
    /// </summary>
    public interface IKnowledgeBaseService
    {
        /// <summary>manage false: published articles for everyone. manage true: drafts and published articles of the departments the person writes for.</summary>
        Task<(TicketProblem? Problem, KbListDto? List)> ListAsync(KbListQuery query, Guid actorUserId, bool actorIsSuperAdmin, bool manage);
        Task<(TicketProblem? Problem, KbArticleDto? Article)> GetAsync(Guid id, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, List<KbSuggestionDto>? Items)> SuggestAsync(Guid? categoryId, string? text, Guid actorUserId);
        Task<(TicketProblem? Problem, List<KbOptionDto>? Options)> OptionsAsync(Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, KbArticleDto? Article)> CreateAsync(KbArticleRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, KbArticleDto? Article)> UpdateAsync(Guid id, KbArticleRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, KbArticleDto? Article)> SetPublishedAsync(Guid id, bool publish, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> DeleteAsync(Guid id, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, KbVoteDto? Vote)> VoteAsync(Guid id, bool helpful, Guid actorUserId);
    }
}