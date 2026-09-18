import type { ReactNode } from "react"

export function PlaybackControls({
  label,
  dates,
  current,
  index,
  playing,
  speed,
  dateLabel,
  playLabel,
  pauseLabel,
  speedLabel,
  scrubberLabel,
  dateOutput,
  onTogglePlay,
  onSpeed,
  onScrub,
  leading,
  trailing,
  note,
  error,
}: {
  label: string
  dates: string[]
  current?: string
  index: number
  playing: boolean
  speed: number
  dateLabel: string
  playLabel: string
  pauseLabel: string
  speedLabel: string
  scrubberLabel: string
  dateOutput: string
  onTogglePlay: () => void
  onSpeed: (speed: number) => void
  onScrub: (date: string) => void
  leading?: ReactNode
  trailing?: ReactNode
  note?: ReactNode
  error?: ReactNode
}) {
  return (
    <div className="hdw-player" aria-label={label}>
      <div className="hdw-controls">
        {leading}
        <button
          aria-label={playing ? pauseLabel : playLabel}
          disabled={!current}
          onClick={onTogglePlay}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <output aria-label={dateLabel}>{dateOutput}</output>
        <select
          aria-label={speedLabel}
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
        >
          {[1, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        {trailing}
      </div>
      <input
        aria-label={scrubberLabel}
        type="range"
        min={0}
        max={Math.max(0, dates.length - 1)}
        value={index}
        disabled={!current}
        onChange={(e) => onScrub(dates[Number(e.target.value)])}
      />
      {note}
      {error}
    </div>
  )
}
