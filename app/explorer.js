// Exoplanet Explorer: loads data/planets.json, filters, plots, ranks and compares planets.
// State lives in the URL hash, so any view can be shared as a link.
import { derive, SOLAR_SYSTEM, hzLimits } from "./physics.js";
import { FIELDS, ZONE_LABEL, ZONE_SHORT, fmt, fieldLabel, hms, dms } from "./fields.js";
import { Scatter } from "./plot.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The story's present: real time + 70,491 days (see InterImm/interstellar). Used only for the contact readouts.
const STORY_OFFSET_DAYS = 70491;
const storyYear = () => new Date(Date.now() + STORY_OFFSET_DAYS * 864e5).getUTCFullYear();

// ---------------------------------------------------------------- state
const DEFAULTS = {
  tab: "plot",
  q: "", status: "confirmed,controversial", maxly: "", rmin: "", rmax: "", mmin: "", mmax: "", smin: "", smax: "", tmin: "", tmax: "",
  zone: "any", method: "", measured: "",
  x: "insol", y: "st_teff", xlog: "1", ylog: "0", color: "zone", ctx: "1", sol: "1", est: "1",
  w: "3,3,2,1,1", sel: "", pins: "", sort: "ly", dir: "asc",
};
let S = { ...DEFAULTS };

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  S = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (h.has(k)) S[k] = h.get(k);
}
function writeHash() {
  const h = new URLSearchParams();
  for (const [k, v] of Object.entries(S)) if (v !== DEFAULTS[k]) h.set(k, v);
  const s = h.toString();
  try { history.replaceState(null, "", s ? `#${s}` : location.pathname + location.search); } catch { /* sandboxed frames may refuse */ }
}
const pins = () => new Set(S.pins ? S.pins.split("|") : []);
const setPins = (set) => { S.pins = [...set].join("|"); };

// ---------------------------------------------------------------- data
let ALL = [], META = null, SOLAR = [];

function build(rec) {
  const d = derive(rec);
  return { ...rec, raw: { rade: rec.rade, masse: rec.masse, insol: rec.insol, teq: rec.teq, a: rec.a }, ...d };
}

async function load() {
  const res = await fetch("data/planets.json");
  if (!res.ok) throw new Error(`data/planets.json: HTTP ${res.status}`);
  const doc = await res.json();
  META = doc.meta;
  ALL = doc.rows.map((row) => build(Object.fromEntries(doc.fields.map((f, i) => [f, row[i]]))));
  SOLAR = SOLAR_SYSTEM.map(build);
}

// ---------------------------------------------------------------- filtering
const num = (v) => (v === "" || v == null ? null : Number(v));
function filtered() {
  const q = S.q.trim().toLowerCase();
  const status = new Set(S.status.split(",").filter(Boolean));
  const methods = new Set(S.method.split(",").filter(Boolean));
  const maxly = num(S.maxly);
  const ranges = [["rade", num(S.rmin), num(S.rmax)], ["masse", num(S.mmin), num(S.mmax)], ["insol", num(S.smin), num(S.smax)], ["st_teff", num(S.tmin), num(S.tmax)]];
  return ALL.filter((p) => {
    if (!status.has(p.status)) return false;
    if (q && !p.name.toLowerCase().includes(q) && !(p.host || "").toLowerCase().includes(q)) return false;
    if (maxly != null && !(p.ly != null && p.ly <= maxly)) return false;
    for (const [k, lo, hi] of ranges) {
      if (lo == null && hi == null) continue;
      const v = p[k];
      if (v == null || (lo != null && v < lo) || (hi != null && v > hi)) return false;
    }
    if (methods.size && !methods.has(methodGroup(p.method))) return false;
    if (S.zone === "cons" && p.zone !== "cons") return false;
    if (S.zone === "opt" && !["cons", "opt-inner", "opt-outer"].includes(p.zone)) return false;
    if (S.measured === "radius" && (p.raw.rade == null || p.rade_est)) return false;
    if (S.measured === "mass" && !(p.raw.masse != null && p.massprov === "Mass")) return false;
    if (S.measured === "both" && !(p.raw.rade != null && !p.rade_est && p.raw.masse != null && p.massprov === "Mass")) return false;
    return true;
  });
}

