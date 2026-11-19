using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ReportSchedules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReportSchedules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SavedReportId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Frequency = table.Column<int>(type: "int", nullable: false),
                    WeekDay = table.Column<int>(type: "int", nullable: false),
                    DayOfMonth = table.Column<int>(type: "int", nullable: false),
                    SendHour = table.Column<int>(type: "int", nullable: false),
                    Format = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    StartsAfterUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    LastPeriodKey = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    LastSentAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    LastStatus = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    LastError = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    PendingPeriodKey = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    PendingAttempts = table.Column<int>(type: "int", nullable: false),
                    LastAttemptAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReportSchedules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReportSchedules_SavedReports_SavedReportId",
                        column: x => x.SavedReportId,
                        principalTable: "SavedReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReportSchedules_OwnerUserId_SavedReportId",
                table: "ReportSchedules",
                columns: new[] { "OwnerUserId", "SavedReportId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReportSchedules_SavedReportId",
                table: "ReportSchedules",
                column: "SavedReportId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReportSchedules");
        }
    }
}
