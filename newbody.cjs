const fs = require("fs");
const p = "e:/jjjjjj/api/services/pollinationsService.js";
let s = fs.readFileSync(p, "utf8");
const anchor = "    WEBSITE_MIN_TOTAL_CHARS: 2600,";
if (!s.includes(anchor)) { console.log("ANCHOR MISSING"); process.exit(1); }
const block = "    WEBSITE_MIN_TOTAL_CHARS: 2600,\n" +
"    DESIGN_ARCHETYPES: [\n" +
"      { id: \"luxe-dark\", label: \"Luxe dark\", vibe: \"deep charcoal plus gold accents, big serif headlines, generous whitespace\", hero: \"full-bleed image with dark overlay and centered serif headline\", sections: \"stats row first, then image plus text split, then process steps\" },\n" +
"      { id: \"editorial\", label: \"Editorial\", vibe: \"off-white paper background, strong typographic hierarchy, thin rules\", hero: \"left-aligned oversized headline with small kickers and inline image\", sections: \"image plus text split first, then services grid, then testimonial band\" },\n" +
"      { id: \"bold-agency\", label: \"Bold agency\", vibe: \"high-contrast blocks of brand color, chunky headings, badges\", hero: \"split-screen hero with headline left and image collage right\", sections: \"services grid first, then stats row, then process steps\" },\n" +
"      { id: \"minimal-swiss\", label: \"Minimal Swiss\", vibe: \"white space, small uppercase labels, grid lines, one accent used sparingly\", hero: \"centered compact hero with thin divider and dual buttons\", sections: \"process steps first, then image plus text split, then services grid\" },\n" +
"      { id: \"warm-artisan\", label: \"Warm artisan\", vibe: \"cream plus terracotta plus deep green, rounded cards, friendly voice\", hero: \"rounded image card hero with warm gradient wash\", sections: \"testimonial band first, then services grid, then image plus text split\" },\n" +
"      { id: \"glass-modern\", label: \"Glass modern\", vibe: \"gradient mesh background, frosted-glass cards, soft glows\", hero: \"gradient mesh hero with glass CTA card overlay\", sections: \"stats row first, then services grid, then FAQ accordion\" },\n" +
"      { id: \"split-story\", label: \"Split story\", vibe: \"alternating left right storytelling rows, photo-forward rhythm\", hero: \"asymmetric split hero with overlapping image\", sections: \"alternating image plus text rows first, then process steps, then stats row\" },\n" +
"      { id: \"compact-local\", label: \"Compact local\", vibe: \"mobile-first, sticky call bar, click-to-call prominent, trust badges\", hero: \"compact hero with phone CTA primary and trust chips\", sections: \"trust strip first, then services grid, then FAQ accordion\" },\n" +
"    ],";
s = s.replace(anchor, block);
fs.writeFileSync(p, s);
console.log("archetypes added");
