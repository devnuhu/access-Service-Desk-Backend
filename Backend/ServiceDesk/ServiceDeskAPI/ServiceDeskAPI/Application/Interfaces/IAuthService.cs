using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Sign-in with on-premises Active Directory and the Service Desk's own JWT (ported from People Hub).</summary>
    public interface IAuthService
    {
        Task<(bool Success, string Message, LoginResponse? Response)> LoginAsync(LoginRequest request);

        /// <summary>Rotates the refresh token: the old one stops working and a new pair is issued.</summary>
        Task<(bool Success, string Message, LoginResponse? Response)> RefreshTokenAsync(string refreshToken);

        Task<(bool Success, string Message, UserProfileDto? User)> GetCurrentUserAsync(Guid userId);

        Task<bool> SyncUserFromAdAsync(Guid userId);

        /// <summary>Logout: the refresh token can no longer be used.</summary>
        Task<bool> RevokeRefreshTokenAsync(string refreshToken);
    }
}