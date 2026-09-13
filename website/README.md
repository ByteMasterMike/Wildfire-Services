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

- **Map:** CPUC clusters, CAL FIRE acreage bubbles, PG&E EPSS circuit lines,
  PSPS polygons, and national ignition sample points; optional HFTD and IOU
  boundaries. Click an event, then View details. Event data and the basemap
  are fetched separately; a basemap failure does not hide event geometry.
- **Time series:** separate CPUC, EPSS and CAL FIRE counts. All intervals are
  calculated from full daily API buckets. Weeks start January 1 and are clipped
  at year/range boundaries, matching the existing site's week convention.
- **Comparison:** count/share by cause, utility or county. CPUC/CAL FIRE have
  no cause field. EPSS is PG&E-only, with explicit null bars for other utilities.
  Unknown and missing causes are separate categories.
- **Record table:** complete filtered records, local search, 25-row display pages
  and remote detail. Circuit IDs retain leading zeros.
- **Stat card:** record counts and known counties; CAL FIRE acreage; PSPS
  customer-event totals. Missing values are reported, not converted into zeros.
- **Spatial context:** selected event/position, point-in-polygon against remote
  IOU/HFTD geometry, event-record county, and the saved 824-cell grid. It does
  not infer outage coordinates from circuit midpoints or invent county values.

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

Panel settings use `wildfire-workspace-v1` in browser local storage. Storage
failure is visible; no chat text, credentials, or fetched datasets are saved.

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

Backend models and services, `demo/`, and `frontend/` are outside this change.
This verifies a website migration with the existing public data API, not the
entire 30-item feature roadmap or the scientific validity of new model outputs.
