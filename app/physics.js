// Derived quantities for one planet. Pure functions, no DOM: tests/physics.test.mjs runs them in Node.
// Every derived value says where it came from (`src`), so the page can mark estimates.

export const LY_PER_PC = 3.261564;
export const SUN_TEFF = 5772;      // K
const G = 6.674e-11;
const M_SUN = 1.989e30, M_EARTH = 5.972e24;
const R_EARTH = 6.371e6, AU = 1.496e11;
const YEAR_S = 3.15576e7;

const ok = (v) => typeof v === "number" && Number.isFinite(v);

// Chen & Kipping (2017) "Forecaster" mean relation, piecewise power law R = C M^S (Earth units).
// Terran < 2.04 M⊕, Neptunian < 132 M⊕ (0.414 MJ), Jovian above. Good to ~a factor of 1.5.
const MR = [
  { mMax: 2.04, c: 1.008, s: 0.279 },
  { mMax: 132, c: 0.80811, s: 0.589 },
  { mMax: 26600, c: 17.739, s: -0.044 },
];
export function radiusFromMass(m) {
  if (!ok(m) || m <= 0) return null;
  const seg = MR.find((p) => m < p.mMax) ?? MR[2];
  return seg.c * m ** seg.s;
}
// Inverse on the monotonic part only: above ~14 R⊕ (the Jovian plateau) mass is unconstrained.
export function massFromRadius(r) {
  if (!ok(r) || r <= 0) return null;
  const r1 = radiusFromMass(2.04), r2 = radiusFromMass(132);
  if (r < r1) return (r / MR[0].c) ** (1 / MR[0].s);
  if (r < r2) return (r / MR[1].c) ** (1 / MR[1].s);
  return null;
}

// Kopparapu et al. (2014) habitable-zone limits for a 1 M⊕ planet: Seff = S0 + aT + bT² + cT³ + dT⁴, T = Teff − 5780.
// Valid for 2600 K ≤ Teff ≤ 7200 K; outside that we clamp and say so.
const HZ = {
  recentVenus:     [1.776, 2.136e-4, 2.533e-8, -1.332e-11, -3.097e-15],
  runaway:         [1.107, 1.332e-4, 1.580e-8, -8.308e-12, -1.931e-15],
  maxGreenhouse:   [0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16],
  earlyMars:       [0.320, 5.547e-5, 1.526e-9, -2.874e-12, -5.011e-16],
};
export function hzLimits(teff) {
  if (!ok(teff)) return null;
  const t = Math.min(7200, Math.max(2600, teff)) - 5780;
  const out = {};
  for (const [k, [s0, a, b, c, d]] of Object.entries(HZ)) out[k] = s0 + a * t + b * t * t + c * t ** 3 + d * t ** 4;
  out.clamped = teff < 2600 || teff > 7200;
  return out;
}

// Zone names run hot → cold. "cons" = conservative HZ, "opt-*" = only in the optimistic HZ.
export const ZONES = ["hot", "opt-inner", "cons", "opt-outer", "cold"];
export function hzZone(insol, teff) {
  const L = hzLimits(teff);
  if (!L || !ok(insol)) return null;
  if (insol > L.recentVenus) return "hot";
  if (insol > L.runaway) return "opt-inner";
  if (insol >= L.maxGreenhouse) return "cons";
  if (insol >= L.earlyMars) return "opt-outer";
  return "cold";
}
// Position across the conservative HZ in distance terms: 0 = inner edge, 1 = outer edge, 0.5 = middle.
export function hzPosition(insol, teff) {
  const L = hzLimits(teff);
  if (!L || !ok(insol) || insol <= 0) return null;
  const d = 1 / Math.sqrt(insol), din = 1 / Math.sqrt(L.runaway), dout = 1 / Math.sqrt(L.maxGreenhouse);
  return (d - din) / (dout - din);
}

// Earth Similarity Index from radius and stellar flux (the PHL form used for its habitable-planet catalogue).
export function esi(rade, insol) {
  if (!ok(rade) || !ok(insol) || rade <= 0 || insol < 0) return null;
  const r = (rade - 1) / (rade + 1), s = (insol - 1) / (insol + 1);
  return 1 - Math.sqrt(0.5 * (r * r + s * s));
}

export function luminosity(p) {
  if (ok(p.st_lum)) return { v: 10 ** p.st_lum, src: "catalogue" };
  if (ok(p.st_rad) && ok(p.st_teff)) return { v: p.st_rad ** 2 * (p.st_teff / SUN_TEFF) ** 4, src: "R²T⁴" };
  return null;
}

export function semiMajor(p) {
  if (ok(p.a)) return { v: p.a, src: "catalogue" };
  if (ok(p.per) && ok(p.st_mass)) return { v: Math.cbrt(p.st_mass * (p.per / 365.25) ** 2), src: "Kepler's 3rd law" };
  return null;
}

