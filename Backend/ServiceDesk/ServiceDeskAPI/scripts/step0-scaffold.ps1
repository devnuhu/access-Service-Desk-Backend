# Step 0 - Create the Service Desk solution, laid out like People Hub (ELM).
#
# Creates (default root C:\Users\<you>\Desktop\PRO\ServiceDesk):
#   ServiceDesk\
#     ServiceDeskAPI\                      <- solution root (run every later step script from here)
#       ServiceDesk.sln(x)
#       ServiceDeskAPI\ServiceDeskAPI.csproj   Controllers, Application, Domain, Infrastructure folders
#       tests\ServiceDeskAPI.Tests\            xUnit, references the API
#       scripts\                               this script is copied here
#     docs\                                <- put the BRD and the docs I send you here
#
# Package versions are copied from the ELM projects, so both apps run on the same versions.
# Nothing in ELM is changed. If anything fails, the new ServiceDesk folder is removed.
#
# Run from anywhere:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\step0-scaffold.ps1
# Other locations:  .\step0-scaffold.ps1 -Root 'D:\PRO\ServiceDesk' -ElmRoot 'D:\PRO\ELM\EmployeeLCAPI'

param(
    [string]$Root = (Join-Path $env:USERPROFILE 'Desktop\PRO\ServiceDesk'),
    [string]$ElmRoot = (Join-Path $env:USERPROFILE 'Desktop\PRO\ELM\EmployeeLCAPI')
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Text([string]$p, [string]$t) {
    $dir = Split-Path $p -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($p, $t.Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
}
function Invoke-Dotnet([string[]]$a) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & dotnet @a 2>&1 | ForEach-Object { "$_" }
    $script:lastExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($script:lastExit -ne 0) {
        $out | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
        throw ('dotnet ' + ($a -join ' ') + ' failed.')
    }
    return $out
}
function Get-Packages([string]$csproj) {
    [xml]$x = [System.IO.File]::ReadAllText($csproj)
    $list = @()
    foreach ($pr in @($x.SelectNodes('//PackageReference'))) {
        $name = $pr.GetAttribute('Include')
        $ver = $pr.GetAttribute('Version')
        if (-not $ver) { $v = $pr.SelectSingleNode('Version'); if ($v) { $ver = $v.InnerText } }
        if ($name -and $ver) { $list += [pscustomobject]@{ Name = $name; Version = $ver } }
    }
    return $list
}

# ---------- checks (nothing is created until all pass) ----------
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Write-Host 'dotnet was not found on PATH.' -ForegroundColor Red; return }
$elmApiProj = Join-Path $ElmRoot 'EmployeeLCAPI\EmployeeLCAPI.csproj'
$elmTestDir = Join-Path $ElmRoot 'tests\EmployeeLCAPI.Tests'
if (-not (Test-Path $elmApiProj)) { Write-Host "ELM API project not found: $elmApiProj  (pass -ElmRoot)" -ForegroundColor Red; return }
$elmTestProj = @(Get-ChildItem $elmTestDir -Filter *.csproj -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($elmTestProj.Count -eq 0) { Write-Host "ELM test project not found in $elmTestDir" -ForegroundColor Red; return }
$solutionRoot = Join-Path $Root 'ServiceDeskAPI'
if (Test-Path $solutionRoot) { Write-Host "$solutionRoot already exists. Step 0 looks applied already. Nothing changed." -ForegroundColor Yellow; return }

[xml]$elmXml = [System.IO.File]::ReadAllText($elmApiProj)
$tfmNode = $elmXml.SelectSingleNode('//TargetFramework')
$tfm = if ($tfmNode) { $tfmNode.InnerText.Trim() } else { 'net10.0' }
$sdkMajor = $tfm -replace '^net(\d+)\..*$', '$1'
$sdks = (& dotnet --list-sdks) -join "`n"
if ($sdks -notmatch "(?m)^$sdkMajor\.") { Write-Host "ELM targets $tfm but no .NET $sdkMajor SDK is installed." -ForegroundColor Red; return }

$apiPackages = Get-Packages $elmApiProj
$testPackages = Get-Packages $elmTestProj[0].FullName
Write-Host "  ELM target framework: $tfm"
Write-Host ("  ELM API packages ({0}): {1}" -f $apiPackages.Count, (($apiPackages | ForEach-Object { $_.Name }) -join ', '))
Write-Host ("  ELM test packages ({0}): {1}" -f $testPackages.Count, (($testPackages | ForEach-Object { $_.Name }) -join ', '))

$createdRoot = -not (Test-Path $Root)
$here = Get-Location
try {
    Write-Host '1/7 Creating the solution and projects...'
    New-Item -ItemType Directory -Path $solutionRoot -Force | Out-Null
    Set-Location $solutionRoot
    Invoke-Dotnet @('new', 'sln', '-n', 'ServiceDesk') | Out-Null
    $sln = @(Get-ChildItem $solutionRoot -File | Where-Object { $_.Name -like 'ServiceDesk.sln*' })[0].FullName
    Invoke-Dotnet @('new', 'webapi', '-n', 'ServiceDeskAPI', '-o', 'ServiceDeskAPI', '--use-controllers', '-f', $tfm) | Out-Null
    # The test project file is copied from ELM (same xUnit version and settings), with the names changed.
    $testDirNew = Join-Path $solutionRoot 'tests\ServiceDeskAPI.Tests'
    New-Item -ItemType Directory -Path $testDirNew -Force | Out-Null
    $tpText = [System.IO.File]::ReadAllText($elmTestProj[0].FullName)
    $tpText = $tpText.Replace('EmployeeLCAPI', 'ServiceDeskAPI')
    $tpText = [regex]::Replace($tpText, '(?m)^[ \t]*<UserSecretsId>.*?</UserSecretsId>[ \t]*\r?\n', '')
    [System.IO.File]::WriteAllText((Join-Path $testDirNew 'ServiceDeskAPI.Tests.csproj'), $tpText, $utf8)
    Invoke-Dotnet @('sln', $sln, 'add', 'ServiceDeskAPI\ServiceDeskAPI.csproj') | Out-Null
    Invoke-Dotnet @('sln', $sln, 'add', 'tests\ServiceDeskAPI.Tests\ServiceDeskAPI.Tests.csproj') | Out-Null
    $tpNow = [System.IO.File]::ReadAllText((Join-Path $testDirNew 'ServiceDeskAPI.Tests.csproj'))
    if ($tpNow -notmatch 'ProjectReference[^>]*ServiceDeskAPI\.csproj') {
        Invoke-Dotnet @('add', 'tests\ServiceDeskAPI.Tests\ServiceDeskAPI.Tests.csproj', 'reference', 'ServiceDeskAPI\ServiceDeskAPI.csproj') | Out-Null
    }

    Write-Host '2/7 Adding the same packages and versions as ELM...'
    foreach ($p in $apiPackages) {
        Write-Host ("  API : {0} {1}" -f $p.Name, $p.Version)
        Invoke-Dotnet @('add', 'ServiceDeskAPI\ServiceDeskAPI.csproj', 'package', $p.Name, '--version', $p.Version) | Out-Null
    }
    Write-Host ("  Tests: {0} packages, copied with the ELM test project file" -f $testPackages.Count)
    # The tests use ASP.NET Core types (controllers, results), so give the test project the shared framework.
    $testProj = Join-Path $solutionRoot 'tests\ServiceDeskAPI.Tests\ServiceDeskAPI.Tests.csproj'
    $tp = [System.IO.File]::ReadAllText($testProj)
    if ($tp -notmatch 'Microsoft\.AspNetCore\.App') {
        $tp = $tp.Replace('</Project>', "  <ItemGroup>`r`n    <FrameworkReference Include=`"Microsoft.AspNetCore.App`" />`r`n  </ItemGroup>`r`n</Project>")
        [System.IO.File]::WriteAllText($testProj, $tp, $utf8)
    }

    Write-Host '3/7 Setting up the ELM folder layout...'
    $api = Join-Path $solutionRoot 'ServiceDeskAPI'
    foreach ($f in @('WeatherForecast.cs', 'Controllers\WeatherForecastController.cs')) {
        $p = Join-Path $api $f; if (Test-Path $p) { Remove-Item $p -Force }
    }
    foreach ($d in @('Application\Interfaces', 'Application\DTOs', 'Domain\Entities', 'Domain\Enums',
                     'Infrastructure\Persistence', 'Infrastructure\Services', 'Infrastructure\Email', 'Infrastructure\Jobs')) {
        Write-Text (Join-Path $api "$d\.gitkeep") ''
    }
    Write-Text (Join-Path $api 'Controllers\HealthController.cs') @'
using Microsoft.AspNetCore.Mvc;

namespace ServiceDeskAPI.Controllers;

/// <summary>Liveness check. Replaced by the full health checks in a later step.</summary>
[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { status = "ok", app = "Service Desk: Contribution Processing Module" });
}
'@
    $http = @(Get-ChildItem $api -Filter *.http)
    foreach ($h in $http) {
        Write-Text $h.FullName "@ServiceDeskAPI_HostAddress = http://localhost:5000`n`nGET {{ServiceDeskAPI_HostAddress}}/api/health`nAccept: application/json`n"
    }

    Write-Host '4/7 Writing settings (local database ServiceDeskDB)...'
    Write-Text (Join-Path $api 'appsettings.json') @'
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=ServiceDeskDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
  },
  "App": {
    "Name": "Service Desk: Contribution Processing Module"
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
'@

    Write-Host '5/7 Adding a smoke test...'
    $testDir = Join-Path $solutionRoot 'tests\ServiceDeskAPI.Tests'
    Write-Text (Join-Path $testDir 'Smoke\HealthTests.cs') @'
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Controllers;
using Xunit;

namespace ServiceDeskAPI.Tests.Smoke;

public class HealthTests
{
    [Fact]
    public void Health_returns_ok()
    {
        var result = new HealthController().Get();
        Assert.IsType<OkObjectResult>(result);
    }
}
'@

    Write-Host '6/7 Building and running the tests...'
    Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q') | Out-Null
    $testOut = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $testOut | Where-Object { $_ -match 'Passed!|Failed!|Total' } | ForEach-Object { Write-Host "  $_" }

    Write-Host '7/7 Scripts, docs and git...'
    $scriptsDir = Join-Path $solutionRoot 'scripts'
    New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null
    if ($PSCommandPath) { Copy-Item $PSCommandPath (Join-Path $scriptsDir 'step0-scaffold.ps1') -Force }
    New-Item -ItemType Directory -Path (Join-Path $Root 'docs\api') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Root 'docs\brd') -Force | Out-Null
    Invoke-Dotnet @('new', 'gitignore') | Out-Null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Set-Location $Root
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        if (-not (Test-Path (Join-Path $Root '.git'))) { & git init -q 2>&1 | Out-Null }
        Copy-Item (Join-Path $solutionRoot '.gitignore') (Join-Path $Root '.gitignore') -Force
        & git add -A 2>&1 | Out-Null
        & git commit -q -m 'Step 0: Service Desk scaffold (ServiceDeskAPI, tests, scripts, docs)' 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host '  git: repository created, but the first commit failed (set git user.name and user.email, then commit).' -ForegroundColor Yellow }
        else { Write-Host '  git: repository created with a first commit.' }
        $ErrorActionPreference = $old
    } else {
        Write-Host '  git not found, skipped.' -ForegroundColor Yellow
    }

    Set-Location $here
    Write-Host ''
    Write-Host 'Done. Expected: build OK and 1 test passed.' -ForegroundColor Green
    Write-Host "Solution root (run later steps from here): $solutionRoot"
    Write-Host "Next: copy the docs I sent into $(Join-Path $Root 'docs'), put the approved BRD in docs\brd,"
    Write-Host "then run collect-elm-plumbing.ps1 from the ELM solution root and send me docs\elm-plumbing.txt."
}
catch {
    Set-Location $here
    Write-Host ''
    Write-Host ("FAILED: " + $_.Exception.Message) -ForegroundColor Red
    if ($createdRoot -and (Test-Path $Root)) { Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "Removed $Root. Nothing else was changed." -ForegroundColor Yellow }
    elseif (Test-Path $solutionRoot) { Remove-Item $solutionRoot -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "Removed $solutionRoot. Nothing else was changed." -ForegroundColor Yellow }
    exit 1
}
