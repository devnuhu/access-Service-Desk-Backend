# Fix: Swagger requests are refused with 403 "Security check failed" after signing in through Swagger.
# Cause: signing in sets the HttpOnly cookie in the browser, so Swagger sends the cookie AND the Bearer header,
# and the CSRF check asked for X-CSRF-Token because a cookie was present.
# Fix: no CSRF token is needed when the request carries an Authorization: Bearer header. Another website cannot add
# that header to a request (the browser blocks it unless CORS allows that site), so the check adds nothing there.
# Cookie-only requests (the web app) are still checked exactly as before. Adds one test.
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk with the API stopped:  .\Scripts\fix-csrf-swagger.ps1
# On any failure, both files are put back as they were.

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if ((Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) -and (Test-Path (Join-Path $candidate 'tests\ServiceDeskAPI.Tests'))) { $root = $candidate; break }
}
if (-not $root) { Write-Host 'Run this from C:\Users\<you>\Desktop\PRO\ServiceDesk.' -ForegroundColor Red; return }

$mwPath = Join-Path $root 'ServiceDeskAPI\Infrastructure\Middleware\CsrfProtectionMiddleware.cs'
$testPath = Join-Path $root 'tests\ServiceDeskAPI.Tests\Security\MiddlewareTests.cs'
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($p in @($mwPath, $testPath)) { if (-not (Test-Path $p)) { Write-Host "Not found: $p (run Step 1b first)." -ForegroundColor Red; return } }

$mwOld = [System.IO.File]::ReadAllText($mwPath)
$testOld = [System.IO.File]::ReadAllText($testPath)
if ($mwOld.Contains('StartsWith("Bearer "')) { Write-Host 'Already fixed. Nothing changed.' -ForegroundColor Yellow; return }

$mw = $mwOld.Replace("`r`n", "`n")
$anchor = "                || AuthCookies.ReadAccessToken(request) == null)`n"
if (-not $mw.Contains($anchor)) { Write-Host 'CsrfProtectionMiddleware.cs is not the Step 1b version. Send me the file.' -ForegroundColor Red; return }
$mw = $mw.Replace($anchor, "                || AuthCookies.ReadAccessToken(request) == null`n                // A Bearer header cannot be added by another site, so it needs no CSRF token (Swagger, scripts)`n                || request.Headers.Authorization.ToString().StartsWith(`"Bearer `", StringComparison.OrdinalIgnoreCase))`n")

$test = $testOld.Replace("`r`n", "`n")
$testAnchor = "        [Fact]`n        public void Sign_in_routes_are_rate_limited()"
if (-not $test.Contains($testAnchor)) { Write-Host 'MiddlewareTests.cs is not the Step 1b version. Send me the file.' -ForegroundColor Red; return }
$newTest = @'
        [Fact]
        public async Task A_request_with_cookie_and_Bearer_header_needs_no_CSRF_token()
        {
            // What Swagger sends after signing in through it: the browser cookie plus the Authorization header
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.hod");
            var request = CookieRequest(signIn, false, null);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var response = await ApiTestHelpers.Client(_factory).SendAsync(request);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }


'@
$test = $test.Replace($testAnchor, $newTest.Replace("`r`n", "`n") + $testAnchor)

try {
    [System.IO.File]::WriteAllText($mwPath, $mw.Replace("`n", "`r`n"), $utf8)
    [System.IO.File]::WriteAllText($testPath, $test.Replace("`n", "`r`n"), $utf8)

    Write-Host 'Building and running all tests...'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $b = & dotnet build $sln -nologo -v q 2>&1 | ForEach-Object { "$_" }; $buildExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($buildExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 20 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }
    $ErrorActionPreference = 'Continue'
    $t = & dotnet test $sln --no-build -nologo 2>&1 | ForEach-Object { "$_" }; $testExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($testExit -ne 0) { throw 'Tests failed.' }
    Write-Host 'Done. Swagger works with the Authorize button even after signing in through Swagger.' -ForegroundColor Green
}
catch {
    Write-Host ('FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    [System.IO.File]::WriteAllText($mwPath, $mwOld, $utf8)
    [System.IO.File]::WriteAllText($testPath, $testOld, $utf8)
    Write-Host 'Both files were put back as they were.' -ForegroundColor Yellow
    exit 1
}
