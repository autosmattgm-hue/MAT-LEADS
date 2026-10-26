import { apiFetch, byId, getCurrentUser, isProUser, requireAuth } from "./api.js";

const SAVED_LEADS_KEY = "mat_local_saved_leads_v1";

let websiteId = "";
let shareToken = "";
let shareUrl = "";
let currentHtml = "";

// Conversation state machine: pages -> business -> building -> ready (refine).
let stage = "pages";
let chosenPages = 0;
let typedBusiness = "";
let selectedLead = null;
let savedLeads = [];
let busy = false;

// ---------- small helpers ----------
function abs(url) {
  try { return new URL(url, window.location.origin).href; } catch { return url; }
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(message) {
  const node = byId("studioStatus");
  if (node) node.textContent = message;
}

function setStatusLine(message) {
  const node = byId("studioStatusLine");
  if (node) node.textContent = message;
}

// Same ID scheme as js/leads.js — every saved lead carries an ML-XXXXXX id.
function makeLeadId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  try { (window.crypto || {}).getRandomValues?.(bytes); } catch {}
  let out = "ML-";
  for (let i = 0; i < 6; i += 1) {
    const byte = bytes[i] ?? Math.floor(Math.random() * 256);
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

// ---------- chat rendering (ChatGPT-style thread) ----------
function scrollLog() {
  const log = byId("chatLog");
  if (log) log.scrollTop = log.scrollHeight;
}

function addMessage(role, text, options = {}) {
  const log = byId("chatLog");
  if (!log) return null;
  const wrap = document.createElement("div");
  wrap.className = `wsx-msg wsx-msg--${role}`;
  if (role === "ai") {
    const who = document.createElement("span");
    who.className = "wsx-msg-role";
    who.textContent = "MAT Studio AI";
    wrap.append(who);
  }
  const body = document.createElement("div");
  body.className = "wsx-msg-body";
  wrap.append(body);
  log.append(wrap);
  scrollLog();
  if (options.html) body.innerHTML = text;
  else body.textContent = text;
  return body;
}

// Typewriter reveal, tuned so long messages still appear in under a second.
function typeAi(text) {
  const body = addMessage("ai", "");
  if (!body) return;
  const full = String(text || "");
  if (full.length > 600) {
    body.textContent = full;
    scrollLog();
    return;
  }
  const totalTicks = 50;
  const perTick = Math.max(1, Math.ceil(full.length / totalTicks));
  const step = Math.max(8, Math.min(16, Math.round(750 / totalTicks)));
  let index = 0;
  const tick = () => {
    index = Math.min(full.length, index + perTick);
    body.textContent = full.slice(0, index);
    scrollLog();
    if (index < full.length) setTimeout(tick, step);
  };
  tick();
}

function addUser(text) {
  addMessage("user", text);
}

function addTypingIndicator() {
  const log = byId("chatLog");
  if (!log) return null;
  const wrap = document.createElement("div");
  wrap.className = "wsx-msg wsx-msg--ai wsx-typing-ind";
  wrap.innerHTML = '<span class="wsx-msg-role">MAT Studio AI</span><div class="wsx-dots"><span></span><span></span><span></span></div>';
  log.append(wrap);
  scrollLog();
  return wrap;
}

function addErrorBubble(message, retryLabel, onRetry) {
  const body = addMessage("ai", "");
  if (!body) return;
  body.className = "wsx-msg-body wsx-err";
  body.textContent = message;
  if (retryLabel && typeof onRetry === "function") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "wsx-retry";
    retry.textContent = retryLabel;
    retry.addEventListener("click", () => {
      const bubble = retry.closest(".wsx-msg");
      bubble?.remove();
      onRetry();
    });
    body.append(document.createElement("br"), retry);
  }
  scrollLog();
}

function renderChips(chips = []) {
  const row = byId("wsxChips");
  if (!row) return;
  row.innerHTML = "";
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wsx-chip";
    btn.textContent = chip.label;
    btn.addEventListener("click", () => {
      clearChips();
      if (typeof chip.onPick === "function") chip.onPick();
    });
    row.append(btn);
  }
}

