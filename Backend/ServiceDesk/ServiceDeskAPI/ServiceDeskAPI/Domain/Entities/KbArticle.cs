using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A knowledge-base article written by a department's staff. Drafts are seen by that department's staff only; a head of unit, the Head of Department,
    /// the Department Admin or the Super Admin publishes it. BodyHtml is cleaned rich text; BodyText is the plain-text copy used for search.
    /// </summary>
    public class KbArticle
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public Department? Department { get; set; }
        /// <summary>Optional: the service category the article helps with. Must belong to the same department.</summary>
        public Guid? CategoryId { get; set; }
        public Category? Category { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public string BodyHtml { get; set; } = string.Empty;
        public string BodyText { get; set; } = string.Empty;
        public KbArticleStatus Status { get; set; } = KbArticleStatus.Draft;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
        public DateTime? PublishedAt { get; set; }
        public Guid? PublishedByUserId { get; set; }
    }

    /// <summary>"Was this helpful?" One answer per person per article; answering again changes it.</summary>
    public class KbArticleVote
    {
        public Guid Id { get; set; }
        public Guid ArticleId { get; set; }
        public KbArticle? Article { get; set; }
        public Guid UserId { get; set; }
        public bool IsHelpful { get; set; }
        public DateTime VotedAt { get; set; } = DateTime.UtcNow;
    }
}