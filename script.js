"use strict";

// ============================================================
// CONSTANTS
// ============================================================
const LS_KEY     = "dn-v2";
const DEBOUNCE   = 500;
const STEP_LABELS = ["Decision", "Options", "Criteria", "Score", "Result"];

// ============================================================
// STATE
// ============================================================
let state;
let currentStep = 1;
let activeOptId = null;       // which option's row-set is shown on step 4
let _saveT, _urlT;
const openNotes = new Set();  // UI-only: which option IDs have notes expanded

function uid() {
  try { return crypto.randomUUID(); } catch (_) {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

function freshState() {
  return {
    meta: { id: uid(), version: "2.0", created: Date.now(), updated: Date.now() },
    decision: { title: "", context: "" },
    options:  [],
    criteria: [],
    scores:   {},
    outcome:    null,  // v1.1 — decision journal foundation, not surfaced in UI yet
    reflection: null
  };
}

function touch() {
  state.meta.updated = Date.now();
  scheduleSave();
  scheduleURL();
}

// ============================================================
// PERSISTENCE
// ============================================================
function scheduleSave() {
  clearTimeout(_saveT);
  _saveT = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {}
  }, DEBOUNCE);
}

function scheduleURL() {
  clearTimeout(_urlT);
  _urlT = setTimeout(() => {
    try { history.replaceState(null, "", "#" + encState(state)); } catch (_) {}
  }, DEBOUNCE);
}

function encState(s) {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); } catch (_) { return ""; }
}
function decState(h) { return JSON.parse(decodeURIComponent(escape(atob(h)))); }

function loadFromURL() {
  const h = location.hash.slice(1);
  if (!h) return null;
  try { return decState(h); } catch (_) { return null; }
}
function loadFromLS() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
  catch (_) { return null; }
}

// ============================================================
// DATA HELPERS
// ============================================================
function namedOpts() { return state.options.filter(o  => o.name.trim()); }
function namedCrit() { return state.criteria.filter(c => c.name.trim()); }
function canScore()  { return namedOpts().length >= 2 && namedCrit().length >= 2; }

function getScore(optId, critId) { return state.scores[optId]?.[critId] ?? 5; }
function isScored(optId, critId) { return state.scores[optId]?.[critId] !== undefined; }

function optScoredCount(optId) {
  return namedCrit().filter(c => isScored(optId, c.id)).length;
}
function totalScored()  { return namedOpts().reduce((s, o) => s + optScoredCount(o.id), 0); }
function totalNeeded()  { return namedOpts().length * namedCrit().length; }

// ============================================================
// CALCULATIONS — pure functions
// ============================================================
function calcScores() {
  const opts = namedOpts(), crit = namedCrit();
  if (opts.length < 2 || crit.length < 2) return [];
  const totalW = crit.reduce((s, c) => s + c.weight, 0);
  if (!totalW) return [];
  const maxP = totalW * 10;

  return opts.map(opt => {
    const weighted = crit.reduce((s, c) => s + getScore(opt.id, c.id) * c.weight, 0);
    const pct = Math.round((weighted / maxP) * 100);
    const breakdown = crit.map(c => ({
      name: c.name, score: getScore(opt.id, c.id), weight: c.weight,
      contribution: Math.round((getScore(opt.id, c.id) * c.weight / maxP) * 100)
    }));
    return { id: opt.id, name: opt.name, score: pct, breakdown };
  }).sort((a, b) => b.score - a.score);
}

function calcConf(ranked) {
  if (ranked.length < 2) return { level: "none", label: "", desc: "" };
  const gap = ranked[0].score - ranked[1].score;
  if (gap <= 4)  return { level: "low",    label: "Low Confidence",
    desc: "The options are very close. Revisit your weights — a small change may flip the result." };
  if (gap <= 12) return { level: "medium", label: "Medium Confidence",
    desc: "A moderate advantage. The winner is the better choice given your stated priorities." };
  return { level: "high", label: "High Confidence",
    desc: "The top option clearly outperforms the alternatives across your weighted criteria." };
}

