using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NotificationEmailOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EmailAttempts",
                table: "InAppNotifications",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "EmailLastAttemptAt",
                table: "InAppNotifications",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmailLastError",
                table: "InAppNotifications",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EmailSentAt",
                table: "InAppNotifications",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EmailState",
                table: "InAppNotifications",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_InAppNotifications_EmailState_CreatedAt",
                table: "InAppNotifications",
                columns: new[] { "EmailState", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_InAppNotifications_EmailState_CreatedAt",
                table: "InAppNotifications");

            migrationBuilder.DropColumn(
                name: "EmailAttempts",
                table: "InAppNotifications");

            migrationBuilder.DropColumn(
                name: "EmailLastAttemptAt",
                table: "InAppNotifications");

            migrationBuilder.DropColumn(
                name: "EmailLastError",
                table: "InAppNotifications");

            migrationBuilder.DropColumn(
                name: "EmailSentAt",
                table: "InAppNotifications");

            migrationBuilder.DropColumn(
                name: "EmailState",
                table: "InAppNotifications");
        }
    }
}
