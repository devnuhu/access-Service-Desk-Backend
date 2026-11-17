namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>How far a ticket is through its time (BRD Section 9). Shown to staff only, while the ticket is open.</summary>
    public enum SlaLevel
    {
        OnTrack = 0,
        /// <summary>Half the time is used.</summary>
        Warning = 1,
        /// <summary>The time has run out; the unit's head and deputy were told.</summary>
        Overdue = 2,
        /// <summary>Far past the time; the Head of Department and the Department Admin were told.</summary>
        FarPast = 3
    }
}