# Collect the People Hub (ELM) plumbing into ONE text file, so Step 1 can copy it into the Service Desk exactly.
# Read only: nothing in ELM is changed. No ELM password, key or secret is copied: settings files are reduced to
# setting NAMES only (every value removed), user secrets are never read, and any secret-looking value in code is masked.
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk (it finds ELM by itself):
#   cd C:\Users\<you>\Desktop\PRO\ServiceDesk
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\collect-elm-plumbing.ps1
# Output: ServiceDesk\docs\elm-plumbing.txt
# Other locations:  .\collect-elm-plumbing.ps1 -ElmRoot 'D:\PRO\ELM\EmployeeLCAPI' -OutPath 'D:\PRO\ServiceDesk\docs\elm-plumbing.txt'

param(
    [string]$ElmRoot = (Join-Path $env:USERPROFILE 'Desktop\PRO\ELM\EmployeeLCAPI'),
    [string]$OutPath = (Join-Path $env:USERPROFILE 'Desktop\PRO\ServiceDesk\docs\elm-plumbing.txt')
)

$ErrorActionPreference = 'Stop'
$root = $ElmRoot
$src = Join-Path $root 'EmployeeLCAPI'
$tests = Join-Path $root 'tests\EmployeeLCAPI.Tests'
if (-not (Test-Path (Join-Path $src 'EmployeeLCAPI.csproj'))) { Write-Host "ELM was not found at $root (pass -ElmRoot)." -ForegroundColor Red; return }
$elmTop = Split-Path $root -Parent
Write-Host "  Reading ELM from: $root"

$utf8 = New-Object System.Text.UTF8Encoding($false)
$sb = New-Object System.Text.StringBuilder
function Add-Line([string]$s) { [void]$sb.AppendLine($s) }
function Rel([string]$p) { if ($p.StartsWith($elmTop)) { return $p.Substring($elmTop.Length + 1) } return $p }
function Mask([string]$t) {
    # "SomethingPassword": "value"  /  "ApiKey": "value"  /  "Secret...": "value"
    $t = [regex]::Replace($t, '("(?:[^"]*(?:Password|Pwd|Secret|ApiKey|Key|Token|ClientSecret|SigningKey)[^"]*)"\s*:\s*)"[^"]*"', '$1"***"', 'IgnoreCase')
    # Password=...; inside connection strings
    $t = [regex]::Replace($t, '((?:Password|Pwd)\s*=\s*)[^;"]*', '$1***', 'IgnoreCase')
    return $t
}
function Add-File([string]$path, [int]$maxChars = 40000) {
    Add-Line ('===== FILE: ' + (Rel $path) + ' =====')
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    if ($text.Length -gt $maxChars) { $text = $text.Substring(0, $maxChars) + "`n... (cut at $maxChars characters)" }
    Add-Line (Mask $text)
    Add-Line ''
}

$csFiles = @(Get-ChildItem $src -Recurse -Filter *.cs | Where-Object { $_.FullName -notmatch '\\(obj|bin|Migrations)\\' } | Sort-Object FullName)
$domain = 'Recruit|Candidate|Interview|Exit|Clearance|Requisition|JobPost|Career|Aptitude|Onboard|Offer|Probation|Appraisal|Leave|Payroll|Training|Disciplin|Hold|Scoring|Evaluation|Panel'
$plumbing = 'Auth|Login|Jwt|Token|Ldap|ActiveDirectory|Directory|Email|Mail|Brand|Audit|Role|Policy|Admin|User|Provision|Error|Exception|Middleware|Problem|Current|Claim|Settings|Options|Notification|Hub|SignalR|Health|Swagger|Cors|Seed|DbContext|BaseEntity|Entity\.cs|Result|Paged|Validation'

Write-Host '1/6 File tree...'
Add-Line '########## 1. ELM top-level folders ##########'
Get-ChildItem $elmTop -Directory | ForEach-Object { Add-Line ('[dir] ' + $_.Name) }
Add-Line ''
Add-Line '########## 2. API source tree (no bin/obj/Migrations) ##########'
foreach ($f in $csFiles) { Add-Line ((Rel $f.FullName) + '  (' + $f.Length + ' bytes)') }
Add-Line ''