const METHOD_GROUPS = ["Transit", "Radial Velocity", "Microlensing", "Imaging", "Other"];
function methodGroup(m) { return METHOD_GROUPS.includes(m) ? m : "Other"; }

const PRESETS = {
  all: { label: "All planets", f: {} },
  near: { label: "Within 50 ly", f: { maxly: "50" } },
  habitable: { label: "Potentially habitable", f: { zone: "opt", rmax: "2.5" } },
  signal: { label: "Signal shortlist", f: { maxly: "30", zone: "opt", rmax: "2" }, view: { x: "ly", y: "esi", xlog: "1", ylog: "0", color: "zone" } },
};
const FILTER_KEYS = ["q", "status", "maxly", "rmin", "rmax", "mmin", "mmax", "smin", "smax", "tmin", "tmax", "zone", "method", "measured"];

const VIEWS = {
  hz: { label: "Habitable zone", x: "insol", y: "st_teff", xlog: "1", ylog: "0", color: "zone" },
  mr: { label: "Mass–radius", x: "masse", y: "rade", xlog: "1", ylog: "1", color: "method", est: "0" },
  pr: { label: "Period–radius", x: "per", y: "rade", xlog: "1", ylog: "1", color: "method" },
  near: { label: "Neighbourhood", x: "ly", y: "esi", xlog: "1", ylog: "0", color: "zone" },
  sky: { label: "Sky", x: "ra", y: "dec", xlog: "0", ylog: "0", color: "zone" },
  disc: { label: "Discovery", x: "year", y: "masse", xlog: "0", ylog: "1", color: "method" },
};

// ---------------------------------------------------------------- colour
function colorFn() {
  const css = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
  const base = css("--plot-point");
  if (S.color === "zone") {
    const cons = css("--signal"), opt = css("--c-opt"), none = css("--plot-dim");
    return (p) => (p.zone === "cons" ? { c: cons, z: 3 } : p.zone === "opt-inner" || p.zone === "opt-outer" ? { c: opt, z: 2 } : { c: none, z: 1 });
  }
  if (S.color === "method") {
    const c = { Transit: css("--c1"), "Radial Velocity": css("--c2") }, other = css("--c3");
    return (p) => ({ c: c[p.method] || other, z: c[p.method] ? 2 : 1 });
  }
  if (S.color === "esi") {
    const ramp = [1, 2, 3, 4, 5, 6, 7].map((i) => css(`--seq-${i}`)), none = css("--plot-dim");
    return (p) => (p.esi == null ? { c: none, z: 0 } : { c: ramp[Math.min(6, Math.floor(p.esi * 7))], z: 1 + p.esi });
  }
  if (S.color === "teff") {
    const cool = [1, 2, 3].map((i) => css(`--div-cool-${i}`)), hot = [1, 2, 3].map((i) => css(`--div-hot-${i}`)), mid = css("--div-mid"), none = css("--plot-dim");
    return (p) => {
      const t = p.st_teff;
      if (t == null) return { c: none, z: 0 };
      const d = Math.log2(t / 5772);   // ± one octave of temperature ~ M dwarf to A star
      if (Math.abs(d) < 0.08) return { c: mid, z: 1 };
      const i = Math.min(2, Math.floor((Math.abs(d) - 0.08) / 0.3));
      return { c: d < 0 ? cool[i] : hot[i], z: 1 };
    };
  }
  return () => ({ c: base, z: 1 });
}

function legendHTML() {
  const sw = (v, label) => `<li><span class="sw" style="background:var(${v})"></span>${label}</li>`;
  if (S.color === "zone") return sw("--signal", "Conservative HZ") + sw("--c-opt", "Optimistic HZ only") + sw("--plot-dim", "Outside HZ or unknown") + `<li><span class="sw sw-ring"></span>Solar System</li>`;
  if (S.color === "method") return sw("--c1", "Transit") + sw("--c2", "Radial velocity") + sw("--c3", "Other methods");
  if (S.color === "esi") return `<li class="ramp"><span>ESI 0</span>${[1, 2, 3, 4, 5, 6, 7].map((i) => `<span class="sw" style="background:var(--seq-${i})"></span>`).join("")}<span>1</span></li>`;
  if (S.color === "teff") return `<li class="ramp"><span>cooler star</span>${[3, 2, 1].map((i) => `<span class="sw" style="background:var(--div-cool-${i})"></span>`).join("")}<span class="sw" style="background:var(--div-mid)"></span>${[1, 2, 3].map((i) => `<span class="sw" style="background:var(--div-hot-${i})"></span>`).join("")}<span>hotter · Sun in grey</span></li>`;
  return "";
}

