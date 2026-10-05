// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { esi, hzLimits, hzZone, hzPosition, radiusFromMass, massFromRadius, derive, tidalLockYears, spectralClass, SOLAR_SYSTEM } from "../app/physics.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("ESI is 1 for Earth and falls away from it", () => {
  assert.equal(esi(1, 1), 1);
  assert.ok(esi(1.1, 0.9) > 0.9);
  assert.ok(esi(11.2, 0.037) < 0.4);
  assert.equal(esi(null, 1), null);
});

test("Kopparapu 2014 limits for the Sun", () => {
  const L = hzLimits(5780);
  near(L.recentVenus, 1.776, 1e-9);
  near(L.runaway, 1.107, 1e-9);
  near(L.maxGreenhouse, 0.356, 1e-9);
  near(L.earlyMars, 0.32, 1e-9);
  assert.equal(L.clamped, false);
  assert.equal(hzLimits(2000).clamped, true);
});

test("Solar System planets land in the expected zones", () => {
  const zone = Object.fromEntries(SOLAR_SYSTEM.map((p) => [p.name, hzZone(p.insol, p.st_teff)]));
  assert.equal(zone.Venus, "hot");
  assert.equal(zone.Earth, "cons");
  assert.equal(zone.Mars, "cons");
  assert.equal(zone.Jupiter, "cold");
  const pos = hzPosition(1, 5772);
  assert.ok(pos > 0 && pos < 0.5, `Earth sits in the inner half of the HZ (${pos})`);
});

test("mass-radius relation is continuous and invertible", () => {
  near(radiusFromMass(1), 1.008, 1e-9);
  near(radiusFromMass(2.0399), radiusFromMass(2.0401), 1e-3);
  near(radiusFromMass(131.99), radiusFromMass(132.01), 0.05);
  near(radiusFromMass(317.8), 13.0, 1.0);          // Jupiter-mass forecast ~ 1.1–1.2 RJ
  for (const m of [0.3, 1, 3, 17, 90]) near(massFromRadius(radiusFromMass(m)), m, m * 1e-6);
  assert.equal(massFromRadius(20), null);
});

test("derive fills radius, insolation and ESI for an RV planet (Ross 128 b)", () => {
  const p = { name: "Ross 128 b", masse: 1.4, massprov: "Msini", per: 9.8658, a: 0.0496, st_teff: 3192, st_rad: 0.197, st_mass: 0.168, dist: 3.381 };
  const d = derive(p);
  near(d.ly, 11.03, 0.02);
  assert.ok(d.est.has("rade") && d.est.has("insol") && d.est.has("esi"));
  near(d.insol, 1.38, 0.1);    // published: 1.38 S⊕
  assert.equal(d.zone, "opt-inner");
  assert.ok(d.esi > 0.8);
  assert.equal(d.type, "rocky");
  assert.ok(d.lock < 1e9, "a close-in M-dwarf planet should lock fast");
});

test("Kepler's third law fills a missing semi-major axis", () => {
  const d = derive({ per: 365.25, st_mass: 1, st_rad: 1, st_teff: 5772 });
  near(d.a, 1, 1e-9);
  near(d.insol, 1, 1e-9);
  near(d.teq, 278.6, 1e-6);
});

test("Earth does not tidally lock to the Sun", () => {
  assert.ok(tidalLockYears(1, 1, 1, 1) > 1e10);
});

test("spectral class from type string or temperature", () => {
  assert.equal(spectralClass({ st_spt: "K2 V" }), "K");
  assert.equal(spectralClass({ st_spt: "", st_teff: 3192 }), "M");
  assert.equal(spectralClass({ st_teff: 5772 }), "G");
});
