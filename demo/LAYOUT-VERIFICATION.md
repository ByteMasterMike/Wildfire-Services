# Demo panel layout verification

Current layout (2026-09-12): all panel types have the same 520px height and equal
widths, using two desktop columns and one narrow-screen column. This supersedes
the type-specific sizes described below. Collapsible chart filters and the
full-body map remain. Overflow uses the shared thin internal scrollbar. The six
desktop frames were visually checked at 699 × 520px; Comparison overflow scrolled
inside its unchanged frame.

Verified on 2026-09-11 at `http://127.0.0.1:8443/` in Edge.
Scope: the standalone demo only. All panel content is synthetic; the map is
illustrative, and no production services or agent calls are involved.

## Desktop count matrix

The numbers below are panels per row. Each consecutive group contains at most
nine panels. Short final rows expand evenly across the available width.

| Panels | Observed rows | Rendered screenshot inspection |
| --- | --- | --- |
| 1 | 1 | Passed |
| 2 | 2 | Passed |
| 3 | 3 | Passed |
| 4 | 2 + 2 | Passed |
| 5 | 3 + 2 | Passed |
| 6 | 3 + 3 | Passed |
| 7 | 3 + 3 + 1 | Passed |
| 8 | 3 + 3 + 2 | Passed |
| 9 | 3 + 3 + 3 | Passed |
| 10 | 3 + 3 + 3; 1 | Passed |
| 18 | 3 + 3 + 3; 3 + 3 + 3 | Passed |
| 19 | 3 + 3 + 3; 3 + 3 + 3; 1 | Passed |

Added mixed panel types one at a time through the picker, then used its quantity
controls to add duplicate maps. Inspected viewport screenshots while scrolling
through the layouts. DOM geometry checks additionally confirmed panel counts,
non-overlap and no page-level horizontal overflow for counts 2–10, 18 and 19.
The single-panel case also passed count and overflow checks in the chat flow.
This is sampled visual verification, not an exhaustive test of every ordering.

## Responsive and interaction checks

- At 900 × 900: six panels use two columns; screenshot inspected; no page overflow.
- At 390 × 844: six panels use one column; map, chart, table and picker screenshots
  inspected; no page overflow. Wide tables scroll inside their own panel.
- Icon navigation scrolls to the matching numbered panel and highlights it.
- Duplicate maps have independent state: Map 1 retained Canyon while other maps
  remained on Foothill.
- Closing a panel removes its shortcut and reflows the remaining panels.
- Deleting across nine-panel boundaries preserves surviving selections: quarterly
  series, EPSS comparison, Sacramento record filter, acres metric and San Diego
  spatial context remained selected.
- EPSS missing categories display hatched `No data` bars, not zeros.
- Closing the last panel returns to zero panels without orphan shortcuts.
- Chat submission and delayed demo reply still work with panels; the picker works
  in chat mode. Escape dismisses the picker without adding panels.
- Temporary viewport overrides were reset after testing.

## Build and limits

`tsc --noEmit` and `vite build` passed. Temporary build output was deleted.
No new dependencies were added. Browser test selections are in memory only;
refreshing resets the workspace. No persistence, real geography/data integration,
or drag-and-drop rearrangement is included in this slice.

## Chat and picker refinement

Verified the follow-up layout changes in Edge using rendered screenshots:

- After the first question, the chat occupies one viewport. The composer and
  panel shortcuts remain together at its bottom; the workspace starts below it.
- Three exchanges overflow the chat region and automatically scroll the latest
  reply into view. The chat scrollbar is a subtle 4px track without arrow buttons.
- The return control is an arrow-only circular button at the viewport's bottom
  center. It appears when the workspace is visible. Its target was subsequently
  changed to the top of the page (`#workspace-top`).
- Clicking a picker card's description selects it. Space toggles the focused
  card; the separate quantity buttons adjust counts without toggling selection.
- Mobile width 390px has no page-level horizontal overflow.

## Panel names and visible shortcuts

- Single-click and double-click on a panel title both open its inline name editor.
- Enter and clicking elsewhere save; Escape cancels. Blank names retain the
  previous title. Chinese names update both the panel heading and shortcut label.
- Renaming one of two maps preserves its event selection and does not alter the
  other map. Shortcut navigation still focuses the original panel ID.
- A long title is truncated visually without causing page overflow.
- With six maps at 390 × 844, the shortcuts wrap below the composer and remain
  visible (bottom 824px); the workspace begins below the viewport (top 884px).
  The rendered desktop and mobile layouts were inspected. Names, like the other
  demo state, reset on page refresh.

