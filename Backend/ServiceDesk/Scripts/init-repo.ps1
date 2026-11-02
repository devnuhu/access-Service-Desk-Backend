# Starts a clean Git repository for Access Desk in PRO\AccessServiceDesk only (Backend + Frontend + docs),
# separate from the Git repository that covers your Desktop. Makes the first commit after a secret check.
# Nothing outside PRO\AccessServiceDesk is touched; the Desktop repository is left exactly as it is.
#
# Run from C:\Users\<you>\Desktop\PRO\AccessServiceDesk:
#   .\Backend\ServiceDesk\Scripts\init-repo.ps1
# (or from Backend\ServiceDesk: .\Scripts\init-repo.ps1 -Root ..\..)

param(
    [string]$Root = ''
)

$ErrorActionPreference = 'Stop'

# ---- find PRO\AccessServiceDesk (the folder with Backend and Frontend) ----
$candidates = @()
if ($Root) { $candidates += (Resolve-Path $Root).Path }
$p = (Get-Location).Path
for ($i = 0; $i -lt 4 -and $p; $i++) { $candidates += $p; $p = Split-Path $p -Parent }
$Root = $candidates | Where-Object { (Test-Path (Join-Path $_ 'Backend')) -and (Test-Path (Join-Path $_ 'Frontend')) } | Select-Object -First 1
if (-not $Root) { Write-Host 'Could not find the AccessServiceDesk folder (the one with Backend and Frontend). Run this from inside it.' -ForegroundColor Red; return }
Write-Host "  Repository folder: $Root"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host 'git was not found on PATH.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $Root '.git')) { Write-Host "$Root is already a Git repository. Nothing changed." -ForegroundColor Yellow; return }

# ---- nested repositories (for example one made by an earlier scaffold) would split the history ----
$nested = @(Get-ChildItem $Root -Recurse -Force -Directory -Filter '.git' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' })
if ($nested.Count -gt 0) {
    Write-Host 'These folders already have their own Git repository inside AccessServiceDesk:' -ForegroundColor Red
    $nested | ForEach-Object { Write-Host ('    ' + $_.Parent.FullName) }
    Write-Host 'Nothing changed. Send me this list: if they hold nothing you need, they can be renamed (for example to .git-old) first.'
    return
}

# ---- who commits ----
$name = (& git config --get user.name) 2>$null
$email = (& git config --get user.email) 2>$null
if (-not $name -or -not $email) {
    Write-Host 'Git does not know who you are yet. Run these once, then this script again:' -ForegroundColor Yellow
    Write-Host '    git config --global user.name "Your Name"'
    Write-Host '    git config --global user.email "you@accesspensions.ng"'
    return
}

# ---- .gitignore at the root: build output, local settings, editor folders, anything secret-shaped ----
$gitignore = Join-Path $Root '.gitignore'
$rules = @'
# Access Desk: one repository for Backend, Frontend and docs

# .NET build output and tools
bin/
obj/
.vs/
*.user
*.suo
TestResults/

# Node / Vite
node_modules/
dist/
coverage/
*.local

# Local settings and anything secret. Keys live in user secrets or server environment variables, never here.
.env
.env.*
!.env.example
appsettings.*.local.json
secrets.json
*.pfx
*.key

# OS and editors
Thumbs.db
.DS_Store
.idea/
'@
if (Test-Path $gitignore) {
    $existing = [System.IO.File]::ReadAllText($gitignore)
    $missing = @($rules.Split("`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') -and -not $existing.Contains($_) })
    if ($missing.Count -gt 0) { Add-Content -Path $gitignore -Value ("`r`n# Added by init-repo.ps1`r`n" + ($missing -join "`r`n")) }
}
else {
    [System.IO.File]::WriteAllText($gitignore, $rules.Replace("`r`n", "`n").Replace("`n", "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
}

Push-Location $Root
try {
    & git init -b main | Out-Null
    if ($LASTEXITCODE -ne 0) { & git init | Out-Null; & git checkout -b main 2>$null | Out-Null }
    & git add -A
    $files = @(& git diff --cached --name-only)
    Write-Host ("  {0} files ready for the first commit" -f $files.Count)

    # ---- secret check on everything about to be committed ----
    $patterns = @(
        '"(SecretKey|ApiKey|ServiceAccountPassword|Password)"\s*:\s*"[^"<]{6,}"',   # a filled-in secret setting
        '(JWT_SECRET_KEY|SERVICEDESK_[A-Z_]+|INFOBIP_API_KEY)\s*[=:]\s*\S{6,}',       # an environment variable with a value
        'BEGIN (RSA |EC )?PRIVATE KEY'
    )
    $hits = @()
    foreach ($pattern in $patterns) {
        $found = & git grep --cached -n -I -E $pattern -- . ':!*.md' ':!*.ps1' 2>$null
        if ($found) { $hits += $found }
    }
    if ($hits.Count -gt 0) {
        Write-Host 'Possible secrets in files about to be committed. Nothing was committed:' -ForegroundColor Red
        $hits | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
        & git reset -q
        Write-Host 'The repository was created but is empty. Remove the values (keys belong in user secrets), then run:  git add -A; git commit' -ForegroundColor Yellow
        return
    }

    $big = @($files | Where-Object { (Test-Path $_) -and (Get-Item $_).Length -gt 5MB })
    if ($big.Count -gt 0) { Write-Host 'Large files (over 5 MB) in the commit:' -ForegroundColor Yellow; $big | ForEach-Object { Write-Host "    $_" } }

    Write-Host ''
    Write-Host 'Top folders in the commit:'
    $files | ForEach-Object { ($_ -split '/')[0..([Math]::Min(1, ($_ -split '/').Count - 1))] -join '/' } | Group-Object | Sort-Object Name |
        ForEach-Object { Write-Host ("    {0,-45} {1} files" -f $_.Name, $_.Count) }
    $answer = (Read-Host 'Make the first commit now? (y/N)').Trim()
    if ($answer -notmatch '^(?i)y') { Write-Host 'Not committed. The files are staged; commit later with: git commit -m "Access Desk: Step 1 and FE-0"' -ForegroundColor Yellow; return }

    $message = @'
Access Desk: Step 1 (sign-in, roles, audit, security, notifications, email, admin) and FE-0 web app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014RePWkKvmWG2yL8JEuG1Np
'@
    $msgFile = Join-Path ([System.IO.Path]::GetTempPath()) ('accessdesk-commit-' + [guid]::NewGuid() + '.txt')
    [System.IO.File]::WriteAllText($msgFile, $message, (New-Object System.Text.UTF8Encoding($false)))
    & git commit -q -F $msgFile
    Remove-Item $msgFile -Force
    if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
    Write-Host ''
    Write-Host ('Done. First commit: ' + (& git log --oneline -1)) -ForegroundColor Green
    Write-Host 'Your Desktop repository may now list PRO\AccessServiceDesk as a folder with its own repository; that is expected and harmless.'
}
finally {
    Pop-Location
}
