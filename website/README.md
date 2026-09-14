# Wildfire analysis workspace

Production website source, initially ported from the `demo/` design. Changes here
do not modify or import the demo. React / TypeScript / Vite build a static page
into `docs/` for GitHub Pages.

## Development

Use Node 24 (the tests use Node's built-in TypeScript support).

```sh
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
Preview the actual generated page using the command in `docs/README.md`.

## Connected panels

Add panel groups ready-to-use views under the five panel categories. Selecting
a view creates the configured panel immediately. Map offers wildfire events,
EPSS outage circuits, PSPS areas and HDW playback; Time series offers event trends
and year comparison; Comparison offers county, utility and cause views. Records
and summary metrics each have one entry. Only implemented views appear.

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
- **Comparison:** count/share by cause, utility or county. CPUC/CAL FIRE have
  no cause field. EPSS is PG&E-only, with explicit null bars for other utilities.
  Unknown and missing causes are separate categories.
- **Record table:** complete filtered records, local search, overview pages sized
  to the available height, 25-row pages in expanded view, and remote detail.
  Circuit IDs retain leading zeros.
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
instructions from model prose. A 45-second timeout or Cancel leaves the data
panels usable. Generated scalar answers are not saved across page refreshes.
Multiple-dataset map specs and advanced comparison/spatial specs are not yet
ported; their answer text remains available.

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

Each panel can expand into a modal workspace. Restore or Escape returns to the
overview with the same component, selected filters and table position. The page
behind an expanded panel is inert and scroll-locked. Nested filters/details
close independently. Expanded charts and tables can scroll internally; expanded
maps support wheel zoom. Maps keep their instance, center and zoom when resized.
On coarse-pointer devices, overview touch gestures are reserved for page
scrolling; expand the map to pan and pinch-zoom.

## Verification, 2026-09-13

- Six focused Node tests cover complete pagination and changed pages, EPSS
  event-vs-circuit counting, cause/missing categories, date buckets, numeric
  missingness, and fragmented/premature SSE streams.
- Live production-client checks: PG&E CPUC 2024 = 532 in both records and daily
  series; EPSS = 2,787; CAL FIRE = 611 and 1,025,720 known acres (2 missing-acre
  records). All four time intervals conserve counts. EPSS Unknown = 1,057 of
  2,787 (37.9%); no percentage is hardcoded.
- Rendered desktop and 390px mobile screenshots were inspected for map, series,
  comparison, picker, details and spatial context. Checked independent repeated
  panels, Chinese naming, persistence and unavailable-cause/null-bar states.
- A real browser Ask for PG&E 2024 returned 532, included the 536 spatial-count
  qualification, and appended grounded map and metric panels. This was a live
  SSE request, not a direct render call or mocked reply.

Scroll/focus follow-up: rendered at 1280px and 390px widths. All six overview
bodies fit their frames. Wheel gestures over map, chart and record-table areas
moved the page; expanded table scrolling left the page fixed. Escape restored
focus/page position and closed nested filters/details one layer at a time. The
map retained zoom level 7 after returning from expanded view. Phone-width
layout was inspected; physical touchscreen gestures still need device testing.

Map/year/export follow-up: 11 tests pass, including all supplied weather dates
and grid dimensions, threshold decoding, excluded dates, daily outage filtering,
leap-year alignment, clipped year endpoints, CSV escaping and missing-value SVG
rendering. The UI showed CPUC 2023/2024 totals of 480/741, and CAL FIRE 2026 ended
at August 16 with a partial-year marker. HDW playback advanced dates and was
paused successfully. Actual CSV download contained 741 unique records; exported
comparison and yearly PNG files were opened and visually inspected. Repeated
panels retained independent dataset selections. Desktop and 390px layouts were
inspected without page overflow. No new agent behavior was added in this slice.

Backend models and services, `demo/`, and `frontend/` are outside this change.
This verifies a website migration with the existing public data API, not the
entire 30-item feature roadmap or the scientific validity of new model outputs.