function clearChips() {
  const row = byId("wsxChips");
  if (row) row.innerHTML = "";
}

// ---------- saved leads picker ----------
function readSavedLeads() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_LEADS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((lead) => lead && lead.name) : [];
  } catch {
    return [];
  }
}

function writeSavedLeads(leads) {
  try { localStorage.setItem(SAVED_LEADS_KEY, JSON.stringify(leads.slice(0, 500))); } catch {}
}

function loadLeadPicker() {
  savedLeads = readSavedLeads();
  let changed = false;
  for (const lead of savedLeads) {
    if (!lead.leadId) {
      lead.leadId = makeLeadId();
      changed = true;
    }
  }
  if (changed) writeSavedLeads(savedLeads);

  const select = byId("wsxLeadSelect");
  if (!select) return;
  const placeholder = '<option value="">— Type a business name in the chat —</option>';
  const options = savedLeads.map((lead) =>
    `<option value="${esc(lead.leadId || lead.id || "")}">${esc(lead.leadId || "—")} — ${esc(lead.name)}</option>`
  );
  select.innerHTML = placeholder + options.join("");

  // Lead handed over from the Leads page (sessionStorage hand-off).
  try {
    const handoff = JSON.parse(sessionStorage.getItem("mat_studio_lead") || "null");
    if (!handoff?.name) return;
    const match = savedLeads.find((lead) =>
      (handoff.leadId && lead.leadId === handoff.leadId) ||
      (handoff.id && lead.id === handoff.id) ||
      (!handoff.leadId && !handoff.id && lead.name === handoff.name)
    );
    if (match) {
      select.value = match.leadId || match.id || "";
      applySelectedLead(match);
      return;
    }
    if (handoff.leadId) {
      // Live search lead that is not stored locally — still offer it.
      savedLeads.unshift(handoff);
      select.insertAdjacentHTML("afterbegin", `<option value="${esc(handoff.leadId)}">${esc(handoff.leadId)} — ${esc(handoff.name)}</option>`);
      select.value = handoff.leadId;
      applySelectedLead(handoff);
      return;
    }
    typedBusiness = String(handoff.name || "");
  } catch {}
}

function applySelectedLead(lead) {
  selectedLead = lead || null;
  const card = byId("wsxLeadCard");
  if (!card) return;
  if (!lead) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  byId("wsxLeadName").textContent = lead.name || "Business";
  byId("wsxLeadId").textContent = lead.leadId || lead.id || "no id";
  byId("wsxLeadMeta").textContent = [lead.phone, lead.address].filter(Boolean).join(" • ");
}

function businessIdentity() {
  if (selectedLead?.name) return selectedLead.name;
  if (typedBusiness) return typedBusiness;
  return "";
}

// ---------- conversation flow ----------
function askPageCount() {
  stage = "pages";
  chosenPages = 0;
  typeAi("Hi! I'm MAT Studio AI 👋\nI'll design a professional website for your business.\nFirst — how many pages do you need?");
  renderChips([1, 2, 3, 4].map((n) => ({
    label: n === 1 ? "1 page" : `${n} pages`,
    onPick: () => pickPageCount(n)
  })));
  setStatus("Waiting for your page count…");
  setStatusLine("How many pages?");
}

function pickPageCount(count) {
  chosenPages = count;
  addUser(count === 1 ? "1 page" : `${count} pages`);
  if (businessIdentity()) {
    beginBuild();
    return;
  }
  stage = "business";
  typeAi("Which business is it for?\nPick one of your saved leads above — or type the business name right here in the chat.");
  setStatus("Waiting for the business…");
  setStatusLine("Which business?");
}

