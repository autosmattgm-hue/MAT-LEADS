$key = 'pk_Cs6VLsAnAwJnVCfd'
$out = @()
$models = @('openai/gpt-5.4-nano','openai/gpt-5-nano','google/gemini-3-flash-preview','openai/gpt-4o-mini','openai/gpt-5.4','openai/gpt-5.4-mini')
foreach ($m in $models) {
  $body = @{ model = $m; messages = @(@{ role = 'user'; content = 'say ok' }); max_tokens = 10 } | ConvertTo-Json -Depth 5
  try {
    $r = Invoke-WebRequest -Uri 'https://gen.pollinations.ai/v1/chat/completions' -Method Post -Headers @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' } -Body $body -TimeoutSec 60 -UseBasicParsing
    $out += "$m : OK $($r.StatusCode)"
  } catch {
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    $out += "$m : FAIL $msg"
  }
}
$out | Set-Content -Path 'E:\jjjjjj\ai-test-results.txt' -Encoding UTF8
Write-Output 'done'
