# Verifies the running local site (health, static assets, owner login, browser window, listener).
$ErrorActionPreference = 'Continue'

$root = 'F:\jjjjjj'
$out = Join-Path $root 'logs\_verify.txt'
$port = 3002
$url = "http://localhost:$port"
$lines = @()

function Add-Line([string]$text) { $script:lines += $text }

Add-Line "--- listener on $port ---"
Add-Line (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq $port } |
  Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String)

Add-Line "--- /api/health ---"
try {
  $health = Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 10
  Add-Line "STATUS=$($health.StatusCode)"
  Add-Line $health.Content
} catch { Add-Line "ERROR=$($_.Exception.Message)" }

Add-Line "--- static assets ---"
$assets = @('/css/styles.css', '/js/app.js', '/js/api.js', '/sw.js', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml')
foreach ($asset in $assets) {
  try {
    $res = Invoke-WebRequest -Uri "$url$asset" -UseBasicParsing -TimeoutSec 10
    Add-Line "OK  $asset  $($res.StatusCode)  $($res.Headers['Content-Type'])"
  } catch { Add-Line "ERR $asset  $($_.Exception.Message)" }
}

Add-Line "--- css folder contents (actual filenames) ---"
Add-Line ((Get-ChildItem (Join-Path $root 'css') -File | Select-Object -ExpandProperty Name) -join ', ')

Add-Line "--- owner login ---"
try {
  $body = @{ email = 'owner@matleads.local'; password = 'admin2026' } | ConvertTo-Json
  $login = Invoke-WebRequest -Uri "$url/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 30
  Add-Line "STATUS=$($login.StatusCode)"
  Add-Line $login.Content
} catch {
  Add-Line "ERROR=$($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Add-Line "BODY=$($reader.ReadToEnd())"
  }
}

Add-Line "--- browser windows holding the URL ---"
$browsers = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe' OR Name='firefox.exe' OR Name='brave.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*localhost:$port*" }
if ($browsers) { Add-Line ($browsers | Select-Object Name, ProcessId | Format-Table -AutoSize | Out-String) }
else { Add-Line "no browser process found with the URL on its command line" }

$lines | Out-File -FilePath $out -Encoding utf8