function beginBuild() {
  if (busy) return;
  const businessName = businessIdentity();
  if (!chosenPages || !businessName) {
    if (!chosenPages) {
      askPageCount();
    } else {
      stage = "business";
      typeAi("Which business is it for? Pick a saved lead above, or type the business name here.");
      renderChips([]);
    }
    return;
  }
  stage = "building";
  const leadTag = selectedLead?.leadId ? ` (lead ${selectedLead.leadId})` : "";
  addUser(`Build for ${businessName}${leadTag}`);
  typeAi(`Building your ${chosenPages}-page website for ${businessName} now — hero, services, gallery, FAQ and contact. This takes about 30–50 seconds…`);
  renderChips([]);
  runBuild(businessName);
}

async function runBuild(businessName) {
  busy = true;
  const send = byId("wsxSend");
  if (send) send.disabled = true;
  showOverlay(true);
  setStatusLine("Designing your site…");
  setStatus(`Building a ${chosenPages}-page site for ${businessName}…`);
  try {
    const payload = {
      leadId: selectedLead?.leadId || "",
      lead: selectedLead || {},
      businessName,
      pages: chosenPages
    };
    const r = await apiFetch("/api/ai/websites", { method: "POST", body: JSON.stringify(payload) });
    websiteId = r.websiteId;
    shareToken = r.shareToken;
    shareUrl = r.shareUrl || "";
    setPreview(r.website.html);
    enablePreviewActions(true);
    const pageLabel = r.website.pageCount && r.website.pageCount > 1 ? ` • ${r.website.pageCount} pages` : "";
    byId("studioMeta").textContent = `${r.website.businessName || businessName} • ${r.website.model || "site"}${pageLabel}`;
    const aiNote = r.website.aiError ? `\nNote: ${r.website.aiError}` : "";
    typeAi(`Done ✅ ${r.website.businessName || businessName} is live in the preview — ${r.website.pageCount || 1} page(s).\nUse Desktop / Mobile to check it, Copy link to share, or open Edit in builder for pixel-perfect changes.\nTell me any change in plain words — e.g. “make the hero darker” or “change the phone number”.${aiNote}`);
    setStatus(r.website.aiError ? `Built with a fallback: ${r.website.aiError}` : "Ready — chat to refine, or edit in the builder.");
    setStatusLine("Site ready — refine below");
    stage = "ready";
    try { history.replaceState(null, "", `/website-studio.html?id=${encodeURIComponent(websiteId)}`); } catch {}
  } catch (err) {
    const msg = String(err?.message || "The build didn't finish.");
    const upgrade = /pro plan|402|PRO_REQUIRED/i.test(msg);
    stage = "error";
    if (upgrade) {
      addErrorBubble(msg);
      renderChips([{ label: "Upgrade to Pro", onPick: () => { window.location.href = "/pricing.html?upgrade=pro"; } }]);
    } else {
      addErrorBubble(`The build didn't finish: ${msg}`, "Retry build", () => {
        stage = "building";
        runBuild(businessName);
      });
      renderChips([{ label: "Retry build", onPick: () => { stage = "building"; runBuild(businessName); } }]);
    }
    setStatus(msg);
    setStatusLine("Build failed — retry anytime");
  } finally {
    busy = false;
    showOverlay(false);
    if (send) send.disabled = false;
  }
}

async function runRefine(instruction) {
  if (busy || !websiteId) return;
  busy = true;
  const indicator = addTypingIndicator();
  setStatus("Applying your change…");
  setStatusLine("Applying change…");
  try {
    const r = await apiFetch(`/api/ai/websites/${encodeURIComponent(websiteId)}`, {
      method: "PATCH",
      body: JSON.stringify({ instruction })
    });
    indicator?.remove();
    setPreview(r.website.html);
    const pageLabel = r.website.pageCount > 1 ? ` • ${r.website.pageCount} pages` : "";
    byId("studioMeta").textContent = `${r.website.businessName || ""} • rev ${r.website.revisions}${pageLabel}`.replace(/^ • /, "");
    addMessage("ai", `Applied ✅ (revision ${r.website.revisions}). Anything else you want to change?`);
    setStatus("Change applied.");
    setStatusLine("Site ready — refine below");
  } catch (err) {
    indicator?.remove();
    const msg = String(err?.message || "That change didn't apply.");
    const upgrade = /pro plan|402|PRO_REQUIRED/i.test(msg);
    addErrorBubble(msg, upgrade ? null : "Try again", upgrade ? null : () => runRefine(instruction));
    if (upgrade) {
      renderChips([{ label: "Upgrade to Pro", onPick: () => { window.location.href = "/pricing.html?upgrade=pro"; } }]);
    }
    setStatus(msg);
    setStatusLine("Site ready — refine below");
  } finally {
    busy = false;
  }
}

