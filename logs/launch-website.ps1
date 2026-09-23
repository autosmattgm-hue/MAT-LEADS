# Launches the MAT LEADS AI PRO X local web server and opens it in the default browser.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File "F:\jjjjjj\logs\launch-website.ps1"

$ErrorActionPreference = 'Continue'

$root = 'F:\jjjjjj'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$statusFile = Join-Path $logDir 'web-server.status.log'
$lines = @()
$lines += "STARTED_AT=$(Get-Date -Format o)"

# 1. Pick a free port. Port 3000 is preferred (VS Code Live Preview often holds it).
$busyPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty LocalPort)
$port = 3000
while ($busyPorts -contains $port) { $port++ }
$lines += "PORT=$port"

# 2. Start the app's own Node server (serves static files plus /api/* routes).
$env:PORT = "$port"
$env:APP_URL = "http://localhost:$port"
$env:CORS_ORIGINS = "http://localhost:$port"

$outLog = Join-Path $logDir 'web-server.out.log'
$errLog = Join-Path $logDir 'web-server.err.log'

$proc = Start-Process -FilePath 'node' `
  -ArgumentList 'api/server.js' `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

$lines += "PID=$($proc.Id)"
$proc.Id | Out-File -FilePath (Join-Path $logDir 'web-server.pid') -Encoding ascii

# 3. Wait for the server to answer on /api/health.
$url = "http://localhost:$port"
$ready = $false
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 400
  if ($proc.HasExited) { break }
  try {
    $health = Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 5
    if ($health.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

$lines += "HEALTH_READY=$ready"
$lines += "PROCESS_EXITED=$($proc.HasExited)"

# 4. Verify the main pages render before opening the browser.
if ($ready) {
  foreach ($page in @('/', '/login.html', '/signup.html', '/pricing.html')) {
    try {
      $res = Invoke-WebRequest -Uri "$url$page" -UseBasicParsing -TimeoutSec 10
      $lines += "PAGE $page -> $($res.StatusCode)"
    } catch {
      $lines += "PAGE $page -> ERROR $($_.Exception.Message)"
    }
  }
}

# 5. Open the site in the default browser.
if ($ready) {
  Start-Process $url
  $lines += "BROWSER_OPENED=$url"
} else {
  $lines += 'BROWSER_OPENED=none'
  if (Test-Path $errLog) { $lines += (Get-Content $errLog -Tail 20) }
}

$lines | Out-File -FilePath $statusFile -Encoding utf8
