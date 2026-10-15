$body = '{"model":"openai/gpt-5.4-nano","messages":[{"role":"user","content":"say ok"}],"max_tokens":10}'
$res = @()
try {
  $r = Invoke-WebRequest -Uri 'https://gen.pollinations.ai/v1/chat/completions?key=pk_Cs6VLsAnAwJnVCfd' -Method Post -Headers @{ 'Content-Type' = 'application/json' } -Body $body -TimeoutSec 60 -UseBasicParsing
  $res += 'QUERY-PARAM: OK ' + $r.StatusCode
} catch {
  $res += 'QUERY-PARAM FAIL: ' + $_.ErrorDetails.Message
}
try {
  $r2 = Invoke-WebRequest -Uri 'https://gen.pollinations.ai/v1/chat/completions' -Method Post -Headers @{ 'Content-Type' = 'application/json' } -Body $body -TimeoutSec 60 -UseBasicParsing
  $res += 'NO-AUTH: OK ' + $r2.StatusCode
} catch {
  $res += 'NO-AUTH FAIL: ' + $_.ErrorDetails.Message
}
$res | Set-Content -Path 'E:\jjjjjj\ai-test2.txt' -Encoding UTF8
Write-Output 'done'
