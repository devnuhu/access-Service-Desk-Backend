using System.ComponentModel.DataAnnotations;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>AD credentials from the sign-in form (sAMAccountName, DOMAIN\name or name@domain).</summary>
    public class LoginRequest
    {
        [Required, MaxLength(256)]
        public string Username { get; set; } = string.Empty;

        [Required, MaxLength(256)]
        public string Password { get; set; } = string.Empty;
    }

    /// <summary>Returned by login and refresh. The tokens are also set as HttpOnly cookies, which the web app uses.</summary>
    public class LoginResponse
    {
        public string AccessToken { get; set; } = string.Empty;
        public string RefreshToken { get; set; } = string.Empty;
        public string TokenType { get; set; } = "Bearer";
        public DateTime AccessTokenExpiresAt { get; set; }
        /// <summary>Send this in the X-CSRF-Token header on every POST, PUT, PATCH and DELETE (cookie sign-in). Also in the X-CSRF-Token response header.</summary>
        public string CsrfToken { get; set; } = string.Empty;
        public UserClaimsDto User { get; set; } = new();
    }

    /// <summary>The signed-in person and every role they hold.</summary>
    public class UserClaimsDto
    {
        public Guid Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Department { get; set; }
        /// <summary>All active roles: Requester, CaseWorker, HeadOfUnit, HOD, SuperAdmin (several at once is normal).</summary>
        public List<string> Roles { get; set; } = new();
        public bool IsActive { get; set; }
        public int UnreadNotificationCount { get; set; }
    }

    /// <summary>GET /api/auth/me</summary>
    public class UserProfileDto
    {
        public Guid Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string? FullName { get; set; }
        /// <summary>First word of the full name (AD display name), for greetings such as "Welcome, Amaka".</summary>
        public string? FirstName { get; set; }
        /// <summary>The rest of the full name.</summary>
        public string? LastName { get; set; }
        public string? CorporateEmail { get; set; }
        public string? Department { get; set; }
        public string? JobTitle { get; set; }
        public List<string> Roles { get; set; } = new();
        public int UnreadNotificationCount { get; set; }
    }

    /// <summary>Body for refresh and logout when the cookie is not available.</summary>
    public class RefreshTokenRequest
    {
        public string RefreshToken { get; set; } = string.Empty;
    }
}