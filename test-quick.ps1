$key = 'pk_Cs6VLsAnAwJnVCfd'
$out = @()
$models = @('openai/gpt-5.4-nano','openai/gpt-4o-mini','google/gemini-3-flash-preview','openai/gpt-5.4','mistralai/mistral-small-3.1-24b-instruct','deepseek/deepseek-chat-v3.1','qwen/qwen-2.5-72b-instruct')
foreach ($m in $models) {
  $body = @{ model = $m; messages = @(@{ role = 'user'; content = 'Reply with just: OK' }); max_tokens = 20 } | ConvertTo-Json -Depth 5
  $content = ''
  try {
    $r = Invoke-WebRequest -Uri 'https://gen.pollinations.ai/v1/chat/completions' -Method Post -Headers @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' } -Body $body -TimeoutSec 45 -UseBasicParsing
    try { $j = $r.Content | ConvertFrom-Json; $content = [string]$j.choices[0].message.content } catch { $content = '(parse error) ' + $r.Content.Substring(0, 80) }
  } catch {
    $content = 'REQUEST FAIL: ' + $_.Exception.Message
  }
  if ($content -match "isn't allowed to use") { $out += "$m : BLOCKED" }
  elseif ($content -match 'REQUEST FAIL') { $out += "$m : $content" }
  else { $out += "$m : OK -> " + $content.Substring(0, [Math]::Min(60, $content.Length)) }
  $out | Set-Content -Path 'E:\jjjjjj\ai-model-matrix.txt' -Encoding UTF8
}
Write-Output 'done'
