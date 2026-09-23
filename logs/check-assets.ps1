# Verifies the exact assets referenced by index.html.
$ErrorActionPreference = 'Continue'

$out = 'F:\jjjjjj\logs\_assets.txt'
$url = 'http://localhost:3002'
$lines = @()

foreach ($asset in @('/css/style.css', '/assets/logo-mark.svg', '/', '/login.html', '/dashboard.html', '/crm.html', '/reports.html', '/analytics.html', '/admin.html', '/profile.html', '/settings.html', '/lead-details.html', '/client-report.html', '/billing-success.html')) {
  try {
    $res = Invoke-WebRequest -Uri "$url$asset" -UseBasicParsing -TimeoutSec 10
    $title = ''
    if ($res.Content -match '<title>(.*?)</title>') { $title = $Matches[1] }
    $lines += "OK  $asset  $($res.StatusCode)  len=$($res.RawContentLength)  $($res.Headers['Content-Type'])  $title"
  } catch { $lines += "ERR $asset  $($_.Exception.Message)" }
}

$lines | Out-File -FilePath $out -Encoding utf8
