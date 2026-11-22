using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>Impact and urgency to priority: the wording of the two questions, the built-in grid, and the grid as edited by a Super Admin.</summary>
    public static class PriorityRules
    {
        public static readonly (TicketImpact Value, string Label, string Description)[] Impacts =
        {
            (TicketImpact.JustMe, "Just me", "Only I am affected."),
            (TicketImpact.MyTeam, "My team", "People in my team are affected."),
            (TicketImpact.MyDepartment, "My department", "My whole department is affected."),
            (TicketImpact.WholeCompany, "The whole company", "Many people across the company are affected.")
        };

        public static readonly (TicketUrgency Value, string Label, string Description)[] Urgencies =
        {
            (TicketUrgency.CanWait, "It can wait", "No deadline; whenever it is convenient."),
            (TicketUrgency.Soon, "Soon", "I need it in the next few days."),
            (TicketUrgency.Urgent, "Urgent", "I need it today."),
            (TicketUrgency.CannotWork, "I cannot work", "I am blocked until this is done.")
        };

        /// <summary>The built-in grid: impact plus urgency. 2-3 Low, 4-5 Medium, 6-7 High, 8 Critical.</summary>
        public static TicketPriority Default(TicketImpact impact, TicketUrgency urgency)
        {
            var score = (int)impact + (int)urgency;
            return score <= 3 ? TicketPriority.Low : score <= 5 ? TicketPriority.Medium : score <= 7 ? TicketPriority.High : TicketPriority.Critical;
        }

        /// <summary>The priority for the pair: the Super Admin's edit if there is one, otherwise the built-in grid.</summary>
        public static async Task<TicketPriority> ResolveAsync(AppDbContext db, TicketImpact impact, TicketUrgency urgency)
        {
            var saved = await db.PriorityMatrix.AsNoTracking().Where(c => c.Impact == impact && c.Urgency == urgency)
                .Select(c => (TicketPriority?)c.Priority).FirstOrDefaultAsync();
            return saved ?? Default(impact, urgency);
        }
    }
}