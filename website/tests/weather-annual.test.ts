import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  validateWeatherYear,
  weatherFrames,
  weatherColor,
  featuresOnDate,
  type WeatherGrid,
} from "../src/weather.ts"
import { annualPoints, annualPosition, yearRange } from "../src/annual.ts"
import { DEFAULT_FILTERS, type LayerResponse } from "../src/data.ts"

const grid: WeatherGrid = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/assets/data/weather_anim/grid_cells.json",
      import.meta.url,
    ),
    "utf8",
  ),
)
test("bundled HDW years match actual dates, dimensions, cell ordering and encoding", () => {
  assert.equal(grid.cells.length, 824)
  assert.equal(new Set(grid.cells.map((c) => c.id)).size, 824)
  assert.equal(grid.meta.encoding.scale, 2)
  for (let year = 2020; year <= 2025; year++) {
    const data = JSON.parse(
      readFileSync(
        new URL(
          `../../docs/assets/data/weather_anim/weather_anim_${year}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    )
    validateWeatherYear(data, year, grid.cells.length)
    assert.equal(data.dates[0], `${year}-01-01`)
    assert.equal(data.dates.at(-1), `${year}-12-31`)
    assert.equal(data.dates.length, year % 4 === 0 ? 366 : 365)
    const frames = weatherFrames(data, {
      ...DEFAULT_FILTERS,
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    })
    assert.equal(frames.length, year === 2020 ? 336 : data.dates.length)
    if (year === 2020) assert.equal(frames.at(-1)?.date, "2020-12-01")
  }
  assert.equal(weatherColor(38, grid), "#fee8c8")
  assert.equal(weatherColor(39, grid), "#fdbb84")
  assert.equal(weatherColor(75, grid), "#e34a33")
  assert.equal(weatherColor(135, grid), "#99000d")
  assert.equal(weatherColor(null, grid), null)
  assert.throws(
    () =>
      validateWeatherYear(
        { year: 2024, dates: ["2024-01-01"], values: [[0]] },
        2025,
        1,
      ),
    /year/,
  )
})
test("HDW event overlays use start dates and preserve daily EPSS counts without mutating cached features", () => {
  const features: LayerResponse["geojson"]["features"] = [
    {
      type: "Feature",
      id: "001",
      geometry: null,
      properties: {
        circuit_id: "001",
        event_count: 2,
        outages: [
          { id: 1, start_date: "2024-07-01" },
          { id: 2, start_date: "2024-07-02" },
        ],
      },
    },
  ]
  const daily = featuresOnDate(features, "epss", "2024-07-01")
  assert.equal(daily[0].properties.event_count, 1)
  assert.equal(features[0].properties.event_count, 2)
  assert.equal(featuresOnDate(features, "epss", "2024-07-03").length, 0)
  assert.equal(
    featuresOnDate(
      [
        {
          type: "Feature",
          geometry: null,
          properties: { date_only_created: "2024-07-02" },
        },
      ],
      "calfire",
      "2024-07-01",
    ).length,
    0,
  )
})
test("annual alignment keeps March fixed, leaves non-leap Feb 29 absent, and clips to actual recorded endpoints", () => {
  assert.equal(
    annualPosition("2023-03-01", "daily"),
    annualPosition("2024-03-01", "daily"),
  )
  const nonleap = annualPoints(
    [
      { start: "2023-02-28", end: "2023-02-28", count: 2 },
      { start: "2023-03-01", end: "2023-03-01", count: 3 },
    ],
    "daily",
  )
  assert.equal(
    nonleap.some((p) => p.x === annualPosition("2024-02-29", "daily")),
    false,
  )
  assert.equal(
    nonleap.reduce((s, p) => s + p.count, 0),
    5,
  )
  assert.deepEqual(
    yearRange(2026, { start: "2009-05-24", end: "2026-08-16" }),
    { start: "2026-01-01", end: "2026-08-16", partial: true },
  )
  assert.equal(
    yearRange(2027, { start: "2009-05-24", end: "2026-08-16" }),
    null,
  )
  assert.equal(annualPosition("2021-11-15", "monthly"), 10)
})
