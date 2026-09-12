# Demo panel layout verification

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