// ---------- preview ----------
function setPreview(html) {
  currentHtml = html || "";
  const frame = byId("studioPreview");
  if (frame) frame.srcdoc = currentHtml;
}

function showOverlay(show) {
  const overlay = byId("genOverlay");
  if (overlay) overlay.style.display = show ? "block" : "none";
}

function enablePreviewActions(enabled) {
  ["studioOpenPreview", "studioDownload", "studioCopyLink", "studioEditManual"].forEach((id) => {
    const btn = byId(id);
    if (btn) btn.disabled = !enabled;
  });
}

function setDevice(device) {
  byId("studioPreview")?.classList.toggle("mobile", device === "mobile");
  byId("viewDesktop")?.classList.toggle("on", device === "desktop");
  byId("viewMobile")?.classList.toggle("on", device === "mobile");
}

function openPreviewWindow() {
  if (!currentHtml) return;
  const w = window.open("", "_blank");
  if (!w) {
    setStatus("Pop-up blocked — allow pop-ups for this site, then click Open again.");
    return;
  }
  w.document.open();
  w.document.write(currentHtml);
  w.document.close();
}

async function loadFromQuery() {
  const q = new URLSearchParams(window.location.search);
  const id = q.get("id") || "";
  if (!id) return false;
  setStatus("Loading website…");
  try {
    const r = await apiFetch(`/api/ai/websites/${encodeURIComponent(id)}`);
    websiteId = r.website.id;
    shareToken = r.website.shareToken || "";
    shareUrl = r.shareUrl || "";
    setPreview(r.website.html);
    chosenPages = chosenPages || Number(r.website.pageCount || 1);
    const pageLabel = r.website.pageCount > 1 ? ` • ${r.website.pageCount} pages` : "";
    byId("studioMeta").textContent = `${r.website.businessName || r.website.leadName || "Website"} • rev ${r.website.revisions}${pageLabel}`;
    enablePreviewActions(true);
    stage = "ready";
    addMessage("ai", `Loaded your site — ${r.website.businessName || r.website.leadName || "your business"}. Tell me what to change, or open Edit in builder.`);
    setStatus("Loaded — chat to refine.");
    setStatusLine("Site ready — refine below");
    return true;
  } catch (error) {
    addErrorBubble(`Couldn't load that website: ${error.message}`);
    setStatus(error.message);
    return false;
  }
}

// ---------- message router ----------
function handleUserMessage(raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  addUser(text);

  if (stage === "pages") {
    const digits = text.match(/\b([1-4])\b/);
    if (digits) {
      pickPageCount(Number(digits[1]));
      return;
    }
    typeAi("Pick a page count with the chips below (1–4 pages) — that's the first thing I need 🙂");
    renderChips([1, 2, 3, 4].map((n) => ({
      label: n === 1 ? "1 page" : `${n} pages`,
      onPick: () => pickPageCount(n)
    })));
    return;
  }

  if (stage === "business") {
    typedBusiness = text.slice(0, 120);
    beginBuild();
    return;
  }

  if (stage === "building") {
    typeAi("I'm still building your site — hang tight, one moment ✨");
    return;
  }

  if (stage === "error") {
    if (chosenPages && businessIdentity()) {
      stage = "building";
      runBuild(businessIdentity());
    } else {
      askPageCount();
    }
    return;
  }

  if (stage === "ready" && websiteId) {
    runRefine(text.slice(0, 2000));
    return;
  }

  askPageCount();
}

//__WSX_CHUNK__