export function spectralClass(p) {
  const s = (p.st_spt || "").trim();
  const m = s.match(/^(sd|d)?([OBAFGKMLTY])/);
  if (m) return m[2];
  const t = p.st_teff;
  if (!ok(t)) return null;
  if (t >= 30000) return "O";
  if (t >= 10000) return "B";
  if (t >= 7500) return "A";
  if (t >= 6000) return "F";
  if (t >= 5200) return "G";
  if (t >= 3700) return "K";
  if (t >= 2400) return "M";
  return "L";
}

// Rough planet type by size (or by mass when no radius). Fulton gap at ~1.6–1.8 R⊕.
export function planetType(rade, masse) {
  if (ok(rade)) {
    if (rade < 0.8) return "sub-Earth";
    if (rade < 1.6) return "rocky";
    if (rade < 4) return "sub-Neptune";
    if (rade < 8) return "Neptune-like";
    return "giant";
  }
  if (ok(masse)) {
    if (masse < 0.5) return "sub-Earth";
    if (masse < 5) return "rocky";
    if (masse < 15) return "sub-Neptune";
    if (masse < 50) return "Neptune-like";
    return "giant";
  }
  return null;
}

// Tidal locking timescale (Gladman et al. 1996), starting spin 12 h, Q = 100, k2 = 0.3, I = 0.33 m R².
export function tidalLockYears(aAU, masse, rade, stMass) {
  if (![aAU, masse, rade, stMass].every(ok)) return null;
  const a = aAU * AU, m = masse * M_EARTH, r = rade * R_EARTH, ms = stMass * M_SUN;
  const omega = (2 * Math.PI) / (12 * 3600);
  const t = (omega * a ** 6 * 0.33 * m * r * r * 100) / (3 * G * ms * ms * 0.3 * r ** 5);
  return t / YEAR_S;
}

// Everything the page shows that is not in the catalogue. `est` lists the keys that are estimates.
export function derive(p) {
  const d = { est: new Set() };
  d.ly = ok(p.dist) ? p.dist * LY_PER_PC : null;

  d.rade = p.rade ?? null;
  d.masse = p.masse ?? null;
  if (p.rade_est) d.est.add("rade");
  if (!ok(d.rade) && ok(d.masse)) { d.rade = radiusFromMass(d.masse); d.est.add("rade"); }
  if (!ok(d.masse) && ok(d.rade)) { const m = massFromRadius(d.rade); if (m != null) { d.masse = m; d.est.add("masse"); } }

  const a = semiMajor(p);
  d.a = a?.v ?? null;
  if (a && a.src !== "catalogue") d.est.add("a");

  const L = luminosity(p);
  d.lum = L?.v ?? null;
  d.insol = p.insol ?? null;
  if (!ok(d.insol) && L && ok(d.a) && d.a > 0) { d.insol = L.v / (d.a * d.a); d.est.add("insol"); }

  d.teq = p.teq ?? null;
  if (!ok(d.teq) && ok(d.insol)) { d.teq = 278.6 * d.insol ** 0.25; d.est.add("teq"); }   // albedo 0, full redistribution

  d.density = ok(d.rade) && ok(d.masse) ? (5.514 * d.masse) / d.rade ** 3 : null;      // g/cm³
  d.gravity = ok(d.rade) && ok(d.masse) ? d.masse / d.rade ** 2 : null;                // g⊕
  d.vesc = ok(d.rade) && ok(d.masse) ? 11.186 * Math.sqrt(d.masse / d.rade) : null;    // km/s
  if (d.est.has("rade") || d.est.has("masse")) for (const k of ["density", "gravity", "vesc"]) if (d[k] != null) d.est.add(k);

  d.esi = esi(d.rade, d.insol);
  if (d.esi != null && (d.est.has("rade") || d.est.has("insol"))) d.est.add("esi");
  d.zone = hzZone(d.insol, p.st_teff);
  d.hzpos = hzPosition(d.insol, p.st_teff);
  d.spclass = spectralClass(p);
  d.type = planetType(d.rade, d.masse);
  d.lock = tidalLockYears(d.a, d.masse, d.rade, p.st_mass);
  return d;
}

// Solar System reference points, same field names as the catalogue.
export const SOLAR_SYSTEM = [
  ["Mercury", 0.383, 0.0553, 87.97, 0.387, 6.67],
  ["Venus", 0.949, 0.815, 224.7, 0.723, 1.91],
  ["Earth", 1, 1, 365.256, 1, 1],
  ["Mars", 0.532, 0.107, 686.98, 1.524, 0.431],
  ["Jupiter", 11.21, 317.8, 4332.6, 5.203, 0.037],
  ["Saturn", 9.45, 95.2, 10759, 9.537, 0.011],
  ["Uranus", 4.01, 14.5, 30687, 19.19, 0.0027],
  ["Neptune", 3.88, 17.1, 60190, 30.07, 0.0011],
].map(([name, rade, masse, per, a, insol]) => ({
  name, host: "Sun", status: "solar", method: "", rade, masse, per, a, insol, e: 0,
  st_teff: SUN_TEFF, st_rad: 1, st_mass: 1, st_lum: 0, st_spt: "G2V", st_age: 4.6, dist: null,
}));
