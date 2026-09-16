# Wildfire analysis workspace

Production website source, initially ported from the `demo/` design. Changes here
do not modify or import the demo. React / TypeScript / Vite build a static page
into `docs/` for GitHub Pages.

See the [root README](../README.md) for the service architecture, local backend
setup, warehouse prerequisites and historical model limitations.

## Frontend architecture

| Module | Responsibility |
|---|---|
| `src/App.tsx`, `src/state.tsx` | Workspace composition, independent panel settings and browser persistence |
| `src/panelViews.ts`, `src/PanelPicker.tsx` | Five categories and 13 implemented analysis presets |
| `src/PanelWorkspace.tsx`, `src/Controls.tsx` | Panel layout, expansion, filters and common controls |
| `src/api.ts`, `src/useRemote.ts` | Remote records, pagination, request state and streamed Ask responses |
| `src/agentContracts.ts`, `src/answerPanels.ts` | Agent wire contracts and the currently supported view adapters |
| `src/agentTrace.ts`, `src/ToolTrace.tsx` | Streamed and final service/tool activity in a collapsed disclosure |
| `src/EventMap.tsx`, `src/MapEventPreview.tsx`, `src/spatial.ts` | Leaflet maps, event bubbles and location lookups |
| `src/HdwPlayer.tsx`, `src/weather.ts` | Yearly static weather cubes and daily playback |
| `src/AnalysisCharts.tsx`, `src/YearComparison.tsx`, `src/RegionalSeries.tsx`, `src/SeasonalSeries.tsx` | Grouped and temporal visualizations |
| `src/data.ts`, `src/stats.ts`, `src/annual.ts`, `src/temporal.ts` | Record normalization, counts and time aggregation |
| `src/RecordPanels.tsx` | Record tables and summary metrics |
| `src/ExportActions.tsx`, `src/exports.ts` | CSV and chart PNG exports |

Maps and records use the Visualization API. Grouped comparisons, summary metrics
and regional time series use the Data Query API; those panels never page full
GeoJSON to compute their totals. Calendar alignment and seasonal profiles retain
the existing daily time-series API. The browser does not call the Comparison API
directly. Ask uses Agent and its downstream services.

## Development

