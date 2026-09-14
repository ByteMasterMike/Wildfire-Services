import { useEffect, useRef, useState } from "react"
import {
  CHART_DATASETS,
  configFor,
  unavailableReason,
  type Interval,
} from "./data.ts"
import { getCoverage, getDailySeries } from "./api.ts"
import { annualAxis, annualPoints, yearRange } from "./annual.ts"
import { ChartFilters, DatasetSelect, LoadState, YearOptions } from "./Controls"
import { usePanel } from "./state"
import { useRemote } from "./useRemote"
import { ExportActions } from "./ExportActions"
import { lineSvg } from "./exports.ts"

const COLORS = ["#9cc4ff", "#f3b982", "#b7a0f0", "#7ac5b1", "#ee8585"]
export function YearComparison() {
  const { settings, update, title } = usePanel()
  const dataset = CHART_DATASETS.some((d) => d.id === settings.dataset)
    ? settings.dataset
    : "cpuc"
  const { filters, interval } = settings
  const coverage = useRemote(`coverage:${dataset}`, () => getCoverage(dataset))
  const available =
    coverage.data?.start && coverage.data.end
      ? Array.from(
          {
            length:
              Number(coverage.data.end.slice(0, 4)) -
              Number(coverage.data.start.slice(0, 4)) +
              1,
          },
          (_, i) => Number(coverage.data!.start!.slice(0, 4)) + i,
        )
      : []
  const preferred = settings.comparisonYears ?? [
    Number(filters.start.slice(0, 4)) - 1,
    Number(filters.start.slice(0, 4)),
  ]
  const years = preferred
    .filter((year) => available.includes(year))
    .sort((a, b) => a - b)
  const [picker, setPicker] = useState(false)
  const reason = unavailableReason(dataset, filters)
  const scope = { county: filters.county, utility: filters.utility }
  const remote = useRemote(
    !coverage.data || reason || !years.length
      ? null
      : JSON.stringify([
          "yearly",
          dataset,
          scope,
          years,
          interval,
          coverage.data,
        ]),
    async () =>
      Promise.all(
        years.map(async (year, index) => {
          const range = yearRange(year, coverage.data!)!
          const daily = await getDailySeries(dataset, {
            ...scope,
            start: range.start,
            end: range.end,
          })
          return {
            year,
            color: COLORS[index],
            range,
            points: annualPoints(daily, interval),
            total: daily.reduce((sum, b) => sum + b.count, 0),
          }
        }),
      ),
  )
  const plot = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 540, height: 246 })
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(240, entry.contentRect.width),
        height: Math.max(120, entry.contentRect.height),
      }),
    )
    observer.observe(plot.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(
    () => setHover(null),
    [
      dataset,
      interval,
      settings.comparisonYears,
      filters.county,
      filters.utility,
    ],
  )
  const lines = remote.data ?? []
  const axis = annualAxis(interval)
  const ceiling =
    Math.ceil(
      Math.max(4, ...lines.flatMap((line) => line.points.map((p) => p.count))) /
        4,
    ) * 4
  const left = 36,
    right = size.width - 16,
    top = 28,
    bottom = size.height - 36
  const x = (n: number) => left + (n / axis.max) * (right - left)
  const y = (n: number) => bottom - (n / ceiling) * (bottom - top)
  const error =
    reason ||
    coverage.error ||
    remote.error ||
    (coverage.data && !years.length
      ? "Choose at least one available year."
      : null)
  const loading = coverage.loading || remote.loading
  return (
    <div className="analysis-chart series-panel yearly-panel">
      <ExportActions
        disabled={Boolean(error || loading || !lines.length)}
        rows={() =>
          lines.flatMap((line) =>
            line.points.map((p) => ({
              dataset: configFor(dataset).name,
              year: line.year,
              period_start: p.start,
              period_end: p.end,
              count: p.count,
              utility: filters.utility,
              county: filters.county,
              partial_recorded_year: line.range.partial,
            })),
          )
        }
        svg={() => {
          const svg = plot.current?.querySelector("svg")
          if (!svg) throw new Error("Chart is not ready.")
          return lineSvg(
            svg,
            title,
            `${configFor(dataset).name}; ${filters.utility || "All utilities"}; ${filters.county || "All counties"}; ${interval}. ${lines.map((l) => `${l.year}: ${l.range.start} – ${l.range.end}${l.range.partial ? " (partial recorded year)" : ""}`).join("; ")}. ${
              dataset === "calfire"
                ? "CAL FIRE posting coverage varies; not a census trend."
                : ""
            }`,
            lines.map((l) => ({
              label: `${l.year}: ${l.total}`,
              color: l.color,
            })),
          )
        }}
      />
      <div className="yearly-toolbar">
        <DatasetSelect
          value={dataset}
          all={false}
          onChange={(dataset) => update({ dataset })}
        />
        <button className="years-button" onClick={() => setPicker(true)}>
          Years · {years.join(", ") || "Choose"}
        </button>
        <label>
          Interval
          <select
            aria-label="Time interval"
            value={interval}
            onChange={(e) => update({ interval: e.target.value as Interval })}
          >
            {["daily", "weekly", "monthly", "quarterly"].map((i) => (
              <option key={i} value={i}>
                {i[0].toUpperCase() + i.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ChartFilters
        filters={filters}
        onChange={(filters) => update({ filters })}
        dataset={dataset}
        years={years}
      />
      <div className="year-legend">
        {lines.map((line) => (
          <span
            key={line.year}
            style={{ color: line.color }}
            title={`${line.range.start} – ${line.range.end}`}
          >
            <i />
            {line.year}
            {line.range.partial ? "*" : ""}
          </span>
        ))}
      </div>
      <div ref={plot} className="series-plot">
        {error || loading || !lines.length ? (
          <LoadState
            loading={loading}
            error={error}
            retry={
              coverage.error
                ? coverage.retry
                : remote.error
                  ? remote.retry
                  : undefined
            }
          />
        ) : (
          <svg
            data-export-chart="true"
            viewBox={`0 0 ${size.width} ${size.height}`}
            role="img"
            tabIndex={0}
            aria-label={`${configFor(dataset).name} event counts by year. Use left and right arrows to inspect periods.`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setHover(
                Math.max(
                  0,
                  Math.min(
                    axis.max,
                    Math.round(
                      ((((e.clientX - r.left) / r.width) * size.width - left) /
                        (right - left)) *
                        axis.max,
                    ),
                  ),
                ),
              )
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault()
                setHover(
                  Math.max(
                    0,
                    Math.min(
                      axis.max,
                      (hover ?? 0) + (e.key === "ArrowRight" ? 1 : -1),
                    ),
                  ),
                )
              }
            }}
          >
            <text x={left} y="13">
              Events
            </text>
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <path
                  d={`M${left} ${y((ceiling * i) / 4)}H${right}`}
                  stroke="#ffffff12"
                />
                <text
                  x={left - 9}
                  y={y((ceiling * i) / 4) + 4}
                  textAnchor="end"
                >
                  {(ceiling * i) / 4}
                </text>
              </g>
            ))}
            {axis.ticks.map(([n, label]) => (
              <text
                key={n}
                x={x(n)}
                y={size.height - 11}
                textAnchor={
                  n === 0 ? "start" : n === axis.max ? "end" : "middle"
                }
              >
                {label}
              </text>
            ))}
            {lines.map((line) => (
              <g key={line.year}>
                <polyline
                  points={line.points
                    .map((p) => `${x(p.x)},${y(p.count)}`)
                    .join(" ")}
                  fill="none"
                  stroke={line.color}
                  strokeWidth="2"
                />
                {line.points.length <= 53 &&
                  line.points.map((p) => (
                    <circle
                      key={p.start}
                      cx={x(p.x)}
                      cy={y(p.count)}
                      r="3"
                      fill={line.color}
                    >
                      <title>
                        {line.year}: {p.start} – {p.end}: {p.count} events
                      </title>
                    </circle>
                  ))}
              </g>
            ))}
            {hover !== null && (
              <g>
                <path
                  d={`M${x(hover)} ${top}V${bottom}`}
                  stroke="#ffffff45"
                  strokeDasharray="3 4"
                />
                {lines.map((line) => {
                  const p = line.points.find((p) => p.x === hover)
                  return (
                    p && (
                      <circle
                        key={line.year}
                        cx={x(p.x)}
                        cy={y(p.count)}
                        r="4"
                        fill={line.color}
                      />
                    )
                  )
                })}
              </g>
            )}
          </svg>
        )}
      </div>
      {!error && !loading && (
        <div className="series-readout">
          <span>
            {hover === null ? "Shown range totals" : "Selected period"}
          </span>
          <div>
            {lines.map((line) => (
              <span key={line.year} style={{ color: line.color }}>
                {line.year}{" "}
                <strong>
                  {hover === null
                    ? line.total
                    : (line.points.find((p) => p.x === hover)?.count ?? "—")}
                </strong>
              </span>
            ))}
          </div>
        </div>
      )}
      {lines.some((line) => line.range.partial) && <p className="panel-note">
        {lines
          .filter((l) => l.range.partial)
          .map(
            (l) =>
              `*${l.year}: ${l.range.start.slice(5)}–${l.range.end.slice(5)}. `,
          )
          .join("")}
      </p>}
      {picker && (
        <YearPicker
          available={available}
          selected={years}
          onChange={(comparisonYears) => update({ comparisonYears })}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  )
}
function YearPicker({
  available,
  selected,
  onChange,
  onClose,
}: {
  available: number[]
  selected: number[]
  onChange: (years: number[]) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!,
      root = document.documentElement,
      previous = root.style.overflow
    root.style.overflow = "hidden"
    element.showModal()
    return () => {
      element.close()
      root.style.overflow = previous
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="filter-dialog"
      aria-label="Choose comparison years"
      onCancel={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <header>
        <h2>Compare years</h2>
        <button aria-label="Close years" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="panel-note">
        Choose up to five years. Dates use the dataset's recorded range.
      </p>
      <YearOptions available={available} selected={selected} onChange={onChange}/>
      <button className="quiet-button" onClick={onClose}>
        Done
      </button>
    </dialog>
  )
}
