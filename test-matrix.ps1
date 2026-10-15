$key = 'pk_Cs6VLsAnAwJnVCfd'
$out = @()
$models = @('openai/gpt-5.4-nano','openai/gpt-5-nano','google/gemini-3-flash-preview','openai/gpt-4o-mini','openai/gpt-5.4','openai/gpt-5.4-mini','mistralai/mistral-small-3.1-24b-instruct','deepseek/deepseek-chat-v3.1','qwen/qwen-2.5-72b-instruct','meta-llama/llama-3.3-70b-instruct','anthropic/claude-3.5-haiku','x-ai/grok-code-fast-1')
foreach ($m in $models) {
  $body = @{ model = $m; messages = @(@{ role = 'user'; content = 'Reply with just: OK' }); max_tokens = 20 } | ConvertTo-Json -Depth 5
  try {
    $r = Invoke-WebRequest -Uri 'https://gen.pollinations.ai/v1/chat/completions' -Method Post -Headers @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' } -Body $body -TimeoutSec 90 -UseBasicParsing
    $content = ''
    try { $j = $r.Content | ConvertFrom-Json; $content = [string]$j.choices[0].message.content } catch {}
    $blocked = $content -match "isn't allowed to use"
    if ($blocked) { $out += "$m : BLOCKED" }
    elseif ($content -match 'not found|unsupported|unknown model') { $out += "$m : ERROR: $($content.Substring(0, [Math]::Min(90, $content.Length)))" }
    else { $out += "$m : OK -> $($content.Substring(0, [Math]::Min(70, $content.Length)).Replace([char]10,' '))" }
  } catch {
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    $out += "$m : FAIL $msg"
  }
  Start-Sleep -Milliseconds 800
}
$out | Set-Content -Path 'E:\jjjjjj\ai-model-matrix.txt' -Encoding UTF8
Write-Output 'done'
