import { useEffect, useRef, useState } from "react"
import type { DatasetId, LayerResponse } from "./data.ts"
import { featuresOnDate } from "./weather.ts"

export type EventMapView = "range" | "daily"

export function eventMapViewMode(mapView?: EventMapView): EventMapView {
  return mapView === "daily" ? "daily" : "range"
}

export function calendarDays(start: string, end: string): string[] {
  const days: string[] = []
  const first = Date.parse(start)
  const last = Date.parse(end)
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last)
    return days
  for (let time = first; time <= last; time += 86_400_000) {
    days.push(new Date(time).toISOString().slice(0, 10))
  }
  return days
}

export function clampPlaybackDate(
  date: string | undefined,
  days: string[],
): string | undefined {
  if (!days.length) return undefined
  if (date && days.includes(date)) return date
  return days[0]
}

export function visibleEventFeatures(
  features: LayerResponse["geojson"]["features"],
  dataset: DatasetId,
  view: EventMapView,
  date: string | undefined,
): LayerResponse["geojson"]["features"] {
  if (view !== "daily") return features
  if (!date) return []
  return featuresOnDate(features, dataset, date)
}

export function emptyPlaybackDay(args: {
  view: EventMapView
  loading: boolean
  error?: string | null
  total: number
  shown: number
}): boolean {
  return (
    args.view === "daily" &&
    !args.loading &&
    !args.error &&
    args.total > 0 &&
    args.shown === 0
  )
}

export function usePlayback(
  dates: string[],
  date: string | undefined,
  onDate: (date: string | undefined) => void,
) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const onDateRef = useRef(onDate)
  onDateRef.current = onDate
  const index = Math.max(
    0,
    dates.findIndex((item) => item === date),
  )
  const current = dates[index]
  const first = dates[0]
  const last = dates.at(-1)
  const next = dates[index + 1]
  useEffect(() => {
    if (current && current !== date) onDateRef.current(current)
  }, [current, date])
  useEffect(() => {
    setPlaying(false)
  }, [first, last, dates.length])
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener("visibilitychange", pause)
    return () => document.removeEventListener("visibilitychange", pause)
  }, [])
  useEffect(() => {
    if (!playing || !current) return
    if (index >= dates.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => onDateRef.current(next), 1000 / speed)
    return () => clearTimeout(timer)
  }, [playing, current, index, dates.length, next, speed])
  return { playing, setPlaying, speed, setSpeed, index, current }
}
