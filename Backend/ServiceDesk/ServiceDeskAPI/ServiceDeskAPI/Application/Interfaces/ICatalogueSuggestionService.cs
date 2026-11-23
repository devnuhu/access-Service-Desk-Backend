using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Suggestions for the requester's home: what the person raised recently and what is popular right now.</summary>
    public interface ICatalogueSuggestionService
    {
        Task<CatalogueSuggestionsDto> GetAsync(Guid userId);
    }
}