// ---------------------------------------------------------------- ranking
const WEIGHT_NAMES = [
  ["esi", "Earth similarity", "ESI from radius and insolation"],
  ["near", "Closeness", "1 at 0 ly, ½ at 20 ly, ⅓ at 40 ly"],
  ["hz", "Habitable-zone centre", "1 mid-HZ, ½ at its edges, 0.3 optimistic-only, 0 outside"],
  ["star", "Calm, long-lived star", "K 1 · G 0.9 · F 0.6 · M 0.5 · other 0.1"],
  ["data", "Measured, not estimated", "true mass and measured radius count ½ each"],
];
function components(p) {
  const hz = p.zone === "cons" ? 1 - 0.5 * Math.min(1, Math.abs(2 * (p.hzpos ?? 0.5) - 1)) : p.zone === "opt-inner" || p.zone === "opt-outer" ? 0.3 : 0;
  const star = { K: 1, G: 0.9, F: 0.6, M: 0.5 }[p.spclass] ?? 0.1;
  const data = (p.raw.masse != null && p.massprov === "Mass" ? 0.5 : 0) + (p.raw.rade != null && !p.rade_est ? 0.5 : 0);
  return { esi: p.esi ?? 0, near: p.ly == null ? 0 : 1 / (1 + p.ly / 20), hz, star, data };
}
function weights() { const w = S.w.split(",").map(Number); return WEIGHT_NAMES.map((_, i) => (Number.isFinite(w[i]) ? w[i] : 0)); }
function score(p, w) {
  const c = components(p), total = w.reduce((a, b) => a + b, 0) || 1;
  return { c, s: WEIGHT_NAMES.reduce((a, [k], i) => a + w[i] * c[k], 0) / total };
}

// ---------------------------------------------------------------- rendering
let plot;
let tableLimit = 200;

function render() {
  const list = filtered();
  $("#count").textContent = `${list.length.toLocaleString("en-US")} of ${ALL.length.toLocaleString("en-US")} planets`;
  $$("[role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === S.tab)));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${S.tab}`));
  $("#pin-count").textContent = pins().size ? `(${pins().size})` : "";
  if (S.tab === "plot") renderPlot(list);
  if (S.tab === "table") renderTable(list);
  if (S.tab === "rank") renderRank(list);
  if (S.tab === "compare") renderCompare();
  renderDetail();
  writeHash();
}

function renderPlot(list) {
  $("#ax-x").value = S.x; $("#ax-y").value = S.y; $("#log-x").checked = S.xlog === "1"; $("#log-y").checked = S.ylog === "1";
  $("#color-by").value = S.color; $("#show-ctx").checked = S.ctx === "1"; $("#show-sol").checked = S.sol === "1"; $("#show-est").checked = S.est === "1";
  const inList = new Set(list);
  // A point whose x or y is an estimate can be left out (e.g. mass–radius, where estimates trace the relation itself).
  const isEst = (p, k) => FIELDS[k].est && p.est.has(FIELDS[k].est);
  const drawn = S.est === "1" ? list : list.filter((p) => !isEst(p, S.x) && !isEst(p, S.y));
  plot.set({
    points: drawn,
    context: S.ctx === "1" ? ALL.filter((p) => !inList.has(p)) : [],
    showContext: S.ctx === "1",
    solar: S.sol === "1" ? SOLAR : null,
    x: S.x, y: S.y, xLog: S.xlog === "1", yLog: S.ylog === "1",
    xLabel: fieldLabel(S.x), yLabel: fieldLabel(S.y),
    // the classic habitable-zone plane gets a fixed frame around the Kopparapu limits
    xHint: S.x === "insol" && S.y === "st_teff" && S.xlog === "1" && S.ylog === "0" ? [0.02, 60] : null,
    yHint: S.x === "insol" && S.y === "st_teff" && S.xlog === "1" && S.ylog === "0" ? [2300, 7500] : null,
    color: colorFn(), pins: pins(), selected: S.sel,
  });
  $("#legend").innerHTML = legendHTML();
  const missing = list.filter((p) => p[S.x] == null || p[S.y] == null).length;
  const hidden = list.length - drawn.length;
  $("#plot-note").textContent = (missing ? `${missing.toLocaleString("en-US")} matching planets lack one of these values and are not drawn. ` : "") +
    (hidden ? `${hidden.toLocaleString("en-US")} with estimated values are hidden. ` : "") +
    (S.x === "insol" && S.y === "st_teff" ? "Bands: Kopparapu et al. (2014) habitable zone, conservative (darker) and optimistic. " : "") +
    "Drag to zoom, double-click to reset, click a planet for details.";
}

const TABLE_COLS = [
  ["name", "Planet"], ["ly", "Dist. ly", 1], ["rade", "R⊕", 1], ["masse", "M⊕", 1], ["per", "Period d", 1], ["insol", "S⊕", 1],
  ["teq", "Teq K", 1], ["esi", "ESI", 1], ["zone", "Zone"], ["star", "Star"], ["method", "Method"], ["year", "Year", 1],
];
function cell(p, k) {
  const f = FIELDS[k];
  if (!f) return "";
  const v = p[k];
  const est = f.est && p.est.has(f.est) && v != null;
  const msini = k === "masse" && p.massprov === "Msini" && !est;
  return `<td class="num${est ? " est" : ""}"${est ? ' title="estimate"' : msini ? ' title="minimum mass (M sin i)"' : ""}>${est ? "~" : ""}${fmt(v, f.digits, f.int)}${msini ? "<sup>min</sup>" : ""}</td>`;
}
function sortValue(p, k) {
  if (k === "name") return p.name.toLowerCase();
  if (k === "zone") return p.zone ? ["cons", "opt-inner", "opt-outer", "hot", "cold"].indexOf(p.zone) : 9;
  if (k === "star") return p.st_teff ?? null;
  if (k === "method") return p.method;
  return p[k];
}
function sorted(list) {
  const k = S.sort, dir = S.dir === "desc" ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, k), vb = sortValue(b, k);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}