function isTie(ranked) { return ranked.length >= 2 && ranked[0].score === ranked[1].score; }

function genRec(ranked, conf) {
  if (!ranked.length) return "";
  const w = ranked[0], sec = ranked[1];
  const top = [...w.breakdown].sort((a, b) => b.contribution - a.contribution)[0];
  let t = `Based on your weighted criteria, ${w.name} is the strongest choice with a score of ${w.score}%.`;
  if (top) t += ` It performs especially well on ${top.name}.`;
  if (sec) t += ` The next closest option is ${sec.name} at ${sec.score}%.`;
  t += ` This is a ${conf.level} confidence recommendation — ${conf.desc.toLowerCase()}`;
  return t;
}

function genCopy(ranked, conf) {
  const title = state.decision.title.trim() || "Untitled Decision";
  let t = `Decision: ${title}\n\n`;
  if (!ranked.length) return t + "No results yet.";
  t += `Recommended: ${ranked[0].name} — ${ranked[0].score}%\n`;
  t += `Confidence:  ${conf.label}\n\nRanked Results:\n`;
  ranked.forEach((r, i) => { t += `${i + 1}. ${r.name} — ${r.score}%\n`; });
  const rec = genRec(ranked, conf);
  if (rec) t += `\nWhy: ${rec}`;
  return t;
}

// ============================================================
// STEP VALIDATION & NAVIGATION
// ============================================================
function stepValid(n) {
  if (n === 1) return state.decision.title.trim().length > 0;
  if (n === 2) return namedOpts().length >= 2;
  if (n === 3) return namedCrit().length >= 2;
  if (n === 4) return totalNeeded() > 0 && totalScored() === totalNeeded();
  return true; // step 5 is terminal
}

function maxReachable() {
  for (let n = 1; n <= 4; n++) if (!stepValid(n)) return n;
  return 5;
}

function goTo(n) {
  if (n < 1 || n > 5) return;
  if (n > maxReachable()) return;
  currentStep = n;
  if (n === 4) ensureActiveOpt();
  render();
}

function goNext() {
  if (currentStep === 4) return; // gated entirely by disabled button
  if (!stepValid(currentStep)) { showStepError(currentStep); return; }
  currentStep = Math.min(currentStep + 1, 5);
  if (currentStep === 4) ensureActiveOpt();
  render();
}

function goBack() {
  currentStep = Math.max(currentStep - 1, 1);
  render();
}

function showStepError(n) {
  const msgs = {
    1: "Tell us what you're deciding first.",
    2: "Add at least 2 options to continue.",
    3: "Add at least 2 criteria to continue."
  };
  const err = $("err-" + n);
  if (err) { err.textContent = msgs[n] || ""; err.classList.add("is-visible"); }

  let target = null;
  if (n === 1) target = $("decision-title");
  if (n === 2) target = document.querySelector("#options-list .item-name") || $("btn-add-option");
  if (n === 3) target = document.querySelector("#criteria-list .item-name") || $("btn-add-criterion");
  if (target) {
    target.classList.remove("shake"); void target.offsetWidth; target.classList.add("shake");
    if (target.focus) target.focus();
  }
}

function ensureActiveOpt() {
  const opts = namedOpts();
  if (!opts.length) { activeOptId = null; return; }
  if (!activeOptId || !opts.find(o => o.id === activeOptId)) activeOptId = opts[0].id;
}

// ============================================================
// HELPERS
// ============================================================
function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scoreClass(v) {
  if (v === undefined) return "";
  if (v <= 3) return "is-low";
  if (v >= 7) return "is-high";
  return "is-mid";
}

