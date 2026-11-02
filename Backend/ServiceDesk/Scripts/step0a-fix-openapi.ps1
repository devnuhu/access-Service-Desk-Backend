# Step 0a - Fix the start-up crash "Could not load type 'Microsoft.OpenApi.Models.OpenApiDocument'".
#
# Cause: the .NET 10 webapi template adds Microsoft.AspNetCore.OpenApi, which pulls in Microsoft.OpenApi 2.x.
# ELM's Swashbuckle 6.4 only works with Microsoft.OpenApi 1.x, so the API crashes when it scans for controllers.
# Fix: remove the template package and use Swashbuckle (Swagger at /swagger) the same way ELM does.
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk (or from the solution root ServiceDesk\ServiceDeskAPI), with the API stopped:
#   cd C:\Users\<you>\Desktop\PRO\ServiceDesk
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\step0a-fix-openapi.ps1
# On any failure, the project file and Program.cs are restored.

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
# Find the solution root: either the current folder, or ServiceDeskAPI inside it.
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if ((Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) -and (Test-Path (Join-Path $candidate 'tests\ServiceDeskAPI.Tests'))) { $root = $candidate; break }
}
if (-not $root) {
    Write-Host 'Run this from C:\Users\<you>\Desktop\PRO\ServiceDesk (the folder that contains ServiceDeskAPI and docs).' -ForegroundColor Red
    return
}
Write-Host "  Solution root: $root"
$projPath = Join-Path $root 'ServiceDeskAPI\ServiceDeskAPI.csproj'
$progPath = Join-Path $root 'ServiceDeskAPI\Program.cs'
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Invoke-Dotnet([string[]]$a) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & dotnet @a 2>&1 | ForEach-Object { "$_" }
    $script:lastExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    return $out
}

$projOld = [System.IO.File]::ReadAllText($projPath)
$progOld = [System.IO.File]::ReadAllText($progPath)

# ---- anchor checks ----
if ($projOld -notmatch 'Swashbuckle\.AspNetCore') { Write-Host 'Swashbuckle.AspNetCore is not in ServiceDeskAPI.csproj. Send me the project file.' -ForegroundColor Red; return }
if ($projOld -notmatch 'Microsoft\.AspNetCore\.OpenApi' -and $progOld -notmatch 'AddOpenApi') { Write-Host 'Already fixed: no Microsoft.AspNetCore.OpenApi package and no AddOpenApi. Nothing changed.' -ForegroundColor Yellow; return }
if ($progOld -notmatch 'AddOpenApi' -or $progOld -match 'AddAuthentication|AddDbContext') {
    Write-Host 'Program.cs is not the plain template any more. Nothing changed; send me Program.cs.' -ForegroundColor Red
    return
}

$progNew = @'
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// Swagger, as in People Hub (Swashbuckle). The JSON is at /swagger/v1/swagger.json.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
'@

function Restore-All {
    [System.IO.File]::WriteAllText($projPath, $projOld, $utf8)
    [System.IO.File]::WriteAllText($progPath, $progOld, $utf8)
}

try {
    Write-Host '1/4 Removing Microsoft.AspNetCore.OpenApi (the template package)...'
    if ($projOld -match 'Microsoft\.AspNetCore\.OpenApi') {
        $o = Invoke-Dotnet @('remove', $projPath, 'package', 'Microsoft.AspNetCore.OpenApi')
        if ($script:lastExit -ne 0) { $o | Select-Object -Last 20; throw 'dotnet remove package failed.' }
    }

    Write-Host '2/4 Switching Program.cs to Swashbuckle...'
    [System.IO.File]::WriteAllText($progPath, $progNew.Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)

    Write-Host '3/4 Building and running the tests...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match 'error' } | Select-Object -First 20; throw 'Build failed.' }
    $t = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $t | Where-Object { $_ -match 'Passed!|Failed!' } | ForEach-Object { Write-Host "  $_" }
    if ($script:lastExit -ne 0) { throw 'Tests failed.' }

    Write-Host '4/4 Checking which Microsoft.OpenApi the API now uses...'
    $l = Invoke-Dotnet @('list', $projPath, 'package', '--include-transitive')
    $line = @($l | Where-Object { $_ -match '>\s*Microsoft\.OpenApi\s' }) | Select-Object -First 1
    Write-Host "  $($line.Trim())"
    if ($line -match '\s2\.\d') { throw 'Microsoft.OpenApi is still 2.x. Send me the output of: dotnet list ServiceDeskAPI package --include-transitive' }

    Write-Host ''
    Write-Host 'Done. Microsoft.OpenApi is back on 1.x, matching ELM. Start the API: Swagger is at /swagger, health at /api/health.' -ForegroundColor Green
}
catch {
    Write-Host ''
    Write-Host ("FAILED: " + $_.Exception.Message) -ForegroundColor Red
    Restore-All
    Write-Host 'ServiceDeskAPI.csproj and Program.cs were restored.' -ForegroundColor Yellow
    exit 1
}