Use Node 24 (the tests use Node's built-in TypeScript support). From the
repository root:

```sh
cd website
npm ci
npm run dev
```

Development URL: `http://127.0.0.1:8771/`.

```sh
npm test
npm run build
```

The build runs TypeScript checking, uses a disposable OS-temp build directory,
then replaces `docs/index.html` and `docs/assets/workspace/`. It cleans its
temporary directory on success or failure. Other `docs/` assets are preserved.
Preview the actual generated page using the command in the
[Pages guide](../docs/README.md).

The deployed API defaults remain in `src/api.ts`. To use local services, copy
`website/.env.example` to `website/.env.local`, or set `VITE_VISUALIZATION_URL`,
`VITE_AGENT_URL` and `VITE_DATA_QUERY_URL` in the build environment. Restart the development server or
rebuild after changing them. These are public browser URLs; do not put secrets
in `VITE_` variables. The repository-root `.env` configures Python services.
Ordinary website preview does not require a local database or model runtime.

Deploy the Data Query aggregate endpoints before publishing this frontend.
`VITE_DATA_QUERY_URL` defaults to the CloudFront host's `/api/data-query` prefix;
the proxy must forward query strings and route to the service's unprefixed paths.
The public Data Query OpenAPI URL and `/summary` were still returning 404 on September 16, 2026.
Local SQL and browser verification does not establish that the production route
has been deployed. API failures remain visible and do not trigger client-side
counting as a fallback.

## Connected panels

Add panel groups ready-to-use views under the five panel categories. Selecting
a view creates the configured panel immediately. Map offers wildfire events,
EPSS outage circuits, PSPS areas and HDW playback; Time series offers event trends,
year comparison, regional trends and seasonal profiles; Comparison offers county,
utility and cause views. Records and summary metrics each have one entry.
Only implemented views appear.

Use the header's Change view action to switch within a panel category. It retains
the panel's position, custom name, date/geographic filters and expansion state.
Automatic names track the current view. Unavailable filter combinations remain
explicit rather than silently changing the selected region or utility. The view
catalog is in `src/panelViews.ts`; future analyses can join their existing category.
Trend modes and comparison grouping are selected here instead of separate controls
in the chart body. Existing saved panels continue to load without a migration.

- **Map:** CPUC clusters, CAL FIRE acreage bubbles, PG&E EPSS circuit lines,
  PSPS polygons, and national ignition sample points; optional HFTD and IOU
  boundaries, with an always-visible legend for the active symbols and scales.
  Hover or keyboard-focus an individual event for a compact location bubble;
  click/tap to keep it open, then View details. Pointer exit dismisses transient
  previews; outside clicks and Escape close them. Clusters still zoom into
  their members. Event data and the basemap
  are fetched separately; a basemap failure does not hide event geometry.
- **Time series:** separate CPUC, EPSS and CAL FIRE counts. All intervals are
  calculated from full daily API buckets. Weeks start January 1 and are clipped
  at year/range boundaries, matching the existing site's week convention.
- **By year:** choose one dataset and up to five years. Daily curves align by
  month/day (including Feb 29 only when it exists); monthly/quarterly/week bins
  align by period. Source endpoint years are clipped to the recorded date range,
  marked with `*`, and never extended with future zeros. These endpoints are
  recorded event dates, not a guarantee of complete collection coverage.
- **Regional trends:** monthly, weekly, daily or quarterly EPSS outage counts
  grouped by PG&E `division`, with a shared vertical scale. The overview fits the
  highest-total divisions to the frame; View all expands every division. Missing
  division names remain a Not recorded group. CSV and PNG include every division,
  including those outside the overview. These are raw counts, not normalized rates.
- **Seasonal profile:** select one to five completed calendar years in Filters,
  inside the source's recorded date range. The mean uses 52 seven-day blocks from January 1,
  matching the existing January-1-based weekly convention. Leap days remain in
  their year's day-of-year sequence; trailing one or two days are excluded rather
  than mixed into a shorter final week. A year contributes to a week only when
  all seven daily buckets are present. Actual zero counts count toward the mean;
  missing days do not become zeros. Inspect a week for its contributing-year
  count. One selected year shows its weekly counts as a solid line; multiple
  years show individual dashed lines and a thicker solid mean. Their shared
  vertical scale includes the individual-year peaks; inspection shows both the
  mean and yearly values, and PNG exports retain these line styles.
  The collapsed Filters summary shows only the number of years. CSV includes
  the per-year counts and mean. Default years use the latest five eligible years,
  based on global source dates rather than filtered events.
  API-filled zero buckets describe recorded events, not audited collection
  completeness. CAL FIRE posting changes still limit across-year interpretation.
- **Comparison:** count/share by cause, utility or county. CPUC/CAL FIRE have
  no cause field. EPSS is PG&E-only, with explicit null bars for other utilities.
  Unknown and missing causes are separate categories.
- **Record table:** complete filtered records, local search, overview pages sized
  to the available height, 25-row pages in expanded view, and remote detail.
  Circuit IDs retain leading zeros. The existing detail dialog includes expandable
  EPSS outage records for circuits and affected-circuit records for PSPS events.
  An empty related-record list is distinct from a missing collection (`No data`).
- **Stat card:** record counts and known counties; CAL FIRE acreage; PSPS
  customer-event totals. Missing values are reported, not converted into zeros.
- **Event location bubble:** coordinates, point-in-polygon against remote
  IOU/HFTD geometry, event-record county, and the saved 824-cell grid. Non-point
  geometry identifies the hovered/clicked map position, not an outage's origin.
  Boundary data loads on demand; failed lookups remain unavailable with Retry.
  This replaces the separate Spatial context panel and picker entry. Existing
  saved workspaces drop that retired panel while retaining other panels and filters.

The initial scope is 2024. Date inputs are not limited to that year. Recorded
date ranges come from full-dataset daily aggregates, not a page of records.
The warehouse does not expose authoritative ingestion/scrape timestamps.

Requests have timeouts; stale panel responses are ignored. Concurrent identical
GETs share a five-minute in-memory cache, capped at 32 request entries. Retry
clears it. Incomplete/inconsistent pagination fails instead of reporting a
partial total. Runtime API failures do not fall back to synthetic data.

Ask uses the deployed SSE endpoint and preserves the answer's qualifications.
It can append the supported harness-planned views; it does not execute render
instructions from model prose. A four-minute timeout or Cancel leaves the data
panels usable. Generated scalar answers are not saved across page refreshes.
Multiple-dataset map specs and advanced comparison/spatial specs are not yet
ported; their answer text remains available.

`src/agentContracts.ts` defines all six existing `ComponentSpec` types, including
their parameters, evidence IDs and artifact references. The complete answer,
including views, scope, qualifications and trace metadata, stays attached to the
conversation message in memory for later agent integration. Extend
`src/answerPanels.ts` when adding the remaining renderers; contract support alone
does not imply that those views already render. Conversation payloads are not
saved in browser storage.

Each answer has a default-collapsed **Tool chain** when routing or tool activity
is available. It shows services, tool names, executed arguments, status, timing
and evidence references. Activity is available while streaming and remains after
failure or cancellation. The final trajectory includes qualification calls and
replaces the streamed trace so completed calls are not duplicated.

Seasonal inspection uses `No data` for incomplete weeks and missing yearly
values; observed zeros remain `0`. Detail fields retain a literal source
`Unknown` value and show `No data` for nulls.

## HDW playback and exports

Check **HDW** in the map's bottom layer row. The player uses the supplied
2020–2025 JSON cubes, loaded one year at a time. Available playback years/days
are intersected with the map's date filters. Play/Pause, speed and a day slider
control the surface; playback stops at the last available day and pauses when
the document becomes hidden. Map zoom and pan remain stable between frames.
Event overlays show **starts on the displayed day**, including outage starts
aggregated onto EPSS circuit lines. They do not represent all active incidents.

HDW is decoded using the supplied metadata (`value × 2`, hPa·m/s), on the
824-cell grid. It is a surface daily approximation, not an operational
lowest-500-m HDWI product or an ignition-risk forecast. Missing cells remain
transparent. December 2–31, 2020 is excluded pending independent verification
after the documented source-weather corruption. Source JSON files are unchanged.

The header download menu exports full filtered records or all chart categories,
including rows not currently visible in overview. CSV preserves nulls, identifiers
and UTF-8 text and neutralizes formula-leading strings; import circuit ID columns
as text in spreadsheet applications to retain leading zeros. Line/bar charts can
download PNG with titles, scope and legends. Maps export event CSV, not basemap
images or raw HDW cubes. Duplicate copies a panel's filters, layer settings and
year choices into independent state.

CPUC and CAL FIRE CSV exports prepend quoted `# Note:` rows with the dataset
definitions from `shared/dataset_caveats.json`, also used by Agent qualifications.
Readers importing these CSVs should skip those note rows before the column header.
Missing values remain empty fields, distinct from numeric zero.

Stat cards show all supported summary metrics together under one dataset and
filter scope: CPUC events/counties/utilities, CAL FIRE events/acres/counties,
EPSS outages/circuits/counties, and PSPS events/customer-event totals/utilities.
The national sample exposes its record count only. County counts split CAL FIRE's
comma-separated multi-county records before deduplication; circuits and utilities
are also distinct counts. Missing fields stay unavailable or are marked beside
partial totals. Stat CSV downloads include every displayed metric and its unit.

Panel settings use `wildfire-workspace-v1` in browser local storage. Storage
failure is visible; no chat text, credentials, or fetched datasets are saved.

## Scrolling and expanded views

Overview panels remain 520px high and pass vertical scrolling to the page.
Filters open in a separate dialog, preserving the chart area. Comparison shows
as many ranked rows as fit, with an explicit View all button for the remainder;
table page sizes adapt to the rendered row/header heights and available space.

Each panel can expand into a modal workspace. Its top-right × or Escape returns to the
overview with the same component, selected filters and table position. The page
behind an expanded panel is inert and scroll-locked. Nested filters/details
close independently. Expanded charts and tables can scroll internally; expanded
maps support wheel zoom. Maps keep their instance, center and zoom when resized.
On coarse-pointer devices, overview touch gestures are reserved for page
scrolling; expand the map to pan and pinch-zoom.

## Validation

Run `npm test` and `npm run build` from this directory. The Node suite covers
pagination consistency, event counting, missing values, SSE parsing, spatial
lookups, weather decoding, annual alignment, regional API contracts, seasonal aggregation,
view switching and exports. These tests use local fixtures or mocked requests;
they do not require the live APIs. The build also checks TypeScript.

The September 13, 2026 implementation verification passed 28 Node tests and the
build. Separate live-data and rendered-browser checks included:

- PG&E CPUC 2024: 532 attribute-tagged records; statewide CPUC 2024: 741.
  EPSS: 2,787 outages. CAL FIRE: 611 incidents and 1,025,720 known acres,
  with two records missing acreage. These are verification snapshots, not
  constants to hardcode into the UI.
- Regional EPSS: 18 divisions, 216 exported monthly rows and a total of 2,787
  outages. Exported PNGs were opened to check all divisions were included.
- Seasonal CPUC 2020–2024: week 27 counts of 20, 17, 22, 23 and 31 produce
  a mean of 22.6, checked against source records. Single-year rendering,
  dashed annual lines, solid means and exported images were inspected.
- Desktop and 390px layouts, independent panel settings, page scrolling,
  expanded views, nested dialogs, event bubbles and map resize persistence.
  CSV downloads and chart PNGs were inspected separately from unit tests.
- A live browser Ask for PG&E 2024 returned 532, included the 536 spatial-count
  qualification and appended grounded map and metric panels. This exercised
  the SSE endpoint rather than a mocked answer or direct render call.

Physical touchscreen gestures still need device testing. These checks do not
validate the entire 30-item roadmap or the scientific validity of model outputs.
Model surfaces, residual maps and other analyses awaiting inputs are not implied
by the implemented panel catalog.
