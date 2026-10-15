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
    if (!done) throw new Error("Pattern not found in " + path + ":\n" + oldText.slice(0, 140));
  }
  fs.writeFileSync(path, text);
  console.log("edited " + path);
}

edit("api/services/pollinationsService.js", [
  [
    'function publicPollinationsError(error) {\n  const m = String(error?.message || "").toLowerCase();',
    'function publicPollinationsError(error) {\n  if (error instanceof AppError) return error;\n  const m = String(error?.message || "").toLowerCase();'
  ],
  [
    '        if (!content || !String(content).trim()) {\n          throw new AppError("Pollinations AI returned an empty response.", 503, "POLLINATIONS_EMPTY");\n        }\n        return { configured: true',
    '        if (!content || !String(content).trim()) {\n          throw new AppError("Pollinations AI returned an empty response.", 503, "POLLINATIONS_EMPTY");\n        }\n        // Pollinations returns HTTP 200 with a block notice embedded in the message\n        // content when the key\'s model allow-list does not include the requested model.\n        if (/isn\\'t allowed to use|is not allowed to use|allow it for this key/i.test(String(content))) {\n          const grantMatch = String(content).match(/https:\\/\\/enter\\.pollinations\\.ai\\/grant\\?[^\\s)\\]">]+/);\n          const grant = grantMatch ? grantMatch[0] : "https://enter.pollinations.ai/keys";\n          throw new AppError("Pollinations key cannot use " + attempt + ". Allow it: " + grant + " - the key\'s model allow-list is empty. Owner: allow the text category there, or set a full-access secret (sk_) key as POLLINATIONS_API_KEY, then retry.", 503, "POLLINATIONS_MODEL_DENIED");\n        }\n        return { configured: true'
  ]
]);

edit("api/services/websiteService.js", [
  [
    '      } else if (/authorization failed|403|missing or invalid/i.test(raw)) {\n        reason = raw.slice(0, 320) + " Add or replace POLLINATIONS_API_KEY in .env, then restart.";\n      } else {',
    '      } else if (/authorization failed|403|missing or invalid/i.test(raw)) {\n        reason = raw.slice(0, 320) + " Add or replace POLLINATIONS_API_KEY in .env, then restart.";\n      } else if (/POLLINATIONS_MODEL_DENIED|Pollinations key cannot use|model allow-list|isn\\'t allowed to use|allow it for this key/i.test(raw)) {\n        const grantMatch = raw.match(/https:\\/\\/enter\\.pollinations\\.ai\\/grant\\?[^\\s)\\]">]+/);\n        reason = "Pollinations key is blocked from the AI model (its model allow-list is empty). Owner fix: log in at enter.pollinations.ai and open " + (grantMatch ? grantMatch[0] : "https://enter.pollinations.ai/keys") + " to allow the text category - or set a full-access secret (sk_) key as POLLINATIONS_API_KEY. Then click Generate again.";\n      } else {'
  ]
]);

console.log("done");