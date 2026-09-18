import { useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import gridJSON from "../../docs/assets/data/weather_anim/grid_cells.json"
import { getJSON } from "./api.ts"
import { useRemote } from "./useRemote"
import { usePanel } from "./state"
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
  const index = Math.max(
    0,
    frames.findIndex((frame) => frame.date === settings.weatherDate),
  )
  const frame = frames[index]
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const cells = useRef<L.Rectangle[]>([])
  useEffect(() => {
    if (frame && frame.date !== settings.weatherDate)
      update({ weatherDate: frame.date })
  }, [frame, settings.weatherDate, update])
  useEffect(() => {
    setPlaying(false)
  }, [year, filters.start, filters.end])
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener("visibilitychange", pause)
    return () => document.removeEventListener("visibilitychange", pause)
  }, [])
  useEffect(() => {
    if (!playing || !frame) return
    if (index >= frames.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(
      () => update({ weatherDate: frames[index + 1].date }),
      1000 / speed,
    )
    return () => clearTimeout(timer)
  }, [playing, frame, index, frames, speed, update])
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
    <div className="hdw-player" aria-label="HDW playback">
      <div className="hdw-controls">
        <span className="hdw-label">HDW</span>
        <select
          aria-label="Weather year"
          value={year ?? ""}
          disabled={!availableYears.length}
          onChange={(e) => {
            setPlaying(false)
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
        <button
          aria-label={playing ? "Pause weather" : "Play weather"}
          disabled={!frame}
          onClick={() => {
            if (index === frames.length - 1)
              update({ weatherDate: frames[0].date })
            setPlaying((p) => !p)
          }}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <output aria-label="Weather date">
          {frame?.date ?? (remote.loading ? "Loading…" : "Unavailable")}
        </output>
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {[1, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <details className="hdw-source">
          <summary aria-label="HDW source">ⓘ</summary>
          <p>
            {HDW_GRID.meta.source_long}
            {year === 2020 &&
              " December 2–31, 2020 is excluded pending verification after known source-weather corruption."}
          </p>
        </details>
      </div>
      <input
        aria-label="Weather day"
        type="range"
        min={0}
        max={Math.max(0, frames.length - 1)}
        value={index}
        disabled={!frame}
        onChange={(e) => {
          setPlaying(false)
          update({ weatherDate: frames[Number(e.target.value)].date })
        }}
      />
      {error && (
        <p className="hdw-error" role="status">
          {error}
          {remote.error && <button onClick={remote.retry}>Retry</button>}
        </p>
      )}
    </div>
  )
}
