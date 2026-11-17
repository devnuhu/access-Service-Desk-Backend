namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Where the email copy of a notification stands. None = written before emails were tracked: never emailed.</summary>
    public enum NotificationEmailState
    {
        None = 0,
        /// <summary>Waiting to be sent, or to be tried again.</summary>
        Pending = 1,
        Sent = 2,
        /// <summary>Deliberately not sent: email is off, the category is switched off, or the person is blocked or has no address. EmailLastError says which.</summary>
        Skipped = 3,
        /// <summary>Gave up: five tries used, or too old to be worth sending.</summary>
        Failed = 4
    }
}