function copyText(text, btn, defaultLabel) {
  const done = () => {
    btn.textContent = "Copied!";
    btn.classList.add("btn-copied");
    setTimeout(() => { btn.textContent = defaultLabel; btn.classList.remove("btn-copied"); }, 2000);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(done);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
    done();
  }
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function countUp(el, target) {
  if (reducedMotion() || target === 0) { el.textContent = target; return; }
  const start = performance.now();
  const dur = 700;
  function frame(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ============================================================
// RAIL RENDER
// ============================================================
function renderRail() {
  const max = maxReachable();

  // Full rail
  const railFull = $("rail-full");
  railFull.innerHTML = STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const done   = n < currentStep && stepValid(n);
    const active = n === currentStep;
    const locked = n > max;
    const cls = done ? "is-done" : active ? "is-active" : "";
    const dotContent = done ? "✓" : n;
    const line = i < STEP_LABELS.length - 1
      ? `<div class="rail-line ${n < max ? "is-done" : ""}"></div>` : "";
    return `
      <li class="rail-item ${cls}">
        <div class="rail-dot-wrap">
          <button class="rail-dot" data-go="${n}" ${locked ? "disabled" : ""} aria-current="${active ? "step" : "false"}" title="${label}">${dotContent}</button>
          <span class="rail-label">${label}</span>
        </div>
        ${line}
      </li>
    `;
  }).join("");

  // Compact rail
  $("rail-compact-text").textContent = `Step ${currentStep} of 5 · ${STEP_LABELS[currentStep - 1]}`;
  $("rail-compact-fill").style.width = `${(currentStep / 5) * 100}%`;
}

// ============================================================
// STEP 1 — DECISION
// ============================================================
function renderStep1() {
  $("decision-title").value   = state.decision.title;
  $("decision-context").value = state.decision.context;
  $("err-1").classList.remove("is-visible");
}

// ============================================================
// STEP 2 — OPTIONS
// ============================================================
function renderStep2() {
  const list = $("options-list");
  list.innerHTML = state.options.map((opt, i) => {
    const open = openNotes.has(opt.id);
    return `
      <div class="item-card">
        <div class="item-row">
          <span class="item-num">${i + 1}</span>
          <input class="item-name" type="text" placeholder="Option name" value="${esc(opt.name)}"
            maxlength="100" data-field="opt-name" data-id="${opt.id}" autocomplete="off">
          <button class="btn-icon" data-action="rm-opt" data-id="${opt.id}" title="Remove option">✕</button>
        </div>
        <button class="notes-toggle" data-action="toggle-notes" data-id="${opt.id}">${open ? "▲ Hide notes" : "▼ Add notes"}</button>
        <div class="notes-body ${open ? "notes-open" : ""}">
          <textarea class="notes-input" rows="2" placeholder="Pros / advantages" data-field="opt-pros" data-id="${opt.id}">${esc(opt.pros)}</textarea>
          <textarea class="notes-input" rows="2" placeholder="Cons / disadvantages" data-field="opt-cons" data-id="${opt.id}">${esc(opt.cons)}</textarea>
        </div>
      </div>
    `;
  }).join("");
  $("btn-add-option").disabled = state.options.length >= 8;
  $("err-2").classList.remove("is-visible");
}

// ============================================================
// STEP 3 — CRITERIA
// ============================================================
function renderStep3() {
  const list = $("criteria-list");
  list.innerHTML = state.criteria.map((c, i) => `
    <div class="item-card">
      <div class="item-row">
        <span class="item-num">${i + 1}</span>
        <input class="item-name" type="text" placeholder="Criterion name" value="${esc(c.name)}"
          maxlength="80" data-field="crit-name" data-id="${c.id}" autocomplete="off">
        <button class="btn-icon" data-action="rm-crit" data-id="${c.id}" title="Remove criterion">✕</button>
      </div>
      <div class="weight-row">
        <span class="weight-label">Importance</span>
        <input class="range-slider" type="range" min="1" max="10" step="1" value="${c.weight}"
          data-action="weight" data-id="${c.id}">
        <span class="weight-val" id="wv-${c.id}">${c.weight}</span>
        <span class="weight-max">/10</span>
      </div>
    </div>
  `).join("");
  $("btn-add-criterion").disabled = state.criteria.length >= 8;
  $("err-3").classList.remove("is-visible");
}

// ============================================================
// STEP 4 — SCORING
// ============================================================
function renderStep4() {
  ensureActiveOpt();
  const opts = namedOpts(), crit = namedCrit();

  // Progress
  const done = totalScored(), need = totalNeeded();
  $("score-progress-text").textContent = `${done} of ${need} ratings done`;
  $("score-progress-fill").style.width = need ? `${(done / need) * 100}%` : "0%";

  // Pills
  $("opt-pills").innerHTML = opts.map(o => {
    const complete = optScoredCount(o.id) === crit.length && crit.length > 0;
    const active = o.id === activeOptId;
    return `
      <button class="opt-pill ${active ? "is-active" : ""}" data-action="select-opt" data-id="${o.id}">
        ${esc(o.name)} ${complete ? '<span class="pill-check">✓</span>' : ""}
      </button>
    `;
  }).join("");

  // Score rows for the active option
  const rows = $("score-rows");
  if (!activeOptId) { rows.innerHTML = ""; }
  else {
    const opt = opts.find(o => o.id === activeOptId);
    rows.innerHTML = `
      <p class="score-rows-title">Rating ${esc(opt.name)}</p>
      ${crit.map(c => {
        const raw = state.scores[opt.id]?.[c.id];
        const val = raw !== undefined ? raw : 5;
        const touched = raw !== undefined;
        return `
          <div class="score-row ${touched ? "is-touched" : ""}" data-row-opt="${opt.id}" data-row-crit="${c.id}">
            <div class="score-row-top">
              <span class="score-crit-name">${esc(c.name)}</span>
              <span class="score-crit-weight">importance ${c.weight}/10</span>
            </div>
            <div class="score-row-control">
              <input class="range-slider" type="range" min="1" max="10" step="1" value="${val}"
                data-action="score" data-opt="${opt.id}" data-crit="${c.id}">
              <span class="score-badge ${scoreClass(touched ? val : undefined)}" id="sb-${opt.id}-${c.id}">${touched ? val : "–"}</span>
              <span class="score-hint">drag</span>
            </div>
          </div>
        `;
      }).join("")}
    `;
  }

  updateNextButtonForStep4();
}

function updateScoreRowUI(optId, critId, val) {
  const badge = $(`sb-${optId}-${critId}`);
  if (badge) {
    badge.textContent = val;
    badge.className = "score-badge " + scoreClass(val);
  }
  const row = document.querySelector(`.score-row[data-row-opt="${optId}"][data-row-crit="${critId}"]`);
  if (row) row.classList.add("is-touched");

  // Pill checkmark
  const crit = namedCrit();
  const complete = optScoredCount(optId) === crit.length && crit.length > 0;
  const pill = document.querySelector(`.opt-pill[data-id="${optId}"]`);
  if (pill) {
    const checkSpan = pill.querySelector(".pill-check");
    if (complete && !checkSpan) pill.insertAdjacentHTML("beforeend", ' <span class="pill-check">✓</span>');
    if (!complete && checkSpan) checkSpan.remove();
  }

  // Progress bar + text
  const done = totalScored(), need = totalNeeded();
  $("score-progress-text").textContent = `${done} of ${need} ratings done`;
  $("score-progress-fill").style.width = need ? `${(done / need) * 100}%` : "0%";

  updateNextButtonForStep4();
}

function updateNextButtonForStep4() {
  if (currentStep !== 4) return;
  const btn = $("btn-next");
  const complete = stepValid(4);
  btn.disabled = !complete;
  btn.textContent = complete ? "See my results →" : "See my results →";
}

// ============================================================
// STEP 5 — RESULTS
// ============================================================
function renderStep5() {
  const content = $("results-content");
  if (!canScore()) { content.innerHTML = `<p class="step-sub">Not enough data yet.</p>`; return; }

  const ranked = calcScores();
  if (!ranked.length) { content.innerHTML = `<p class="step-sub">Not enough data yet.</p>`; return; }

  const conf   = calcConf(ranked);
  const winner = ranked[0];
  const tied   = isTie(ranked);
  const rec    = genRec(ranked, conf);
  const allDefault = totalScored() === 0;

  const rankItems = ranked.map((r, i) => `
    <div class="rank-item ${i === 0 ? "rank-first" : ""}">
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name" title="${esc(r.name)}">${esc(r.name)}</span>
      <div class="rank-track"><div class="rank-fill" style="width:${r.score}%"></div></div>
      <span class="rank-pct">${r.score}%</span>
    </div>
  `).join("");

  content.innerHTML = `
    ${allDefault ? `
      <div class="default-notice">
        <span class="default-notice-icon">ℹ</span>
        <span>All scores are still at default. Edit your ratings in the Scores step to get a real ranking.</span>
      </div>` : ""}

    ${tied ? `
      <div class="tie-alert">⚠ Tie detected — these two options score equally. Consider adding a tiebreaker criterion to separate them.</div>` : ""}

    <div class="winner-card">
      <div class="winner-eyebrow">Recommended</div>
      <div class="winner-name">${esc(winner.name)}</div>
      <span class="winner-pct"><span id="winner-pct-num">0</span><span class="winner-pct-unit">%</span></span>
      <div class="conf-badge conf-${conf.level}">${conf.label}</div>
    </div>

    <div class="results-block">
      <h3 class="block-title">All Options Ranked</h3>
      <div class="rank-list">${rankItems}</div>
    </div>

    ${conf.level !== "none" ? `
      <div class="results-block">
        <h3 class="block-title">Confidence</h3>
        <p class="conf-desc conf-desc-${conf.level}">${conf.desc}</p>
      </div>` : ""}

    ${rec ? `
      <div class="results-block">
        <h3 class="block-title">Recommendation</h3>
        <p class="rec-text">${rec}</p>
      </div>` : ""}

    <div class="results-actions">
      <button class="btn btn-primary" id="btn-copy">Copy Summary</button>
      <button class="btn btn-secondary" id="btn-share">Share URL</button>
    </div>
  `;

  countUp($("winner-pct-num"), winner.score);
}

// ============================================================
// EXAMPLE STATE — verified math: MacBook 88%, ZenBook 74%, gap 14% -> High
// ============================================================
const EXAMPLE = {
  meta: { id: "example", version: "2.0", created: 0, updated: 0 },
  decision: { title: "Which laptop should I buy?", context: "Comparing four laptops across the criteria that matter most before making a purchase." },
  options: [
    { id: "eo1", name: "MacBook Air M3",     pros: "Outstanding battery life, lightweight, premium build", cons: "Expensive, limited port selection" },
    { id: "eo2", name: "Dell XPS 15",        pros: "High performance, large crisp screen",                 cons: "Heavy, poor battery life, runs hot" },
    { id: "eo3", name: "Lenovo ThinkPad X1", pros: "Excellent keyboard, reliable build, good value",       cons: "Average battery, underwhelming graphics" },
    { id: "eo4", name: "ASUS ZenBook 14",    pros: "Affordable, portable, solid all-rounder",              cons: "Average display, plastic build feels cheaper" }
  ],
  criteria: [
    { id: "ec1", name: "Performance",     weight: 8 },
    { id: "ec2", name: "Battery life",    weight: 9 },
    { id: "ec3", name: "Value for money", weight: 7 },
    { id: "ec4", name: "Build quality",   weight: 6 },
    { id: "ec5", name: "Portability",     weight: 7 }
  ],
  scores: {
    eo1: { ec1: 9, ec2: 10, ec3: 5, ec4: 10, ec5: 10 },
    eo2: { ec1: 8, ec2:  4, ec3: 7, ec4:  7, ec5:  6 },
    eo3: { ec1: 7, ec2:  6, ec3: 8, ec4:  8, ec5:  7 },
    eo4: { ec1: 6, ec2:  7, ec3: 9, ec4:  7, ec5:  8 }
  },
  outcome: null, reflection: null
};

// ============================================================
// RENDER ALL
// ============================================================
function render() {
  renderRail();

  document.querySelectorAll(".step-panel").forEach(p => {
    p.classList.toggle("is-active", Number(p.dataset.step) === currentStep);
  });

  if (currentStep === 1) renderStep1();
  if (currentStep === 2) renderStep2();
  if (currentStep === 3) renderStep3();
  if (currentStep === 4) renderStep4();
  if (currentStep === 5) renderStep5();

  // Bottom nav visibility / labels
  const nav = $("bottom-nav");
  if (currentStep === 5) {
    nav.classList.add("is-hidden");
  } else {
    nav.classList.remove("is-hidden");
    $("btn-back").style.visibility = currentStep === 1 ? "hidden" : "visible";
    const labels = { 1: "Continue →", 2: "Continue →", 3: "Continue →", 4: "See my results →" };
    $("btn-next").textContent = labels[currentStep];
    $("btn-next").disabled = currentStep === 4 ? !stepValid(4) : false;
  }
}

// ============================================================
// EVENTS
// ============================================================
function bindEvents() {

  // Decision title / context
  $("decision-title").addEventListener("input", e => {
    state.decision.title = e.target.value;
    e.target.classList.remove("shake");
    $("err-1").classList.remove("is-visible");
    touch();
  });
  $("decision-context").addEventListener("input", e => {
    state.decision.context = e.target.value;
    touch();
  });

  // Enter key on title advances
  $("decision-title").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); goNext(); }
  });

  // Quick-pick chips
  $("chip-row").addEventListener("click", e => {
    const fill = e.target.dataset.fill;
    if (!fill) return;
    state.decision.title = fill;
    $("decision-title").value = fill;
    $("decision-title").focus();
    $("err-1").classList.remove("is-visible");
    touch();
  });

  // Load example
  $("btn-load-example").addEventListener("click", loadExample);

  // Add option / criterion
  $("btn-add-option").addEventListener("click", () => {
    if (state.options.length >= 8) return;
    state.options.push({ id: uid(), name: "", pros: "", cons: "" });
    touch(); renderStep2();
    const inputs = document.querySelectorAll("#options-list .item-name");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  $("btn-add-criterion").addEventListener("click", () => {
    if (state.criteria.length >= 8) return;
    state.criteria.push({ id: uid(), name: "", weight: 5 });
    touch(); renderStep3();
    const inputs = document.querySelectorAll("#criteria-list .item-name");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  // Bottom nav
  $("btn-back").addEventListener("click", goBack);
  $("btn-next").addEventListener("click", goNext);

  // Header / results reset & new decision
  $("btn-start-over").addEventListener("click", resetAll);
  $("btn-new-decision").addEventListener("click", resetAll);

  // ── Click delegation ─────────────────────────────────────
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-action], [data-go]");
    if (!el) {
      if (e.target.id === "btn-copy") {
        const ranked = calcScores(); const conf = calcConf(ranked);
        copyText(genCopy(ranked, conf), e.target, "Copy Summary");
      }
      if (e.target.id === "btn-share") {
        try { history.replaceState(null, "", "#" + encState(state)); } catch (_) {}
        copyText(location.href, e.target, "Share URL");
      }
      return;
    }

    const action = el.dataset.action, id = el.dataset.id, go = el.dataset.go;

    if (go) { goTo(Number(go)); return; }

    if (action === "rm-opt") {
      state.options = state.options.filter(o => o.id !== id);
      delete state.scores[id];
      openNotes.delete(id);
      if (activeOptId === id) activeOptId = null;
      touch(); renderStep2();
      return;
    }
    if (action === "rm-crit") {
      state.criteria = state.criteria.filter(c => c.id !== id);
      Object.keys(state.scores).forEach(oid => { if (state.scores[oid]) delete state.scores[oid][id]; });
      touch(); renderStep3();
      return;
    }
    if (action === "toggle-notes") {
      openNotes.has(id) ? openNotes.delete(id) : openNotes.add(id);
      renderStep2();
      return;
    }
    if (action === "select-opt") {
      activeOptId = id;
      renderStep4();
      return;
    }
  });

  // ── Input delegation ─────────────────────────────────────
  document.addEventListener("input", e => {
    const el = e.target;
    const action = el.dataset.action, field = el.dataset.field, id = el.dataset.id;

    if (field === "opt-name") {
      const o = state.options.find(x => x.id === id);
      if (o) { o.name = el.value; touch(); }
      return;
    }
    if (field === "crit-name") {
      const c = state.criteria.find(x => x.id === id);
      if (c) { c.name = el.value; touch(); }
      return;
    }
    if (field === "opt-pros") {
      const o = state.options.find(x => x.id === id);
      if (o) { o.pros = el.value; touch(); }
      return;
    }
    if (field === "opt-cons") {
      const o = state.options.find(x => x.id === id);
      if (o) { o.cons = el.value; touch(); }
      return;
    }
    if (action === "weight") {
      const c = state.criteria.find(x => x.id === id);
      if (!c) return;
      c.weight = Math.max(1, Math.min(10, parseInt(el.value) || 5));
      const wv = $("wv-" + id);
      if (wv) wv.textContent = c.weight;
      document.querySelectorAll(`[data-row-crit="${id}"] .score-crit-weight`).forEach(s => {
        s.textContent = `importance ${c.weight}/10`;
      });
      touch();
      return;
    }
    if (action === "score") {
      const optId = el.dataset.opt, critId = el.dataset.crit;
      const val = Math.max(1, Math.min(10, parseInt(el.value) || 5));
      if (!state.scores[optId]) state.scores[optId] = {};
      state.scores[optId][critId] = val;
      updateScoreRowUI(optId, critId, val);
      touch();
      return;
    }
  });

  // Blur: clear shake state, validate live
  document.addEventListener("blur", e => {
    if (e.target.dataset.field === "opt-name" && namedOpts().length >= 2) $("err-2").classList.remove("is-visible");
    if (e.target.dataset.field === "crit-name" && namedCrit().length >= 2) $("err-3").classList.remove("is-visible");
  }, true);
}

function loadExample() {
  state = JSON.parse(JSON.stringify(EXAMPLE));
  state.meta = { id: uid(), version: "2.0", created: Date.now(), updated: Date.now() };
  openNotes.clear();
  activeOptId = null;
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {}
  try { history.replaceState(null, "", "#" + encState(state)); } catch (_) {}
  currentStep = maxReachable(); // lands on 5, fully scored
  render();
}

function resetAll() {
  if (!confirm("Start a new decision? This clears everything.")) return;
  state = freshState();
  openNotes.clear();
  activeOptId = null;
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
  history.replaceState(null, "", location.pathname + location.search);
  currentStep = 1;
  render();
}

// ============================================================
// INIT
// ============================================================
function init() {
  state = loadFromURL() || loadFromLS() || freshState();
  if (!state.outcome === undefined) state.outcome = null;
  currentStep = maxReachable();
  if (currentStep === 4) ensureActiveOpt();
  bindEvents();
  render();
}

document.addEventListener("DOMContentLoaded", init);
