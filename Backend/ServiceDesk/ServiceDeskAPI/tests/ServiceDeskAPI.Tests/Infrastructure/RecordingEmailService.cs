using System.Collections.Concurrent;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>Stands in for the email provider in API tests: keeps every message and reports it as sent.</summary>
    public class RecordingEmailService : IEmailService
    {
        public sealed record SentEmail(string To, string Subject, string Html, IReadOnlyList<EmailAttachment>? Attachments = null);

        private readonly ConcurrentQueue<SentEmail> _sent = new();

        public IReadOnlyList<SentEmail> Sent => _sent.ToList();

        public Task<(bool Success, string Message)> SendEmailAsync(string to, string subject, string htmlBody)
        {
            _sent.Enqueue(new SentEmail(to, subject, htmlBody));
            return Task.FromResult((true, "Recorded"));
        }

        public Task<(bool Success, string Message)> SendEmailWithAttachmentsAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment> attachments)
            {
            _sent.Enqueue(new SentEmail(to, subject, htmlBody, attachments));
            return Task.FromResult((true, "Recorded"));
        }

        /// <summary>Waits (up to the timeout) for an email that matches; null if none arrives.</summary>
        public async Task<SentEmail?> WaitForAsync(Func<SentEmail, bool> match, TimeSpan timeout)
        {
            var until = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < until)
            {
                var hit = _sent.FirstOrDefault(match);
                if (hit != null) return hit;
                await Task.Delay(100);
            }
            return _sent.FirstOrDefault(match);
        }
    }
}