# Re-opens the local site in the default browser and reports browser window titles.
$ErrorActionPreference = 'Continue'

$out = 'F:\jjjjjj\logs\_browser.txt'
$url = 'http://localhost:3002'
$lines = @()

$lines += "--- browsers before ---"
$lines += (Get-Process msedge, chrome, firefox, brave -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle } |
  Select-Object ProcessName, Id, MainWindowTitle | Format-Table -AutoSize | Out-String)

$lines += "--- launching $url ---"
Start-Process $url
Start-Sleep -Seconds 6

$lines += "--- browsers after ---"
$lines += (Get-Process msedge, chrome, firefox, brave -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle } |
  Select-Object ProcessName, Id, MainWindowTitle | Format-Table -AutoSize | Out-String)

$lines | Out-File -FilePath $out -Encoding utf8
