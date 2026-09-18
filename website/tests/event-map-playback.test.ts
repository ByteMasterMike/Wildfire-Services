import test from "node:test"
import assert from "node:assert/strict"
import type { LayerResponse } from "../src/data.ts"
import {
  calendarDays,
  clampPlaybackDate,
  emptyPlaybackDay,
  eventMapViewMode,
  visibleEventFeatures,
} from "../src/playback.ts"
import { effectiveFilters } from "../src/globalFilters.ts"
import type { PanelSettings } from "../src/state"

const settings = (
  patch: Partial<PanelSettings> = {},
): PanelSettings => ({
  dataset: "cpuc",
  filters: {
    start: "2020-01-01",
    end: "2025-12-31",
    county: "",
    utility: "",
  },
  interval: "monthly",
  groupBy: "cause",
  measure: "count",
  metric: "events",
  datasets: ["cpuc"],
  overlays: [],
  ...patch,
})

const feature = (
  properties: Record<string, unknown>,
  id = "1",
): LayerResponse["geojson"]["features"][number] => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [-122.5, 38] },
  properties,
})

test("full range stays the default map view until day-by-day is chosen", () => {
  assert.equal(eventMapViewMode(undefined), "range")
  assert.equal(eventMapViewMode("range"), "range")
  assert.equal(eventMapViewMode("daily"), "daily")
})

test("day-by-day keeps events on the scrubbed date and leaves other days empty", () => {
  const features = [
    feature({ event_date: "2024-07-01" }, "cpuc-1"),
    feature({ event_date: "2024-07-02" }, "cpuc-2"),
    feature({ date_only_created: "2024-07-01" }, "calfire-1"),
    feature(
      { deenergization_start_date: "2024-07-03", name: "PSPS A" },
      "psps-1",
    ),
  ]
  const all = visibleEventFeatures(features, "cpuc", "range", "2024-07-01")
  assert.equal(all.length, 4)
  assert.deepEqual(
    visibleEventFeatures(features, "cpuc", "daily", "2024-07-01").map(
      (item) => item.id,
    ),
    ["cpuc-1"],
  )
  assert.deepEqual(
    visibleEventFeatures(features, "calfire", "daily", "2024-07-01").map(
      (item) => item.id,
    ),
    ["calfire-1"],
  )
  assert.equal(
    visibleEventFeatures(features, "cpuc", "daily", "2024-07-03").length,
    0,
  )
  assert.deepEqual(
    visibleEventFeatures(features, "psps", "daily", "2024-07-03").map(
      (item) => item.id,
    ),
    ["psps-1"],
  )
  assert.equal(
    visibleEventFeatures(features, "psps", "daily", "2024-07-04").length,
    0,
  )
})

test("empty playback days are a quiet no-event state, not an error", () => {
  assert.equal(
    emptyPlaybackDay({
      view: "daily",
      loading: false,
      error: null,
      total: 12,
      shown: 0,
    }),
    true,
  )
  assert.equal(
    emptyPlaybackDay({
      view: "range",
      loading: false,
      error: null,
      total: 0,
      shown: 0,
    }),
    false,
  )
  assert.equal(
    emptyPlaybackDay({
      view: "daily",
      loading: true,
      error: null,
      total: 12,
      shown: 0,
    }),
    false,
  )
  assert.equal(
    emptyPlaybackDay({
      view: "daily",
      loading: false,
      error: "Unavailable",
      total: 12,
      shown: 0,
    }),
    false,
  )
  assert.equal(
    emptyPlaybackDay({
      view: "daily",
      loading: false,
      error: null,
      total: 12,
      shown: 3,
    }),
    false,
  )
})

test("playback scrubs the panel effective range, inherited or pinned", () => {
  const inherited = effectiveFilters("map", settings(), { year: 2024 })
  const inheritedDays = calendarDays(inherited.start, inherited.end)
  assert.equal(inheritedDays[0], "2024-01-01")
  assert.equal(inheritedDays.at(-1), "2024-12-31")
  assert.equal(inheritedDays.length, 366)
  assert.equal(clampPlaybackDate("2023-06-01", inheritedDays), "2024-01-01")
  assert.equal(clampPlaybackDate("2024-07-04", inheritedDays), "2024-07-04")

  const pinned = effectiveFilters(
    "map",
    settings({
      filterMode: "override",
      filters: {
        start: "2023-07-01",
        end: "2023-07-03",
        county: "Marin",
        utility: "",
      },
    }),
    { year: 2024 },
  )
  const pinnedDays = calendarDays(pinned.start, pinned.end)
  assert.deepEqual(pinnedDays, ["2023-07-01", "2023-07-02", "2023-07-03"])
  assert.equal(clampPlaybackDate("2024-07-01", pinnedDays), "2023-07-01")
  assert.equal(clampPlaybackDate("2023-07-02", pinnedDays), "2023-07-02")
  assert.equal(calendarDays("2024-03-02", "2024-03-01").length, 0)
})
