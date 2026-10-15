$ErrorActionPreference = "Continue"
Set-Location E:\jjjjjj
node fix-pollinations2.mjs > fix-run.log 2>&1
node --check api/services/pollinationsService.js >> fix-run.log 2>&1
node --check api/services/websiteService.js >> fix-run.log 2>&1
if ($?) { Add-Content fix-run.log "syntax OK" }
Get-Content fix-run.log
