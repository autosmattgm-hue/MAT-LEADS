// Helpers to judge whether an AI-built website page contains real, *visible*
// content (not just a <style> block). A model that returns only CSS is a failed
// build — these helpers let the builders reject it, retry, or fall back to the
// content-rich template fragment so the shipped site is never empty.

// Remove everything that renders no text: <style>, <script> and comments.
export function stripInert(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

// Visible, human-readable text with tags and entities collapsed to spaces.
export function visibleText(html) {
  return stripInert(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function visibleWordCount(html) {
  const text = visibleText(html);
  return text ? text.split(" ").filter(Boolean).length : 0;
}

// A single page fragment counts as real when it has visible prose AND at least
// one heading. A CSS-only block has neither, so it fails and triggers the
// template fallback fragment (which always carries real copy).
export function hasRealContent(fragment, { minWords = 40 } = {}) {
  const raw = String(fragment || "");
  if (!/<h[1-6][\s>]/i.test(raw)) return false;
  return visibleWordCount(raw) >= minWords;
}

// Whole-document check used by WebsiteService.build(): the assembled shell always
// contributes nav + footer words, so require enough visible words that only a
// genuine multi-section page reaches the threshold. A CSS-only shell lands near
// the nav/footer word count and is rejected.
export function hasRichVisibleContent(html, { minWords = 70 } = {}) {
  if (!/<\/html>/i.test(String(html || ""))) return false;
  return visibleWordCount(html) >= minWords;
}