## Dataset controls and cause breakdown (2026-09-12)

The Time series and Comparison panels now use shared synthetic chart records
(2023–2024), separate from the map's six illustrative records. No SQL connection
was added. Local health probes for ports 8000, 8002 and 8003 did not connect;
Vite was restarted on 8443 for the demo.

- Node assertions passed for the 2024 sample totals (CPUC 191, EPSS 321,
  CAL FIRE 257), conservation of totals across daily/weekly/monthly/quarterly
  buckets, zero-event buckets, clipped weeks, leap day and a year boundary.
- Cause buckets sum to the selected record count; Unknown and Not recorded remain
  distinct. The demo Unknown percentage is calculated, not fixed at 41%.
- Invalid or incomplete date ranges are rejected by the filter validation helper.
- In Edge, exercised dataset toggles including all-off, native date keyboard
  changes, county/utility filters, count/share switching and all three groupings.
  Date-input automation via `fill` did not update the native control; keyboard
  interaction did update its value and the plotted counts.
- Selecting CPUC with Cause shows field unavailability. Selecting EPSS with SCE
  shows data unavailability. Utility bars retain hatched placeholders for SCE and
  SDG&E. Neither case is represented as a zero count or an Unknown cause.
- Two Time series instances retained independent selections. The default new
  instance displayed all three datasets while the first had all datasets off.
- Inspected rendered desktop two/three-column and 390px single-column layouts.
  No page-level horizontal overflow or browser console errors were observed.

Coverage: chart data calculations and demo interactions only; no live SQL query,
cause-source validation, production agent call or map-chart synchronization.

## Visible copy and date bounds (2026-09-12)

At the user's request, removed Demo/Synthetic/fictional/illustrative labels and
the synthetic-record chart footers from the rendered interface. The underlying
records and replies remain fixtures, as described in this document and source.
Meaningful unavailable-data and cause-category messages are retained.

Date inputs and defaults now use the earliest/latest dates in the full chart
record collection via `getDateRange`, not literal 2023/2024 constraints. This
currently spans 2023-01-01 to 2024-12-31. Node assertions verified extension to
2018/2027 with additional records, single-day and empty collections, dynamic
range validation, and count conservation at all supported intervals. The browser
confirmed the computed min/max/default bindings, absence of the removed copy,
and rendered chart/panel layout.

Future SQL integration must provide full-dataset MIN/MAX date metadata. A page of
records does not establish full dataset coverage. No SQL integration was done in
this change.

## Fixed panel frames (2026-09-12)

All panel frames now have a fixed 480px height, including a 52px header. Width
still follows the existing count-based grid and responsive breakpoints; neither
dimension depends on the rendered content. Overflow scrolls inside the body,
with the same 4px, arrow-free scrollbar rules as chat. Headers remain outside
the scroll area, and scrollable bodies support keyboard focus.

Browser checks and rendered screenshot inspection confirmed six mixed panel
types at the same 460 × 480 desktop size. Time series and Comparison overflowed
inside their bodies; scrolling to the end left the header in place. Changing
Comparison from a full cause chart to an unavailable-field message kept the
frame dimensions unchanged. Ten panels retained 480px height and rows 3+3+3+1.
At 390px viewport width, heights remained 480px and page-level horizontal
overflow was absent. Temporary viewport overrides were restored.

## Content-first panel sizing (2026-09-12)

This replaces the preceding uniform-480px/count-based sizing policy. Panel width
now follows its type and stays stable when another panel is appended. Desktop
Map, Time series, Comparison and Record table use half the workspace width;
Stat card uses one third and Spatial context two thirds. Ordering is still the
user's insertion order, with continuous rows rather than nine-item repacking.

Heights are type presets: Map/Time series 520px, Comparison 600px (660px on
mobile), Record table 480px, Stat card 240px, Spatial context 260px. Map fills its
body without stretching the SVG geography or leaving a dark unused body area.
Chart filters use a collapsed disclosure with the current scope visible in its
summary. Dataset toggles and chart mode controls remain directly accessible.
Internal scrolling remains the fallback when expanded controls or long results
exceed the available height.

Rendered desktop and 390px mobile screenshots were inspected. All six default
panel types had body scrollHeight equal to clientHeight (no internal scrolling),
including the complete time-series axes/readout and seven cause bars. Expanding
Comparison filters exceeded its body and correctly enabled internal scrolling;
collapsing them restored the full chart. County filtering still worked and its
scope remained in the collapsed summary. Appending a seventh panel preserved
the first six panels' widths and heights. Mobile had no page-level horizontal
overflow, and the viewport override was restored after verification.
