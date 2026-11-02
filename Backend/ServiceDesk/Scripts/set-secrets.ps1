# Service Desk secrets for THIS computer (Development). They are stored in .NET user secrets for ServiceDeskAPI only,
# never in source control and never shared with People Hub.
#
#   - JwtSettings:SecretKey     a NEW random signing key made here (People Hub's key is never used)
#   - TestAccounts:Password     a NEW random password for the test.* accounts (Development only)
#   - LdapSettings:*            the Service Desk's OWN AD settings and service account entry, typed in by you
#   - EmailSettings:*           the email provider and the Service Desk's OWN Infobip key or SMTP sign-in (-Email)
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk (after step1a-identity-auth.ps1):
#   .\set-secrets.ps1                    first time: new key, new test password, then asks for the AD settings
#   .\set-secrets.ps1 -SkipLdap          no AD yet: test accounts only
#   .\set-secrets.ps1 -NewJwtKey         replace the signing key (everyone has to sign in again)
#   .\set-secrets.ps1 -NewTestPassword   make and show a new test-account password
#   .\set-secrets.ps1 -LdapOnly          only (re)enter the AD settings
#   .\set-secrets.ps1 -Email             only enter the email settings (Infobip, SMTP or Off) and the Service Desk's own key
# Values are never printed, except a newly made test-account password, which you need to sign in.
# On a server, use environment variables instead: SERVICEDESK_JWT_SECRET_KEY, SERVICEDESK_LDAP_USERNAME, SERVICEDESK_LDAP_PASSWORD,
# SERVICEDESK_INFOBIP_API_KEY, SERVICEDESK_SMTP_USERNAME, SERVICEDESK_SMTP_PASSWORD. People Hub's variables are never read.

param(
    [switch]$SkipLdap,
    [switch]$NewJwtKey,
    [switch]$NewTestPassword,
    [switch]$LdapOnly,
    [switch]$Email
)

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if ((Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) -and (Test-Path (Join-Path $candidate 'tests\ServiceDeskAPI.Tests'))) { $root = $candidate; break }
}
if (-not $root) { Write-Host 'Run this from C:\Users\<you>\Desktop\PRO\ServiceDesk (the folder that contains ServiceDeskAPI and docs).' -ForegroundColor Red; return }

$projPath = Join-Path $root 'ServiceDeskAPI\ServiceDeskAPI.csproj'
$m = [regex]::Match([System.IO.File]::ReadAllText($projPath), '<UserSecretsId>(.*?)</UserSecretsId>')
if (-not $m.Success) { Write-Host 'ServiceDeskAPI.csproj has no UserSecretsId yet. Run step1a-identity-auth.ps1 first.' -ForegroundColor Red; return }
$secretsId = $m.Groups[1].Value.Trim()

# Safety: the Service Desk must not share People Hub's secrets store.
$elmProj = Join-Path $env:USERPROFILE 'Desktop\PRO\ELM\EmployeeLCAPI\EmployeeLCAPI\EmployeeLCAPI.csproj'
if (Test-Path $elmProj) {
    $e = [regex]::Match([System.IO.File]::ReadAllText($elmProj), '<UserSecretsId>(.*?)</UserSecretsId>')
    if ($e.Success -and $e.Groups[1].Value.Trim() -eq $secretsId) {
        Write-Host "ServiceDeskAPI uses People Hub's user-secrets id. Nothing was written. Run step1a-identity-auth.ps1 or give the project a new UserSecretsId." -ForegroundColor Red
        return
    }
}

