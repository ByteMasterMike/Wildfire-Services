# Website / GitHub Pages

`docs/index.html` and `docs/assets/workspace/` are the built website, generated
from [`website/`](../website/README.md). The interface follows the independent
`demo/` design: a conversation area and 13 analysis views in five panel categories.
The website uses real remote records; `demo/` remains a separate design prototype.

Start with the [root README](../README.md) for architecture, usage and local
backend setup. This directory contains the static publication output; edit
`website/src/` to change the application.

## Preview and build

From the repository root:

```sh
python -B -m http.server 8770 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:8770/`. Preview needs Python and network access to the
deployed APIs, but no local warehouse or npm install. To rebuild, use Node 24:

```sh
cd website
npm ci
npm test
npm run build
```

Commit the source and the generated `docs/index.html` / `docs/assets/workspace/`
files together. Relative bundle URLs support a GitHub Pages repository subpath.
Keep `.nojekyll`. Builds replace only the generated workspace bundle directory;
the other assets, including the existing HDW files, are retained.

## Data and behavior

- `website/src/api.ts` configures the remote visualization and agent URLs.
- Map layers, event detail, and daily time-series buckets come from the deployed
  visualization service. The browser collects every filtered page before
  calculating record-based statistics or comparisons. EPSS circuit features are
  expanded into their outage records for event counts.
- Each panel has independent filters. Names, order and settings persist in the
  browser; conversation text and selected-event context do not.
- Add panel groups the available views under Map, Time series, Comparison,
  Record table and Stat card. Change view switches analyses within a category.
- Overview panels scroll with the page. The expand button opens a focused modal
  view; its X or Escape restores the same panel. Filters use a dialog, and record-table
  pagination fits the overview height so its controls remain visible.
- Ask uses `POST /ask/stream`, without waiting for agent health or starting a GPU.
  Supported grounded map, series, record and metric views append panels. Other
  view contracts remain in the answer rather than becoming approximate charts.
- Source metadata reports the first/last recorded event dates, not scrape times.
  The source panel and website guide document data limitations; unavailable
  values are not converted into zeros.
- HDW playback uses the supplied static cubes; event overlays follow the shown
  day by start date. The legend explains event symbols, acreage, HFTD and HDW.
- Time series can compare years with marked partial endpoints. Header actions
  export filtered CSV / chart PNG and duplicate panel settings independently.
- Regional trends compare EPSS counts by PG&E division on a shared scale;
  expanded views and exports include all divisions. Seasonal profile selects
  years inside Filters: one year is a solid weekly line; multiple years use
  dashed individual lines and a thicker solid mean. Closed filters show only
  the number of selected years.
- This slice does not introduce model risk surfaces, raw weather/vegetation
  querying, national census counts, or full network topology.

The former static page scripts and canvas documentation are historical context;
the new entrypoint does not load them. The local Planning Tool remains under
`frontend/`, served with `python frontend/serve.py`, and is unchanged here.
