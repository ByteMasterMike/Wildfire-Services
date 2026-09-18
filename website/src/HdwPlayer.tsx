import { useEffect, useMemo, useRef } from "react"
import L from "leaflet"
import gridJSON from "../../docs/assets/data/weather_anim/grid_cells.json"
import { getJSON } from "./api.ts"
import { useRemote } from "./useRemote"
import { usePanel } from "./state"
import { PlaybackControls } from "./PlaybackControls.tsx"
import { usePlayback } from "./playback.ts"
import {
  validateWeatherYear,
  weatherColor,
  weatherFrames,
  type WeatherGrid,
  type WeatherYear,
} from "./weather.ts"

export const HDW_GRID: WeatherGrid = gridJSON
const files = import.meta.glob(
  "../../docs/assets/data/weather_anim/weather_anim_*.json",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>
const assets = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [
    Number(path.match(/weather_anim_(\d{4})\.json$/)![1]),
    url,
  ]),
)
const years = Object.keys(assets).map(Number).sort()

export function HdwPlayer({ map }: { map: L.Map | null }) {
  const { settings, update } = usePanel()
  const { filters } = settings
  const availableYears = years.filter(
    (year) =>
      year >= Number(filters.start.slice(0, 4)) &&
      year <= Number(filters.end.slice(0, 4)),
  )
  const year = availableYears.includes(settings.weatherYear ?? 0)
    ? settings.weatherYear!
    : availableYears[0]
  const remote = useRemote(year ? `hdw:${year}` : null, async () =>
    validateWeatherYear(
      await getJSON<WeatherYear>(assets[year]),
      year,
      HDW_GRID.cells.length,
    ),
  )
  const frames = useMemo(
    () => (remote.data ? weatherFrames(remote.data, filters) : []),
    [remote.data, filters.start, filters.end],
  )
  const dates = useMemo(() => frames.map((frame) => frame.date), [frames])
  const playback = usePlayback(dates, settings.weatherDate, (date) =>
    update({ weatherDate: date }),
  )
  const frame = frames[playback.index]
  const cells = useRef<L.Rectangle[]>([])
  useEffect(() => {
    if (!map) return
    if (!map.getPane("hdw")) map.createPane("hdw").style.zIndex = "350"
    const group = L.layerGroup().addTo(map)
    const renderer = L.canvas({ pane: "hdw" })
    cells.current = HDW_GRID.cells.map((cell) =>
      L.rectangle(
        [
          [cell.lat, cell.lon],
          [cell.lat + HDW_GRID.meta.spacing, cell.lon + HDW_GRID.meta.spacing],
        ],
        {
          renderer,
          pane: "hdw",
          stroke: false,
          fillOpacity: 0,
          interactive: false,
        },
      ).addTo(group),
    )
    return () => {
      map.removeLayer(group)
      map.removeLayer(renderer)
      cells.current = []
    }
  }, [map])
  useEffect(() => {
    cells.current.forEach((cell, i) => {
      const color = frame ? weatherColor(frame.values[i], HDW_GRID) : null
      cell.setStyle({
        fillColor: color ?? "transparent",
        fillOpacity: color ? 0.62 : 0,
      })
    })
  }, [map, frame])
  const error = !availableYears.length
    ? "No HDW in this date range. Choose dates within 2020–2025."
    : remote.error ||
      (!remote.loading && !frames.length
        ? "No verified HDW days in this range."
        : null)
  return (
    <PlaybackControls
      label="HDW playback"
      dates={dates}
      current={playback.current}
      index={playback.index}
      playing={playback.playing}
      speed={playback.speed}
      dateLabel="Weather date"
      playLabel="Play weather"
      pauseLabel="Pause weather"
      speedLabel="Playback speed"
      scrubberLabel="Weather day"
      dateOutput={
        frame?.date ?? (remote.loading ? "Loading…" : "Unavailable")
      }
      onTogglePlay={() => {
        if (playback.index === dates.length - 1)
          update({ weatherDate: dates[0] })
        playback.setPlaying((playing) => !playing)
      }}
      onSpeed={playback.setSpeed}
      onScrub={(date) => {
        playback.setPlaying(false)
        update({ weatherDate: date })
      }}
      leading={
        <>
          <span className="hdw-label">HDW</span>
          <select
            aria-label="Weather year"
            value={year ?? ""}
            disabled={!availableYears.length}
            onChange={(e) => {
              playback.setPlaying(false)
              update({
                weatherYear: Number(e.target.value),
                weatherDate: undefined,
              })
            }}
          >
            {availableYears.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </>
      }
      trailing={
        <details className="hdw-source">
          <summary aria-label="HDW source">ⓘ</summary>
          <p>
            {HDW_GRID.meta.source_long}
            {year === 2020 &&
              " December 2–31, 2020 is excluded pending verification after known source-weather corruption."}
          </p>
        </details>
      }
      error={
        error && (
          <p className="hdw-error" role="status">
            {error}
            {remote.error && <button onClick={remote.retry}>Retry</button>}
          </p>
        )
      }
    />
  )
}
