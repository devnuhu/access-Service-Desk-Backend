namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>What a comment is: typed by a person, or written by the system when an action was taken on the ticket.</summary>
    public enum CommentKind
    {
        /// <summary>Typed by a person.</summary>
        Comment = 0,
        /// <summary>Written by the system for a workflow action (pending, resolve, reopen, cancel, escalate).</summary>
        Workflow = 1
    }
}