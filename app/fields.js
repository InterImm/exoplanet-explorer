// Numeric fields the plot, table and filters can use. `get` reads a planet record built by explorer.js
// (catalogue values merged with physics.derive). `est` names the derived key whose estimate flag applies.

export const FIELDS = {
  ly:      { label: "Distance", unit: "ly", log: true, digits: 3 },
  rade:    { label: "Radius", unit: "R⊕", log: true, digits: 3, est: "rade" },
  masse:   { label: "Mass", unit: "M⊕", log: true, digits: 3, est: "masse" },
  per:     { label: "Orbital period", unit: "d", log: true, digits: 4 },
  a:       { label: "Semi-major axis", unit: "AU", log: true, digits: 3, est: "a" },
  e:       { label: "Eccentricity", unit: "", log: false, digits: 2 },
  insol:   { label: "Insolation", unit: "S⊕", log: true, digits: 3, est: "insol" },
  teq:     { label: "Equilibrium temp.", unit: "K", log: false, digits: 3, est: "teq" },
  esi:     { label: "Earth Similarity", unit: "ESI", log: false, digits: 2, est: "esi" },
  hzpos:   { label: "Place in HZ", unit: "0 inner · 1 outer", log: false, digits: 2 },
  density: { label: "Density", unit: "g/cm³", log: true, digits: 2, est: "density" },
  gravity: { label: "Surface gravity", unit: "g⊕", log: true, digits: 2, est: "gravity" },
  lock:    { label: "Tidal-lock time", unit: "yr", log: true, digits: 2 },
  st_teff: { label: "Star temperature", unit: "K", log: false, digits: 4 },
  st_mass: { label: "Star mass", unit: "M☉", log: true, digits: 2 },
  st_rad:  { label: "Star radius", unit: "R☉", log: true, digits: 2 },
  lum:     { label: "Star luminosity", unit: "L☉", log: true, digits: 2 },
  st_met:  { label: "Star metallicity", unit: "dex", log: false, digits: 2 },
  st_age:  { label: "Star age", unit: "Gyr", log: false, digits: 2 },
  year:    { label: "Discovery year", unit: "", log: false, digits: 4, int: true },
  ra:      { label: "Right ascension", unit: "deg", log: false, digits: 4 },
  dec:     { label: "Declination", unit: "deg", log: false, digits: 4 },
  np:      { label: "Planets in system", unit: "", log: false, digits: 2, int: true },
};

export const ZONE_LABEL = {
  hot: "Too hot",
  "opt-inner": "Optimistic HZ (warm edge)",
  cons: "Conservative HZ",
  "opt-outer": "Optimistic HZ (cool edge)",
  cold: "Too cold",
};
export const ZONE_SHORT = { hot: "hot", "opt-inner": "opt. HZ", cons: "HZ", "opt-outer": "opt. HZ", cold: "cold" };

// Significant-figure formatting that keeps tables tidy.
export function fmt(v, digits = 3, int = false) {
  if (v == null || !Number.isFinite(v)) return "–";
  if (int) return String(Math.round(v));
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(Math.max(0, digits - 1)).replace("e+", "e");
  const s = Number(v.toPrecision(digits));
  return s.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function fieldLabel(key) {
  const f = FIELDS[key];
  return f.unit ? `${f.label} (${f.unit})` : f.label;
}

export function hms(deg) {
  if (deg == null) return "–";
  const h = deg / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss.toFixed(1).padStart(4, "0")}s`;
}
export function dms(deg) {
  if (deg == null) return "–";
  const s = deg < 0 ? "−" : "+", a = Math.abs(deg), d = Math.floor(a), m = Math.floor((a - d) * 60), x = ((a - d) * 60 - m) * 60;
  return `${s}${String(d).padStart(2, "0")}°${String(m).padStart(2, "0")}′${x.toFixed(0).padStart(2, "0")}″`;
}