Write-Host '2/6 Project files, Program.cs and settings...'
Add-Line '########## 3. Project files ##########'
Add-File (Join-Path $src 'EmployeeLCAPI.csproj')
foreach ($p in @(Get-ChildItem $tests -Filter *.csproj)) { Add-File $p.FullName }
Add-Line '########## 4. Program.cs ##########'
Add-File (Join-Path $src 'Program.cs') 80000
Add-Line '########## 5. Settings: names only, every value removed ##########'
foreach ($p in @(Get-ChildItem $src -Filter 'appsettings*.json')) {
    Add-Line ('===== FILE (names only): ' + (Rel $p.FullName) + ' =====')
    $j = [System.IO.File]::ReadAllText($p.FullName, [System.Text.Encoding]::UTF8)
    # Replace every string, number and true/false value with a placeholder; keep only the structure and the names.
    $j = [regex]::Replace($j, '(:\s*)"(?:[^"\\]|\\.)*"', '$1"<value>"')
    $j = [regex]::Replace($j, '(:\s*)(-?\d+(?:\.\d+)?|true|false|null)', '$1<value>')
    $j = [regex]::Replace($j, '(\[\s*)"(?:[^"\\]|\\.)*"', '$1"<value>"')
    Add-Line $j
    Add-Line ''
}
$launch = Join-Path $src 'Properties\launchSettings.json'; if (Test-Path $launch) { Add-File $launch }

Write-Host '3/6 Plumbing source files...'
Add-Line '########## 6. Plumbing source (auth, JWT, LDAP, directory, roles, users, email, audit, notifications, errors, persistence base) ##########'
$picked = @($csFiles | Where-Object { (Rel $_.FullName) -match $plumbing -and $_.Name -notmatch $domain })
foreach ($f in $picked) { Add-File $f.FullName }

Write-Host '4/6 Test infrastructure...'
Add-Line '########## 7. Test infrastructure (fixtures, factories, helpers, auth/email/role tests) ##########'
$testFiles = @(Get-ChildItem $tests -Recurse -Filter *.cs | Where-Object { $_.FullName -notmatch '\\(obj|bin)\\' })
foreach ($f in $testFiles) { Add-Line ('[test] ' + (Rel $f.FullName)) }
Add-Line ''
$testPicked = @($testFiles | Where-Object { $_.Name -match 'Fixture|Factory|Helper|Base|Builder|LocalDb|Collection|TestAuth|Fake|Stub|Auth|Jwt|Email|Role|Admin|Audit' -and $_.Name -notmatch $domain })
foreach ($f in $testPicked) { Add-File $f.FullName 30000 }

Write-Host '5/6 Scripts...'
Add-Line '########## 8. ELM scripts ##########'
$scripts = Join-Path $root 'scripts'
if (Test-Path $scripts) { Get-ChildItem $scripts -File | Sort-Object Name | ForEach-Object { Add-Line ('[script] ' + $_.Name) } }
foreach ($n in @('dev-switch-role.ps1', 'set-infobip-key.ps1')) { $p = Join-Path $scripts $n; if (Test-Path $p) { Add-File $p } }
Add-Line ''

Write-Host '6/6 Frontend tooling...'
Add-Line '########## 9. Frontend (People Hub) tooling ##########'
$fe = @(Get-ChildItem $elmTop -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'package.json') })
foreach ($d in $fe) {
    Add-Line ('[frontend] ' + $d.Name)
    Add-File (Join-Path $d.FullName 'package.json')
    foreach ($cfg in @(Get-ChildItem $d.FullName -File | Where-Object { $_.Name -match '^(vite|vitest|eslint|\.eslintrc|prettier|\.prettierrc|jsconfig|\.env\.example)' })) { Add-File $cfg.FullName 15000 }
    $feScripts = Join-Path $d.FullName 'scripts'
    if (Test-Path $feScripts) { Get-ChildItem $feScripts -File | ForEach-Object { Add-Line ('[fe-script] ' + $_.Name) } }
    $feSrc = Join-Path $d.FullName 'src'
    if (Test-Path $feSrc) {
        Get-ChildItem $feSrc -Directory -Recurse -Depth 2 | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object { Add-Line ('[fe-dir] ' + (Rel $_.FullName)) }
    }
    Add-Line ''
}
$docs = Join-Path $elmTop 'docs'
if (Test-Path $docs) { Get-ChildItem $docs -Recurse -File | Where-Object { $_.Extension -in '.md', '.json' } | ForEach-Object { Add-Line ('[doc] ' + (Rel $_.FullName)) } }

$outDir = Split-Path $OutPath -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
[System.IO.File]::WriteAllText($OutPath, $sb.ToString(), $utf8)
$kb = [math]::Round((Get-Item $OutPath).Length / 1KB)
Write-Host ''
Write-Host ("Done. Wrote {0} ({1} KB): {2} plumbing files, {3} test helpers." -f $OutPath, $kb, $picked.Count, $testPicked.Count) -ForegroundColor Green
Write-Host 'Settings were copied as names only. Still, search the file for Password, Key, Secret and Token before sending it.'