function starCell(p) { return `<td>${esc(p.st_spt || p.spclass || "–")}${p.st_teff ? ` <span class="muted">${fmt(p.st_teff, 4)} K</span>` : ""}</td>`; }
function zoneCell(p) { return `<td>${p.zone ? `<span class="zone zone-${p.zone}">${ZONE_SHORT[p.zone]}</span>` : "–"}</td>`; }
function nameCell(p, pinset) {
  const on = pinset.has(p.name);
  return `<td class="name"><button class="pin" data-pin="${esc(p.name)}" aria-pressed="${on}" title="${on ? "Remove from" : "Add to"} shortlist">${on ? "★" : "☆"}</button>` +
    `<a href="#" data-sel="${esc(p.name)}">${esc(p.name)}</a>${p.status !== "confirmed" ? ` <span class="flag">${p.status}</span>` : ""}</td>`;
}
function renderTable(list) {
  const rows = sorted(list), pinset = pins();
  $("#table-head").innerHTML = TABLE_COLS.map(([k, label, n]) =>
    `<th class="${n ? "num" : ""}" aria-sort="${S.sort === k ? (S.dir === "asc" ? "ascending" : "descending") : "none"}"><button data-sort="${k}">${label}${S.sort === k ? (S.dir === "asc" ? " ↑" : " ↓") : ""}</button></th>`).join("");
  $("#table-body").innerHTML = rows.slice(0, tableLimit).map((p) =>
    `<tr${p.name === S.sel ? ' class="is-sel"' : ""}>${nameCell(p, pinset)}${cell(p, "ly")}${cell(p, "rade")}${cell(p, "masse")}${cell(p, "per")}${cell(p, "insol")}${cell(p, "teq")}${cell(p, "esi")}${zoneCell(p)}${starCell(p)}<td>${esc(p.method)}</td>${cell(p, "year")}</tr>`).join("");
  $("#table-more").hidden = rows.length <= tableLimit;
  $("#table-more").textContent = `Show more (${(rows.length - tableLimit).toLocaleString("en-US")} left)`;
}

