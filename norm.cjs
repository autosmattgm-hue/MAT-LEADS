const fs = require("fs");
const p = "e:/jjjjjj/api/services/pollinationsService.js";
let s = fs.readFileSync(p, "utf8");

// 1) Expand website fallback queue: coder model first, more depth
s = s.replace(
  'WEBSITE_FALLBACKS: ["openai/gpt-5.4-mini", "openai/gpt-5.5", "openai/gpt-5-nano", "qwen/qwen3-coder-30b-a3b-instruct", "moonshotai/kimi-k2.6", "google/gemini-3-flash-preview", "openai/gpt-4o-mini", "mistralai/mistral-small-3.2"],',
  'WEBSITE_FALLBACKS: ["qwen/qwen3-coder-30b-a3b-instruct", "openai/gpt-5.4-mini", "openai/gpt-5.5", "moonshotai/kimi-k2.6", "openai/gpt-5-nano", "google/gemini-3-flash-preview", "openai/gpt-4o-mini", "mistralai/mistral-small-3.2"],\n    WEBSITE_TOKENS_FIRST: 4000,\n    WEBSITE_TOKENS_RETRY: 5200,\n    WEBSITE_TIMEOUT_MS: 120000,\n    WEBSITE_MIN_PAGE_CHARS: 1200,\n    WEBSITE_MIN_TOTAL_CHARS: 2600,'
);
fs.writeFileSync(p, s);
console.log("step1 done");
