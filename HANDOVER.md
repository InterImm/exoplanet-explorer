# Handover

Short notes for whoever picks this up next (a person or a new Claude project). Started 2026-10-05.

## Why it exists

L (GitHub emptymalei) asked for an exoplanet explorer and analyser so they can study real planets and pick
which one sends the signal in the InterImm phase 2 story, *The Contact Era* (InterImm/interstellar,
interstellar.interimm.org). That choice is still open: Ross 128 b (11.0 ly) is the default in draft PR
InterImm/interstellar#4. The story's present is 2219 (real date + 70,491 days); contact is communication only.

## Constraints

- Static, in-browser, zero running cost. GitHub Pages via Actions from `main`. No server, no build step.
- The only scheduled work is the weekly data refresh Action, which commits `data/planets.json`.
- Look: InterImm phase 2 kit, "Deep Field". Copied into `vendor/kit/` because interstellar.interimm.org
  was not live yet; switch the stylesheet link to `https://interstellar.interimm.org/kit/interimm.css`
  once it is, and delete `vendor/kit/`.

## State

- Repo InterImm/exoplanet-explorer created by L on 2026-10-05; code also mirrored in the Claude project's
  shared folder at `exoplanet-explorer/`. A private preview runs as a claude.ai artifact.
- Data: NASA Exoplanet Archive pscomppars via the "Refresh planet data" Action (first run 2026-10-05,
  6,375 planets), weekly on Mondays. `scripts/build_data.py --source oec` is the fallback.
- Live at https://interimm.org/exoplanet-explorer/ (Pages source: GitHub Actions, `.github/workflows/pages.yml`),
  redeployed on every push to main and after each data refresh.

## Related repos

- InterImm/exoplanets (2018): Chinese docs on detection, habitable zones, Fermi paradox; Mathematica
  visualisations; Benford's law on planet masses; an "immigration value" notebook. Ideas, not code, were reused.
- InterImm/nasa-exoplanet-archive (2020): a dataherb snapshot of the old NASA `exoplanets` table. Superseded
  by the Action here.

## Ideas not done yet

- Sky map in a proper projection with constellations, and the pulsars from interstellar's `/pulsars/`.
- Chinese interface (the kit supports `data-lang`).
- Uncertainties: the build drops the archive's error columns; adding them would allow error bars and
  a "how sure are we" score.
- A story view: given a chosen planet, its sky position, beacon timing and distance feed straight into
  the archive page of InterImm/interstellar.