function renderRank(list) {
  const w = weights();
  $$("#weights input").forEach((inp, i) => { inp.value = w[i]; inp.nextElementSibling.textContent = w[i]; });
  const ranked = list.map((p) => ({ p, ...score(p, w) })).sort((a, b) => b.s - a.s).slice(0, 60);
  const pinset = pins();
  $("#rank-body").innerHTML = ranked.map(({ p, s, c }, i) =>
    `<tr${p.name === S.sel ? ' class="is-sel"' : ""}><td class="num">${i + 1}</td>${nameCell(p, pinset)}<td class="num"><strong>${s.toFixed(3)}</strong></td>` +
    `<td><span class="bars">${WEIGHT_NAMES.map(([k, label], j) => `<span class="bar" style="--v:${c[k]};--w:${w[j]}" title="${label}: ${c[k].toFixed(2)}"></span>`).join("")}</span></td>` +
    `${cell(p, "ly")}${cell(p, "esi")}${zoneCell(p)}${starCell(p)}</tr>`).join("");
}

function compareRows() {
  return [
    ["Distance", (p) => `${fmt(p.ly, 3)} ly`],
    ["Light time one way", (p) => (p.ly == null ? "–" : `${fmt(p.ly, 3)} years`)],
    ["Radius", (p) => est(p, "rade") + `${fmt(p.rade, 3)} R⊕`],
    ["Mass", (p) => est(p, "masse") + `${fmt(p.masse, 3)} M⊕${p.massprov === "Msini" ? " (min)" : ""}`],
    ["Density", (p) => est(p, "density") + `${fmt(p.density, 2)} g/cm³`],
    ["Surface gravity", (p) => est(p, "gravity") + `${fmt(p.gravity, 2)} g`],
    ["Orbital period", (p) => `${fmt(p.per, 4)} d`],
    ["Semi-major axis", (p) => est(p, "a") + `${fmt(p.a, 3)} AU`],
    ["Eccentricity", (p) => fmt(p.e, 2)],
    ["Insolation", (p) => est(p, "insol") + `${fmt(p.insol, 3)} S⊕`],
    ["Equilibrium temp.", (p) => est(p, "teq") + `${fmt(p.teq, 3)} K`],
    ["Earth Similarity", (p) => est(p, "esi") + fmt(p.esi, 2)],
    ["Zone", (p) => (p.zone ? ZONE_LABEL[p.zone] : "–")],
    ["Tidal lock time", (p) => (p.lock == null ? "–" : `~${fmt(p.lock, 2)} yr`)],
    ["Planet type", (p) => p.type ?? "–"],
    ["Star", (p) => `${p.st_spt || p.spclass || "–"} · ${fmt(p.st_teff, 4)} K`],
    ["Star age", (p) => (p.st_age == null ? "–" : `${fmt(p.st_age, 2)} Gyr`)],
    ["Planets in system", (p) => fmt(p.np, 2, true)],
    ["Discovered", (p) => `${p.year ?? "–"} · ${p.method || "–"}`],
    ["Status", (p) => p.status],
  ];
}
const est = (p, k) => (p.est?.has(k) ? "~" : "");
function renderCompare() {
  const names = [...pins()];
  const list = names.map((n) => ALL.find((p) => p.name === n)).filter(Boolean);
  $("#compare-empty").hidden = list.length > 0;
  $("#compare-wrap").hidden = list.length === 0;
  if (!list.length) return;
  const cols = [...list, SOLAR.find((p) => p.name === "Earth")];
  $("#compare-head").innerHTML = `<th></th>` + cols.map((p) => `<th>${p.status === "solar" ? "Earth" : `<a href="#" data-sel="${esc(p.name)}">${esc(p.name)}</a> <button class="pin" data-pin="${esc(p.name)}" aria-pressed="true" title="Remove from shortlist">×</button>`}</th>`).join("");
  $("#compare-body").innerHTML = compareRows().map(([label, f]) => `<tr><th scope="row">${label}</th>${cols.map((p) => `<td>${esc(f(p))}</td>`).join("")}</tr>`).join("");
}

function exportRows() {
  const list = [...pins()].map((n) => ALL.find((p) => p.name === n)).filter(Boolean);
  const head = ["planet", "host", "status", "distance_ly", "radius_re", "radius_estimated", "mass_me", "mass_kind", "period_d", "a_au", "insolation_se", "teq_k", "esi", "zone", "star_type", "star_teff_k", "star_age_gyr", "method", "year"];
  const rows = list.map((p) => [p.name, p.host, p.status, p.ly, p.rade, p.est.has("rade") ? 1 : 0, p.masse, p.est.has("masse") ? "estimate" : p.massprov, p.per, p.a, p.insol, p.teq, p.esi, p.zone, p.st_spt || p.spclass, p.st_teff, p.st_age, p.method, p.year]);
  return { head, rows };
}

