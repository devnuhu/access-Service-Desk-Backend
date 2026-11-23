namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>An id and a name (a department or a category).</summary>
    public class KbRefDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
    }

    /// <summary>Filters for the article list. Status ("draft" or "published") is used by the manage list only.</summary>
    public class KbListQuery
    {
        public string? Search { get; set; }
        public Guid? DepartmentId { get; set; }
        public Guid? CategoryId { get; set; }
        public string? Status { get; set; }
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 20;
    }

    public class KbArticleListItemDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public KbRefDto Department { get; set; } = new();
        public KbRefDto? Category { get; set; }
        /// <summary>"Draft" or "Published".</summary>
        public string Status { get; set; } = string.Empty;
        public DateTime UpdatedAt { get; set; }
        public int Yes { get; set; }
        public int No { get; set; }
    }

    public class KbDepartmentCountDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public int Count { get; set; }
    }

    /// <summary>One page of articles. Departments counts the matches per department (ignoring the department filter), to build a filter.</summary>
    public class KbListDto
    {
        public List<KbArticleListItemDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public List<KbDepartmentCountDto> Departments { get; set; } = new();
    }

    /// <summary>One article. BodyHtml is cleaned and safe to show. CanEdit, CanPublish and CanDelete are for the signed-in person.</summary>
    public class KbArticleDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public string BodyHtml { get; set; } = string.Empty;
        public KbRefDto Department { get; set; } = new();
        public KbRefDto? Category { get; set; }
        public string Status { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public DateTime? PublishedAt { get; set; }
        public PersonDto? Author { get; set; }
        public int Yes { get; set; }
        public int No { get; set; }
        /// <summary>The signed-in person's answer to "Was this helpful?": true, false, or null when not answered.</summary>
        public bool? MyVote { get; set; }
        public bool CanEdit { get; set; }
        public bool CanPublish { get; set; }
        public bool CanDelete { get; set; }
    }

    /// <summary>An article offered while a request is being raised.</summary>
    public class KbSuggestionDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public string DepartmentName { get; set; } = string.Empty;
    }

    /// <summary>Create or change an article. DepartmentId is used when creating; an article cannot move to another department.</summary>
    public class KbArticleRequest
    {
        public Guid DepartmentId { get; set; }
        public Guid? CategoryId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public string BodyHtml { get; set; } = string.Empty;
    }

    public class KbVoteRequest
    {
        public bool Helpful { get; set; }
    }

    public class KbVoteDto
    {
        public int Yes { get; set; }
        public int No { get; set; }
        public bool? MyVote { get; set; }
    }

    /// <summary>A department the signed-in person may write articles for, with its active categories.</summary>
    public class KbOptionDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public bool CanPublish { get; set; }
        public List<KbRefDto> Categories { get; set; } = new();
    }
}