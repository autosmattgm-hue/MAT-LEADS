import fs from "node:fs";

function edit(path, replacements) {
  let text = fs.readFileSync(path, "utf8");
  for (const [oldText, newText] of replacements) {
    const variants = [oldText, oldText.replace(/\n/g, "\r\n")];
    const newVariants = [newText, newText.replace(/\n/g, "\r\n")];
    let done = false;
    for (let i = 0; i < variants.length; i++) {
      if (text.includes(variants[i])) {
        text = text.split(variants[i]).join(newVariants[i]);
        done = true;
        break;
      }
    }
    if (!done) throw new Error("Pattern not found in " + path + ":\n" + oldText.slice(0, 160));
  }
  fs.writeFileSync(path, text);
  console.log("edited " + path);
}

const HELPERS = [
"const providerState = { verification: \"unverified\", lastCheckedAt: null, lastSuccessAt: null, lastFailure: null };",
"",
"function markProviderSuccess() {",
"  providerState.verification = \"verified\";",
"  providerState.lastCheckedAt = new Date().toISOString();",
"  providerState.lastSuccessAt = providerState.lastCheckedAt;",
"  providerState.lastFailure = null;",
"}",
"",
"function markProviderFailure(error) {",
"  providerState.verification = \"failed\";",
"  providerState.lastCheckedAt = new Date().toISOString();",
"  providerState.lastFailure = { code: error?.code || \"POLLINATIONS_UNAVAILABLE\", message: error?.message || \"Pollinations AI is unavailable.\" };",
"}",
"",
"function friendlyAiMessage(error, fallback = \"AI is temporarily unavailable. Please try again in a moment.\") {",
"  const raw = String(error?.message || \"\");",
"  if (/POLLINATIONS_API_KEY|POLLINATIONS_NOT_CONFIGURED/i.test(raw)) return \"AI key missing. Add POLLINATIONS_API_KEY in Vercel env vars, then redeploy.\";",
"  if (/timed out|POLLINATIONS_TIMEOUT|504/i.test(raw)) return \"AI took too long - please send again.\";",
"  if (/402|PRO_REQUIRED/i.test(raw)) return raw;",
"  if (/401|INVALID_TOKEN|Login required/i.test(raw)) return \"Please log in again, then retry.\";",
"  return fallback;",
"}",
"",
"function plainTextAiOutput(content) {",
"  return String(content || \"\")",
"    .replace(/\\r\\n/g, \"\\n\")",
"    .split(\"\\n\")",
"    .map((line) => line",
"      .replace(/^\\s{0,3}#{1,6}\\s*/g, \"\")",
"      .replace(/^\\s*[*]+\\s+/g, \"\")",
"      .replace(/^\\s*[-]\\s+/g, \"\")",
"      .replace(/\\*\\*(.*?)\\*\\*/g, \"$1\")",
"      .replace(/\\*(.*?)\\*/g, \"$1\")",
"      .replace(/__([^_]+)__/g, \"$1\")",
"      .replace(/`([^`]+)`/g, \"$1\")",
"      .replace(/[#$*]/g, \"\")",
"      .trimEnd())",
"    .join(\"\\n\")",
"    .replace(/\\n{3,}/g, \"\\n\\n\")",
"    .trim();",
"}",
"",
"function withPlainTextInstruction(messages) {",
"  const instruction = \"Formatting rule: reply in plain text only. Do not use Markdown. Do not use # headings. Do not use * bullets or bold markers. Keep answers concise.\";",
"  const normalized = Array.isArray(messages) ? [...messages] : [];",
"  if (normalized[0]?.role === \"system\") {",
"    normalized[0] = { ...normalized[0], content: `${instruction}\\n\\n${normalized[0].content}` };",
"    return normalized;",
"  }",
"  return [{ role: \"system\", content: instruction }, ...normalized];",
"}",
"",
"function compactObject(value) {",
"  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => {",
"    if (item === undefined || item === null || item === \"\") return false;",
"    if (Array.isArray(item) && item.length === 0) return false;",
"    return true;",
"  }));",
"}",
"",
"function compactLeadForAi(lead = {}) {",
"  const details = lead.details || {};",
"  const audit = lead.audit || {};",
"  const metaTitle = audit.meta && audit.meta.title ? audit.meta.title : \"\";",
"  const agentNote = (audit.agentSummary && (audit.agentSummary.whatItDoes || audit.agentSummary.whyItMatters)) || \"\";",
"  const biz = lead?.name || details?.businessName || metaTitle || agentNote || \"this business\";",
"  return [",
"    `Business: ${biz}`,",
"    details.category ? `Category: ${details.category}` : null,",
"    details.city || details.address ? `Location: ${[details.address, details.city].filter(Boolean).join(\", \")}` : null,",
"    details.phone || details.whatsapp ? `Contact: ${details.phone || details.whatsapp}` : null,",
"    details.websiteUrl || lead.websiteUrl ? `Website: ${details.websiteUrl || lead.websiteUrl}` : \"Website: none found\",",
"    audit.score !== undefined && audit.score !== null ? `Audit score: ${audit.score}/100` : null,",
"    audit.category ? `Audit category: ${audit.category}` : null",
"  ].filter(Boolean).join(\"\\n\");",
"}"
].join("\n");

const METHODS = [
"  status() {",
"    return {",
"      configured: this.configured(),",
"      provider: PROVIDER,",
"      verification: providerState.verification,",
"      lastCheckedAt: providerState.lastCheckedAt,",
"      lastSuccessAt: providerState.lastSuccessAt,",
"      lastFailure: providerState.lastFailure",
"    };",
"  }",
""
].join("\n");
console.log("placeholder");
