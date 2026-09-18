import type { DatasetId, Filters, LayerResponse } from "./data.ts"

export interface WeatherGrid {
  meta: {
    spacing: number
    units: string
    source_short: string
    source_long: string
    encoding: { scale: number }
    bands: {
      name: string
      min_hdw: number
      max_hdw: number | null
      color: string
    }[]
  }
  cells: { id: number; lat: number; lon: number }[]
}
export interface WeatherYear {
  year: number
  dates: string[]
  values: (number | null)[][]
}
export function validateWeatherYear(
  input: WeatherYear,
  year: number,
  cells: number,
): WeatherYear {
  if (
    input.year !== year ||
    input.dates.length !== input.values.length ||
    !input.dates.length
  )
    throw new Error("Weather file year or dimensions do not match.")
  for (let i = 0; i < input.dates.length; i++) {
    const date = input.dates[i]
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number(date.slice(0, 4)) !== year ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      (i > 0 && date <= input.dates[i - 1])
    )
      throw new Error("Weather dates are invalid or out of order.")
    if (
      input.values[i].length !== cells ||
      input.values[i].some(
        (v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 255),
      )
    )
      throw new Error("Weather grid values are invalid.")
  }
  return input
}
export function weatherFrames(data: WeatherYear, filters: Filters) {
  return data.dates.flatMap((date, index) =>
    date >= filters.start &&
    date <= filters.end &&
    !(date >= "2020-12-02" && date <= "2020-12-31")
      ? [{ date, values: data.values[index] }]
      : [],
  )
}
export function weatherColor(
  value: number | null,
  grid: WeatherGrid,
): string | null {
  if (value === null) return null
  const hdw = value * grid.meta.encoding.scale
  return (
    grid.meta.bands.find(
      (b) => hdw >= b.min_hdw && (b.max_hdw === null || hdw < b.max_hdw),
    )?.color ?? null
  )
}
export function featuresOnDate(
  features: LayerResponse["geojson"]["features"],
  dataset: DatasetId,
  date: string,
): LayerResponse["geojson"]["features"] {
  if (dataset === "epss")
    return features.flatMap((feature) => {
      const outages = feature.properties.outages
      if (!Array.isArray(outages))
        throw new Error("Daily EPSS display requires outage details.")
      const matches = outages.filter((row) => row.start_date === date)
      return matches.length
        ? [
            {
              ...feature,
              properties: {
                ...feature.properties,
                outages: matches,
                event_count: matches.length,
                first_event: date,
                last_event: date,
              },
            },
          ]
        : []
    })
  const field =
    dataset === "calfire"
      ? "date_only_created"
      : dataset === "psps"
        ? "deenergization_start_date"
        : "event_date"
  return features.filter((feature) => feature.properties[field] === date)
}