$secretsDir = Join-Path $env:APPDATA "Microsoft\UserSecrets\$secretsId"
$secretsFile = Join-Path $secretsDir 'secrets.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# Read the existing secrets (flat "Section:Key" names, as dotnet user-secrets writes them)
$secrets = [ordered]@{}
if (Test-Path $secretsFile) {
    $raw = [System.IO.File]::ReadAllText($secretsFile)
    if ($raw.Trim().Length -gt 0) {
        $obj = $raw | ConvertFrom-Json
        foreach ($p in $obj.PSObject.Properties) { $secrets[$p.Name] = [string]$p.Value }
    }
}
function Read-Secret([string]$prompt) {
    $secure = Read-Host $prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
function Read-WithDefault([string]$prompt, [string]$default) {
    $v = (Read-Host "$prompt [$default]").Trim()
    if ($v) { return $v } else { return $default }
}
function Has([string]$k) { return $secrets.Contains($k) -and -not [string]::IsNullOrWhiteSpace($secrets[$k]) }

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-RandomBytes([int]$n) { $b = New-Object byte[] $n; $rng.GetBytes($b); return $b }

$changed = @()

if (-not $LdapOnly -and -not $Email) {
    # ---- JWT signing key: made here, 64 random bytes ----
    if ($NewJwtKey -or -not (Has 'JwtSettings:SecretKey')) {
        $secrets['JwtSettings:SecretKey'] = [Convert]::ToBase64String((New-RandomBytes 64))
        $changed += 'JwtSettings:SecretKey (new, not shown)'
    }
    else { Write-Host '  JWT signing key: kept (use -NewJwtKey to replace it)' }

    # ---- Test-account password: made here; meets the Identity rules (upper, lower, digit, symbol, 8+) ----
    if ($NewTestPassword -or -not (Has 'TestAccounts:Password')) {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
        $bytes = New-RandomBytes 14
        $middle = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
        $testPassword = 'Sd-' + $middle + '#7'
        $secrets['TestAccounts:Password'] = $testPassword
        $changed += 'TestAccounts:Password (new)'
    }
    else { Write-Host '  Test-account password: kept (use -NewTestPassword for a new one)' }
}

if (-not $SkipLdap -and -not $Email) {
    Write-Host ''
    Write-Host 'AD settings for the Service Desk.' -ForegroundColor Cyan
    Write-Host "Use the Service Desk's own service account entry, not People Hub's. Leave the server blank to skip AD for now."
    $server = (Read-Host 'AD server (domain controller host name; LDAPS on port 636)').Trim()
    if ($server) {
        $domain = (Read-Host 'Domain name (for example company.local)').Trim()
        $baseDn = (Read-Host 'Base DN (for example DC=company,DC=local)').Trim()
        $svcUser = (Read-Host 'Service Desk service account user name').Trim()
        $svcSecure = Read-Host 'Service Desk service account password' -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($svcSecure)
        try { $svcPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

        $blank = @()
        if (-not $domain) { $blank += 'domain name' }
        if (-not $baseDn) { $blank += 'base DN' }
        if (-not $svcUser) { $blank += 'service account user name' }
        if (-not $svcPassword) { $blank += 'service account password' }
        if ($blank.Count -gt 0) {
            Write-Host ('AD settings not saved; these were blank: ' + ($blank -join ', ') + '. Run .\set-secrets.ps1 -LdapOnly to try again.') -ForegroundColor Yellow
        }
        else {
            $secrets['LdapSettings:Server'] = $server
            $secrets['LdapSettings:DomainName'] = $domain
            $secrets['LdapSettings:BaseDn'] = $baseDn
            $secrets['LdapSettings:ServiceAccountUsername'] = $svcUser
            $secrets['LdapSettings:ServiceAccountPassword'] = $svcPassword
            $changed += 'LdapSettings: Server, DomainName, BaseDn, ServiceAccountUsername, ServiceAccountPassword (not shown)'
        }
        $svcPassword = $null
    }
    else { Write-Host '  AD: skipped. AD sign-in stays off; test accounts work in Development.' }
}

# A plain run offers email set-up while it is not done yet
if (-not $Email -and -not $LdapOnly -and -not (Has 'EmailSettings:Provider')) {
    Write-Host ''
    $answer = (Read-Host 'Email is not set up yet. Set up Infobip now? (y/N)').Trim()
    if ($answer -match '^(?i)y') { $Email = $true }
}

if ($Email) {
    Write-Host ''
    Write-Host 'Email settings for the Service Desk.' -ForegroundColor Cyan
    Write-Host "Use the Service Desk's own Infobip key or mailbox, not People Hub's."
    $provider = Read-WithDefault 'Provider: Infobip, Smtp or Off' 'Infobip'
    switch -Regex ($provider) {
        '^(?i)infobip$' {
            $baseUrl = (Read-Host 'Infobip base URL (for example xxxxx.api.infobip.com)').Trim()
            $sender = (Read-Host 'Sender address (must be verified in Infobip)').Trim()
            $senderName = Read-WithDefault 'Sender name' 'Contribution Processing'
            $key = Read-Secret 'Service Desk Infobip API key'
            if (-not $baseUrl -or -not $sender -or -not $key) { Write-Host 'Email settings not saved: base URL, sender and key are all needed.' -ForegroundColor Yellow; break }
            $secrets['EmailSettings:Provider'] = 'Infobip'
            $secrets['EmailSettings:Infobip:BaseUrl'] = $baseUrl
            $secrets['EmailSettings:Infobip:SenderEmail'] = $sender
            $secrets['EmailSettings:Infobip:SenderName'] = $senderName
            $secrets['EmailSettings:Infobip:ApiKey'] = $key
            $key = $null
            $changed += 'EmailSettings: Provider=Infobip, BaseUrl, SenderEmail, SenderName, ApiKey (not shown)'
        }
        '^(?i)smtp$' {
            $smtpHost = (Read-Host 'SMTP host').Trim()
            $port = Read-WithDefault 'Port' '587'
            $ssl = Read-WithDefault 'Use TLS/SSL (true/false)' 'true'
            $sender = (Read-Host 'Sender address').Trim()
            $senderName = Read-WithDefault 'Sender name' 'Contribution Processing'
            $smtpUser = (Read-Host 'Mailbox user name (blank for an internal relay that needs no sign-in)').Trim()
            $smtpPassword = if ($smtpUser) { Read-Secret 'Mailbox password' } else { '' }
            if (-not $smtpHost -or -not $sender) { Write-Host 'Email settings not saved: host and sender are needed.' -ForegroundColor Yellow; break }
            $secrets['EmailSettings:Provider'] = 'Smtp'
            $secrets['EmailSettings:Smtp:Host'] = $smtpHost
            $secrets['EmailSettings:Smtp:Port'] = $port
            $secrets['EmailSettings:Smtp:EnableSsl'] = $ssl
            $secrets['EmailSettings:Smtp:SenderEmail'] = $sender
            $secrets['EmailSettings:Smtp:SenderName'] = $senderName
            $secrets['EmailSettings:Smtp:Username'] = $smtpUser
            $secrets['EmailSettings:Smtp:Password'] = $smtpPassword
            $smtpPassword = $null
            $changed += 'EmailSettings: Provider=Smtp, Host, Port, EnableSsl, SenderEmail, SenderName, Username, Password (not shown)'
        }
        default {
            $secrets['EmailSettings:Provider'] = 'Off'
            $changed += 'EmailSettings:Provider=Off (no email is sent)'
        }
    }
}

if ($changed.Count -eq 0) { Write-Host 'Nothing changed.'; return }

if (-not (Test-Path $secretsDir)) { New-Item -ItemType Directory -Path $secretsDir -Force | Out-Null }
$json = ([pscustomobject]$secrets | ConvertTo-Json -Depth 2)
[System.IO.File]::WriteAllText($secretsFile, $json, $utf8)

Write-Host ''
Write-Host 'Saved to the Service Desk user secrets (this computer only):' -ForegroundColor Green
$changed | ForEach-Object { Write-Host "  - $_" }
if ($testPassword) {
    Write-Host ''
    Write-Host "Test-account password (Development only): $testPassword" -ForegroundColor Cyan
    Write-Host '  Accounts: test.requester, test.caseworker1, test.caseworker2, test.hou, test.hod, test.superadmin'
}
Write-Host ''
Write-Host 'Restart the API if it is running.'