function renderDetail() {
  const box = $("#detail");
  const p = ALL.find((x) => x.name === S.sel) || SOLAR.find((x) => x.name === S.sel);
  box.hidden = !p;
  document.body.classList.toggle("has-detail", !!p);
  if (!p) return;
  const on = pins().has(p.name);
  const yr = storyYear();
  const L = hzLimits(p.st_teff);
  const r = (label, v) => `<div><dt>${label}</dt><dd>${v}</dd></div>`;
  const solar = p.status === "solar";
  box.innerHTML = `
    <div class="detail-head">
      <p class="eyebrow">${esc(solar ? "Solar System" : p.host)}${p.status !== "confirmed" && !solar ? ` · <span class="flag">${p.status}</span>` : ""}</p>
      <h2>${esc(p.name)}</h2>
      <p class="detail-type">${esc(p.type ?? "")}${p.zone ? ` · <span class="zone zone-${p.zone}">${ZONE_LABEL[p.zone]}</span>` : ""}</p>
      <div class="row">
        ${solar ? "" : `<button class="btn btn-sm${on ? " btn-primary" : ""}" data-pin="${esc(p.name)}" aria-pressed="${on}">${on ? "★ On shortlist" : "☆ Add to shortlist"}</button>`}
        <button class="btn btn-sm btn-ghost" data-close>Close</button>
      </div>
    </div>
    ${solar ? "" : `<h3 class="kicker">Contact</h3>
    <dl class="readouts">
      ${r("Distance", `${fmt(p.ly, 3)} ly`)}
      ${r("Round trip", p.ly == null ? "–" : `${fmt(2 * p.ly, 3)} yr`)}
      ${r(`Heard in ${yr}, sent`, p.ly == null ? "–" : `≈ ${Math.round(yr - p.ly)}`)}
      ${r(`Reply from ${yr} lands`, p.ly == null ? "–" : `≈ ${Math.round(yr + p.ly)}`)}
      ${r("RA", hms(p.ra))}
      ${r("Dec", dms(p.dec))}
    </dl>`}
    <h3 class="kicker">Planet</h3>
    <dl class="readouts">
      ${r("Radius", `${est(p, "rade")}${fmt(p.rade, 3)} R⊕`)}
      ${r(p.massprov === "Msini" ? "Mass (minimum)" : "Mass", `${est(p, "masse")}${fmt(p.masse, 3)} M⊕`)}
      ${r("Density", `${est(p, "density")}${fmt(p.density, 2)} g/cm³`)}
      ${r("Gravity", `${est(p, "gravity")}${fmt(p.gravity, 2)} g`)}
      ${r("Escape velocity", `${est(p, "vesc")}${fmt(p.vesc, 2)} km/s`)}
      ${r("Period", `${fmt(p.per, 4)} d`)}
      ${r("Orbit", `${est(p, "a")}${fmt(p.a, 3)} AU`)}
      ${r("Eccentricity", fmt(p.e, 2))}
      ${r("Insolation", `${est(p, "insol")}${fmt(p.insol, 3)} S⊕`)}
      ${r("Equilibrium temp.", `${est(p, "teq")}${fmt(p.teq, 3)} K`)}
      ${r("Earth Similarity", `${est(p, "esi")}${fmt(p.esi, 2)}`)}
      ${r("Place in HZ", p.hzpos == null ? "–" : `${fmt(p.hzpos, 2)} <span class="muted">(0 inner, 1 outer)</span>`)}
      ${r("Tidal lock in", p.lock == null ? "–" : `~${fmt(p.lock, 2)} yr`)}
    </dl>
    <h3 class="kicker">Star</h3>
    <dl class="readouts">
      ${r("Type", esc(p.st_spt || (p.spclass ? `${p.spclass} (from Teff)` : "–")))}
      ${r("Temperature", `${fmt(p.st_teff, 4)} K`)}
      ${r("Mass", `${fmt(p.st_mass, 3)} M☉`)}
      ${r("Radius", `${fmt(p.st_rad, 3)} R☉`)}
      ${r("Luminosity", `${fmt(p.lum, 3)} L☉`)}
      ${r("Age", p.st_age == null ? "–" : `${fmt(p.st_age, 2)} Gyr`)}
      ${r("Metallicity", p.st_met == null ? "–" : `${fmt(p.st_met, 2)} dex`)}
      ${r("HZ (conservative)", L ? `${fmt(Math.sqrt((p.lum ?? NaN) / L.runaway), 2)}–${fmt(Math.sqrt((p.lum ?? NaN) / L.maxGreenhouse), 2)} AU` : "–")}
    </dl>
    ${solar ? "" : `<p class="note">${p.est.size ? "Values marked ~ are estimates (see About). " : ""}Discovered ${p.year ?? "–"} by ${esc(p.method || "–")}${p.facility ? ` at ${esc(p.facility)}` : ""}. ${p.np ? `${p.np} known planet${p.np > 1 ? "s" : ""} in this system. ` : ""}
    <a href="https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(p.host || p.name)}" target="_blank" rel="noopener">Open in the NASA Exoplanet Archive</a></p>
    <button class="btn btn-sm btn-ghost" data-siblings="${esc(p.host)}">Show its system</button>`}`;
}

