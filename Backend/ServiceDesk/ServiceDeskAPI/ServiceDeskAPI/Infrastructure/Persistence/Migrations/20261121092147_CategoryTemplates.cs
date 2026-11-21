using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CategoryTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TemplateDescriptionHtml",
                table: "Categories",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TemplateSubject",
                table: "Categories",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000001"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000002"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000003"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000004"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000005"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000006"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000007"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000008"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000009"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000010"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000011"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000012"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000013"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000014"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000015"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000016"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000017"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000018"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000019"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000020"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000021"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });

            migrationBuilder.UpdateData(
                table: "Categories",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0003-0000-4000-8000-000000000022"),
                columns: new[] { "TemplateDescriptionHtml", "TemplateSubject" },
                values: new object[] { null, null });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TemplateDescriptionHtml",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "TemplateSubject",
                table: "Categories");
        }
    }
}
