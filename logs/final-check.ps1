# Cleanup of temporary diagnostics + final liveness report for the running site.
$ErrorActionPreference = 'Continue'

$root = 'F:\jjjjjj'
$logDir = Join-Path $root 'logs'
$out = Join-Path $logDir '_final.txt'
$lines = @()

# 1. Remove temporary diagnostic files created during setup.
$temp = @('_diag_node.txt', '_diag_pid.txt', '_diag_http.txt', '_diag_routes.txt', '_diag_cors.txt',
  '_diag_ports.txt', '_diag_ports2.txt', '_diag_ports3.txt', '_verify_launch.txt', '_verifyA.txt')
foreach ($name in $temp) {
  $full = Join-Path $logDir $name
  if (Test-Path $full) { Remove-Item $full -Force; $lines += "removed $name" }
}

# 2. Report the listener used by the site and who owns the neighbouring ports.
$url = 'http://localhost:3002'
$lines += "--- listeners 3000-3002 ---"
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3002 }
foreach ($item in $listeners) {
  $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue
  $lines += ("{0}  pid={1}  name={2}" -f $item.LocalPort, $item.OwningProcess, $proc.ProcessName)
}

# 3. Final health probe.
$lines += "--- site health ---"
try {
  $health = Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 10
  $lines += "STATUS=$($health.StatusCode)"
  $lines += ($health.Content | ConvertFrom-Json | Select-Object status, service, realMode | Out-String)
} catch { $lines += "ERROR=$($_.Exception.Message)" }

$lines | Out-File -FilePath $out -Encoding utf8