// ---------------------------------------------------------------- controls
function fillSelect(sel, keys) { sel.innerHTML = keys.map((k) => `<option value="${k}">${fieldLabel(k)}</option>`).join(""); }

function syncFilterInputs() {
  for (const k of FILTER_KEYS) {
    const el = $(`[data-f="${k}"]`);
    if (!el) continue;
    if (k === "status" || k === "method") {
      const set = new Set(S[k].split(",").filter(Boolean));
      $$(`[data-f="${k}"] input`).forEach((i) => (i.checked = k === "method" ? set.has(i.value) : set.has(i.value)));
    } else el.value = S[k];
  }
}

function applyPreset(name) {
  const pr = PRESETS[name];
  for (const k of FILTER_KEYS) S[k] = DEFAULTS[k];
  Object.assign(S, pr.f);
  if (pr.view) Object.assign(S, pr.view);
  syncFilterInputs();
  render();
}

function bind() {
  fillSelect($("#ax-x"), Object.keys(FIELDS));
  fillSelect($("#ax-y"), Object.keys(FIELDS));
  $("#presets").innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button class="btn btn-sm" data-preset="${k}">${p.label}</button>`).join("");
  $("#views").innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button class="btn btn-sm btn-ghost" data-view="${k}">${v.label}</button>`).join("");
  $("[data-f=method]").innerHTML = METHOD_GROUPS.map((m) => `<label><input type="checkbox" value="${m}"> ${m}</label>`).join("");
  $("#weights").innerHTML = WEIGHT_NAMES.map(([k, label, hint]) =>
    `<label class="weight"><span>${label}<small>${hint}</small></span><input type="range" min="0" max="5" step="1" data-w="${k}"><output></output></label>`).join("");
  syncFilterInputs();

  // filters
  for (const k of FILTER_KEYS) {
    const el = $(`[data-f="${k}"]`);
    if (!el) continue;
    if (k === "status" || k === "method") {
      el.addEventListener("change", () => { S[k] = $$("input:checked", el).map((i) => i.value).join(","); render(); });
    } else {
      el.addEventListener("input", () => { S[k] = el.value; tableLimit = 200; render(); });
    }
  }
  $("#reset").addEventListener("click", () => applyPreset("all"));
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-preset],[data-view],[data-tab],[data-sort],[data-pin],[data-sel],[data-close],[data-siblings]");
    if (!t) return;
    if (t.dataset.preset) applyPreset(t.dataset.preset);
    else if (t.dataset.view) { const v = VIEWS[t.dataset.view]; Object.assign(S, { x: v.x, y: v.y, xlog: v.xlog, ylog: v.ylog, color: v.color, est: v.est ?? "1", tab: "plot" }); render(); }
    else if (t.dataset.tab) { S.tab = t.dataset.tab; render(); }
    else if (t.dataset.sort) { if (S.sort === t.dataset.sort) S.dir = S.dir === "asc" ? "desc" : "asc"; else { S.sort = t.dataset.sort; S.dir = ["esi", "year"].includes(S.sort) ? "desc" : "asc"; } render(); }
    else if (t.dataset.pin) { const set = pins(); set.has(t.dataset.pin) ? set.delete(t.dataset.pin) : set.add(t.dataset.pin); setPins(set); render(); }
    else if (t.dataset.sel) { ev.preventDefault(); S.sel = t.dataset.sel; render(); $("#detail").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    else if (t.dataset.close !== undefined) { S.sel = ""; render(); }
    else if (t.dataset.siblings) { for (const k of FILTER_KEYS) S[k] = DEFAULTS[k]; S.q = t.dataset.siblings; S.status = "confirmed,controversial,retracted"; syncFilterInputs(); S.tab = "table"; render(); }
  });

  // plot controls
  $("#ax-x").addEventListener("change", (e) => { S.x = e.target.value; S.xlog = FIELDS[S.x].log ? "1" : "0"; render(); });
  $("#ax-y").addEventListener("change", (e) => { S.y = e.target.value; S.ylog = FIELDS[S.y].log ? "1" : "0"; render(); });
  $("#log-x").addEventListener("change", (e) => { S.xlog = e.target.checked ? "1" : "0"; render(); });
  $("#log-y").addEventListener("change", (e) => { S.ylog = e.target.checked ? "1" : "0"; render(); });
  $("#swap").addEventListener("click", () => { [S.x, S.y, S.xlog, S.ylog] = [S.y, S.x, S.ylog, S.xlog]; render(); });
  $("#color-by").addEventListener("change", (e) => { S.color = e.target.value; render(); });
  $("#show-ctx").addEventListener("change", (e) => { S.ctx = e.target.checked ? "1" : "0"; render(); });
  $("#show-sol").addEventListener("change", (e) => { S.sol = e.target.checked ? "1" : "0"; render(); });
  $("#show-est").addEventListener("change", (e) => { S.est = e.target.checked ? "1" : "0"; render(); });
  $("#zoom-reset").addEventListener("click", () => plot.resetZoom());
  $("#plot").addEventListener("zoomchange", (e) => ($("#zoom-reset").hidden = !e.detail));

  // table
  $("#table-more").addEventListener("click", () => { tableLimit += 500; render(); });

  // ranking
  $("#weights").addEventListener("input", (e) => {
    const w = weights(); const i = WEIGHT_NAMES.findIndex(([k]) => k === e.target.dataset.w);
    w[i] = Number(e.target.value); S.w = w.join(","); render();
  });

  // compare / export
  $("#export-csv").addEventListener("click", () => {
    const { head, rows } = exportRows();
    const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : typeof v === "number" ? String(Number(v.toPrecision(6))) : String(v));
    const blob = new Blob([[head, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n"], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "exoplanet-shortlist.csv" });
    a.click(); URL.revokeObjectURL(a.href);
  });
  $("#copy-md").addEventListener("click", async () => {
    const list = [...pins()].map((n) => ALL.find((p) => p.name === n)).filter(Boolean);
    const rows = compareRows();
    const md = [`| | ${list.map((p) => p.name).join(" | ")} |`, `|---|${list.map(() => "---").join("|")}|`, ...rows.map(([l, f]) => `| ${l} | ${list.map(f).join(" | ")} |`)].join("\n");
    await copy(md, "#copy-md");
  });
  $("#copy-link").addEventListener("click", () => copy(location.href, "#copy-link"));

  window.addEventListener("hashchange", () => { readHash(); syncFilterInputs(); render(); });
  $("#filters-toggle").addEventListener("click", () => {
    const open = document.body.classList.toggle("filters-open");
    $("#filters-toggle").setAttribute("aria-expanded", String(open));
  });
}

async function copy(text, btn) {
  const b = $(btn), was = b.textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Copy failed"; }
  setTimeout(() => (b.textContent = was), 1500);
}

function stamp() {
  const src = META.source;
  $("#data-stamp").innerHTML = `${META.count.toLocaleString("en-US")} planets · <a href="${esc(src.url)}">${esc(src.name)}</a> · built ${esc(META.built.slice(0, 10))}`;
  $("#citation").textContent = src.citation;
}

// ---------------------------------------------------------------- start
(async function main() {
  readHash();
  try {
    await load();
  } catch (err) {
    $("#count").textContent = `Could not load the planet data (${err.message}).`;
    return;
  }
  plot = new Scatter($("#plot"), { onSelect: (p) => { S.sel = p.name; render(); } });
  bind();
  stamp();
  document.body.classList.add("ready");
  render();
})();

