# Make the API open Swagger in the browser on start (as People Hub does): launchBrowser = true, launchUrl = swagger.
# Changes only ServiceDeskAPI\Properties\launchSettings.json. Adds no keys or secrets.
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk:  .\Scripts\fix-launch-swagger.ps1

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if (Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) { $root = $candidate; break }
}
if (-not $root) { Write-Host 'Run this from C:\Users\<you>\Desktop\PRO\ServiceDesk.' -ForegroundColor Red; return }

$path = Join-Path $root 'ServiceDeskAPI\Properties\launchSettings.json'
if (-not (Test-Path $path)) { Write-Host "Not found: $path" -ForegroundColor Red; return }

$json = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
$changed = 0
foreach ($p in $json.profiles.PSObject.Properties) {
    $profile = $p.Value
    if ($profile.commandName -ne 'Project') { continue }
    if ($profile.PSObject.Properties['launchBrowser']) { $profile.launchBrowser = $true } else { $profile | Add-Member -NotePropertyName launchBrowser -NotePropertyValue $true }
    if ($profile.PSObject.Properties['launchUrl']) { $profile.launchUrl = 'swagger' } else { $profile | Add-Member -NotePropertyName launchUrl -NotePropertyValue 'swagger' }
    Write-Host ("  {0}: {1}/swagger" -f $p.Name, (($profile.applicationUrl -split ';')[0]))
    $changed++
}
if ($changed -eq 0) { Write-Host 'No Project profiles found; nothing changed.' -ForegroundColor Yellow; return }

[System.IO.File]::WriteAllText($path, ($json | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Done. Swagger now opens when the API starts from Visual Studio or with: dotnet watch run --launch-profile https' -ForegroundColor Green
Write-Host 'Plain dotnet run does not open a browser; go to the address above yourself.'
