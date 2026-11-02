# Gives the Super Admin role to one person, when there is no Super Admin yet (the first one on a new server).
# After that, Super Admins manage roles in the app (api/admin). The person must have signed in once (or been added from the directory).
# Uses the Service Desk database only. No password or key is needed or read; it signs in to SQL Server as you (Windows sign-in).
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk (this computer's SQLEXPRESS):
#   .\Scripts\make-first-super-admin.ps1 -UserName nuhu.audu
# On a server (example):
#   .\make-first-super-admin.ps1 -UserName nuhu.audu -ConnectionString 'Server=SQLHOST;Database=ServiceDeskDB;Integrated Security=True;TrustServerCertificate=True'
# -Force gives the role even when a Super Admin already exists (for example to add a second one from the server).

param(
    [Parameter(Mandatory = $true)][string]$UserName,
    [string]$ConnectionString = 'Server=.\SQLEXPRESS;Database=ServiceDeskDB;Trusted_Connection=True;TrustServerCertificate=True',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ($ConnectionString -match '(?i)(password|pwd)\s*=') {
    Write-Host 'Use Windows sign-in to SQL Server (Integrated Security), not a password in the command line.' -ForegroundColor Red
    return
}

$sql = @'
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @roleId uniqueidentifier = '5D1A0001-0000-4000-8000-000000000005';
DECLARE @userId uniqueidentifier = (SELECT Id FROM Users WHERE NormalizedUserName = UPPER(@name) AND IsActive = 1);
IF @userId IS NULL BEGIN ROLLBACK; SELECT 'nouser'; RETURN; END
IF EXISTS (SELECT 1 FROM UserRoleAssignments WHERE UserId = @userId AND RoleId = @roleId AND IsActive = 1) BEGIN ROLLBACK; SELECT 'already'; RETURN; END
IF @force = 0 AND EXISTS (SELECT 1 FROM UserRoleAssignments a JOIN Users u ON u.Id = a.UserId
                          WHERE a.RoleId = @roleId AND a.IsActive = 1 AND u.IsActive = 1) BEGIN ROLLBACK; SELECT 'exists'; RETURN; END
INSERT INTO UserRoleAssignments (Id, UserId, RoleId, IsActive, AssignedAt) VALUES (NEWID(), @userId, @roleId, 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM UserRoles WHERE UserId = @userId AND RoleId = @roleId)
    INSERT INTO UserRoles (UserId, RoleId) VALUES (@userId, @roleId);
INSERT INTO AuditLogs (Id, UserId, UserDisplayName, Action, EntityType, EntityId, EntityDisplayName, OldValues, NewValues, IpAddress, UserAgent, Timestamp, Module)
VALUES (NEWID(), NULL, LEFT('make-first-super-admin.ps1 (' + @who + ')', 200), 12, 'User', @userId, @name, NULL, '{"granted":"SuperAdmin"}', NULL, NULL, SYSUTCDATETIME(), 3);
COMMIT;
SELECT 'done';
'@

try {
    $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
}
catch {
    Write-Host 'This PowerShell cannot open SQL Server connections. Run the script in Windows PowerShell (powershell.exe).' -ForegroundColor Red
    return
}
try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandText = $sql
    [void]$command.Parameters.AddWithValue('@name', $UserName.Trim())
    [void]$command.Parameters.AddWithValue('@who', $env:USERNAME)
    [void]$command.Parameters.AddWithValue('@force', [int][bool]$Force)
    $result = [string]$command.ExecuteScalar()
}
catch {
    Write-Host ('Could not update the database: ' + $_.Exception.Message) -ForegroundColor Red
    return
}
finally {
    $connection.Dispose()
}

switch ($result) {
    'done'    { Write-Host "$UserName is now a Super Admin (audited). They see it at their next sign-in." -ForegroundColor Green }
    'already' { Write-Host "$UserName is already a Super Admin. Nothing changed." -ForegroundColor Yellow }
    'exists'  { Write-Host 'A Super Admin already exists, so nothing changed. Ask them to give the role in the app, or use -Force.' -ForegroundColor Yellow }
    'nouser'  { Write-Host "No active account named $UserName. They must sign in once first (or be added from the directory)." -ForegroundColor Red }
    default   { Write-Host "Unexpected result: $result" -ForegroundColor Red }
}
