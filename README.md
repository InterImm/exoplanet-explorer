# Exoplanet Explorer

Explore and analyse every known exoplanet in the browser. Filter the catalogue, plot any two quantities,
rank planets by habitability with your own weights, and compare a shortlist side by side with Earth.

Static site, no server, no build step: GitHub Pages serves the files and a weekly GitHub Action refreshes the
data from the NASA Exoplanet Archive. Part of InterImm; it is the tool used to choose which real planet
sends the signal in the Contact Era story (see [HANDOVER.md](HANDOVER.md)).

## What it does

- **Filters**: name or host star, distance, radius, mass, insolation, star temperature, habitable zone,
  measured-only values, discovery method, status. Presets for nearby, potentially habitable and the signal shortlist.
- **Plot**: any field against any other, linear or log, coloured by habitable zone, discovery method, Earth
  Similarity or star temperature. The insolation vs star temperature view draws the Kopparapu habitable zone.
  Hover for values, click for details, drag to zoom, double-click to reset. Solar System planets for reference.
- **Table**: sortable; estimates are marked with ~ and minimum masses with *min*.
- **Rank**: weighted score from Earth similarity, closeness, position in the habitable zone, star type and data quality.
- **Shortlist**: star planets, compare them with Earth, download CSV or copy a Markdown table.
- **Details**: every catalogue value plus derived density, gravity, escape velocity, tidal-locking time,
  habitable-zone limits, and contact readouts (light time, and in the story's calendar when a signal heard
  in 2219 left and when a reply would land).
- Every view is in the URL, so a link reproduces it.

## Data

`data/planets.json` is built by `scripts/build_data.py` (standard library Python):

```sh
python3 scripts/build_data.py                  # NASA Exoplanet Archive, pscomppars table (default)
python3 scripts/build_data.py --source oec     # Open Exoplanet Catalogue, the fallback
```

`.github/workflows/refresh-data.yml` runs the NASA build every Monday and commits the file if it changed;
run it by hand from the Actions tab after the first push.

Derived values, all in `app/physics.js` and tested in `tests/physics.test.mjs`:

| Value | Method |
| --- | --- |
| Radius ↔ mass when one is missing | Chen & Kipping (2017) mean relation |
| Semi-major axis when missing | Kepler's third law from period and star mass |
| Insolation when missing | L / a², with L from the catalogue or R²T⁴ |
| Equilibrium temperature when missing | 278.6 K × S^¼ (albedo 0) |
| Earth Similarity Index | radius and insolation form (PHL) |
| Habitable zone | Kopparapu et al. (2014); conservative = runaway to maximum greenhouse, optimistic = recent Venus to early Mars |
| Tidal-locking time | Gladman et al. (1996), Q = 100, k₂ = 0.3, 12 h initial day |

## Develop

```sh
python3 -m http.server     # then open http://localhost:8000
npm test                   # node --test, no dependencies
```

Files: `index.html`, `app/explorer.js` (state, filters, views), `app/plot.js` (canvas scatter),
`app/physics.js` (derived quantities), `app/fields.js` (field labels and formatting), `app/explorer.css`.
The look, header and footer come from the InterImm phase 2 kit (Deep Field), linked from
https://interstellar.interimm.org/kit/ (source: InterImm/interstellar, `kit/`). The kit is the shared design
language of every phase 2 site; `app/explorer.css` only holds what is the explorer's own.

## Credits

This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of
Technology, under contract with NASA under the Exoplanet Exploration Program. Fallback data: Open Exoplanet
Catalogue (Rein 2012). Fonts: Pixelify Sans, Instrument Sans, JetBrains Mono (SIL OFL). Code: MIT.
