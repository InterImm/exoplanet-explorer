# Handover

Short notes for whoever picks this up next (a person or a new Claude project). Started 2026-10-05.

## Why it exists

L (GitHub emptymalei) asked for an exoplanet explorer and analyser so they can study real planets and pick
which one sends the signal in the InterImm phase 2 story, *The Contact Era* (InterImm/interstellar,
interstellar.interimm.org). That choice is still open: Ross 128 b (11.0 ly) is the default in draft PR
InterImm/interstellar#4. The story's present is 2219 (real date + 70,491 days); contact is communication only.

## Constraints

- Static, in-browser, zero running cost. GitHub Pages from `main`, root. No server, no build step.
- The only scheduled work is the weekly data refresh Action, which commits `data/planets.json`.
- Look: InterImm phase 2 kit, "Deep Field". Copied into `vendor/kit/` because interstellar.interimm.org
  was not live yet; switch the stylesheet link to `https://interstellar.interimm.org/kit/interimm.css`
  once it is, and delete `vendor/kit/`.

## State

- Built in a Claude project thread; the code also sits in the project's shared folder at `exoplanet-explorer/`.
- The data in the first commit comes from the **Open Exoplanet Catalogue** (5,400 planets, entries up to 2023),
  because the build machine could not reach the NASA archive. Run the "Refresh planet data" Action once after
  the first push to switch to NASA pscomppars (about 6,000 confirmed planets, current).
- To do by a person: create the repo, enable Pages (Settings → Pages → Deploy from branch → main / root),
  run the refresh Action once, decide on a domain (the old docs at InterImm/exoplanets use
  exoplanets.interimm.org).

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
